import { afterEach, describe, expect, it } from "vitest";
import { resolveApprovedGenieAcsEndpoint } from "../lib/genieAcsClient";

const originalAllowedHosts = process.env["TR069_ACS_ALLOWED_HOSTS"];

afterEach(() => {
  if (originalAllowedHosts === undefined) delete process.env["TR069_ACS_ALLOWED_HOSTS"];
  else process.env["TR069_ACS_ALLOWED_HOSTS"] = originalAllowedHosts;
});

describe("GenieACS outbound target policy", () => {
  it("rejects loopback endpoints even when their hostname is allowlisted", async () => {
    process.env["TR069_ACS_ALLOWED_HOSTS"] = "127.0.0.1";

    await expect(resolveApprovedGenieAcsEndpoint("https://127.0.0.1")).rejects.toThrow(/public IPv4/i);
  });

  it("rejects a hostname that is not explicitly approved", async () => {
    process.env["TR069_ACS_ALLOWED_HOSTS"] = "acs.example.test";

    await expect(resolveApprovedGenieAcsEndpoint("https://other.example.test")).rejects.toThrow(/not present/i);
  });

  it("pins an allowlisted hostname to its validated public DNS answer", async () => {
    process.env["TR069_ACS_ALLOWED_HOSTS"] = "acs.example.test";

    const endpoint = await resolveApprovedGenieAcsEndpoint(
      "https://acs.example.test/nbi",
      async () => [{ address: "8.8.8.8", family: 4 }],
    );

    expect(endpoint.address).toBe("8.8.8.8");
    expect(endpoint.url.hostname).toBe("acs.example.test");
  });
});