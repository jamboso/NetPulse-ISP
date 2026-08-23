import { afterEach, describe, expect, it } from "vitest";
import { OltTargetSecurityError, resolveApprovedOltTarget } from "../lib/oltTargetSecurity";

const input = {
  managementHost: "olt.example.test",
  managementPort: 161,
  managementProtocol: "snmp-v2c",
};

const originalCidrs = process.env["OLT_MANAGEMENT_ALLOWED_CIDRS"];
afterEach(() => {
  if (originalCidrs === undefined) delete process.env["OLT_MANAGEMENT_ALLOWED_CIDRS"];
  else process.env["OLT_MANAGEMENT_ALLOWED_CIDRS"] = originalCidrs;
});

describe("OLT target security", () => {
  it("only returns a resolved address inside the explicit management allowlist", async () => {
    process.env["OLT_MANAGEMENT_ALLOWED_CIDRS"] = "10.12.0.0/16";
    const target = await resolveApprovedOltTarget(input, async () => [{ address: "10.12.4.8", family: 4 }]);

    expect(target).toBe("10.12.4.8");
  });

  it("rejects destinations outside the configured management networks", async () => {
    process.env["OLT_MANAGEMENT_ALLOWED_CIDRS"] = "10.12.0.0/16";

    await expect(resolveApprovedOltTarget(input, async () => [{ address: "10.13.4.8", family: 4 }]))
      .rejects.toThrow(OltTargetSecurityError);
  });

  it("rejects loopback and link-local addresses even when an unsafe allowlist includes them", async () => {
    process.env["OLT_MANAGEMENT_ALLOWED_CIDRS"] = "127.0.0.0/8,169.254.0.0/16";

    await expect(resolveApprovedOltTarget(input, async () => [{ address: "127.0.0.1", family: 4 }]))
      .rejects.toThrow(/approved, routable IPv4/i);
    await expect(resolveApprovedOltTarget(input, async () => [{ address: "169.254.169.254", family: 4 }]))
      .rejects.toThrow(/approved, routable IPv4/i);
  });

  it("rejects a hostname when any resolved record falls outside policy, preventing rebinding", async () => {
    process.env["OLT_MANAGEMENT_ALLOWED_CIDRS"] = "10.12.0.0/16";

    await expect(resolveApprovedOltTarget(input, async () => [
      { address: "10.12.4.8", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ])).rejects.toThrow(OltTargetSecurityError);
  });

  it("enforces the management port associated with the selected protocol", async () => {
    process.env["OLT_MANAGEMENT_ALLOWED_CIDRS"] = "10.12.0.0/16";

    await expect(resolveApprovedOltTarget({ ...input, managementPort: 8080 }, async () => [{ address: "10.12.4.8", family: 4 }]))
      .rejects.toThrow(/port 161/i);
  });
});