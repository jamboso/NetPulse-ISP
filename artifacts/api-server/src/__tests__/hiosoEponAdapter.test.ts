import { describe, expect, it, vi } from "vitest";
import { getOltCapability } from "../lib/oltCapabilities";
import { createHiosoEponAdapter, createHiosoGponIdentityAdapter, normalizeHiosoEponDiscovery } from "../lib/hiosoEponAdapter";

const input = {
  id: 12,
  vendor: "HIOSO",
  model: "HA7304VD",
  firmwareVersion: "v1.1.28",
  ponTechnology: "epon",
  managementHost: "10.12.4.8",
  managementPort: 161,
  managementProtocol: "snmp-v2c",
  snmpCommunity: "private",
};

describe("HIOSO EPON compatibility and discovery", () => {
  it("only enables the MIB reader for the documented HA7304V/VD EPON firmware profile", () => {
    expect(getOltCapability(input)).toMatchObject({
      status: "mib-validated-read-only",
      discoveryEnabled: true,
      provisioningEnabled: false,
    });
    expect(getOltCapability({ ...input, firmwareVersion: "v1.1.29" })).toMatchObject({
      status: "recognized-read-only",
      discoveryEnabled: false,
    });
    expect(getOltCapability({ ...input, model: "HA7304G-J", ponTechnology: "gpon" })).toMatchObject({
      status: "standard-identity-read-only",
      discoveryEnabled: true,
      adapter: "hioso-gpon-identity",
    });
  });

  it("normalizes HIOSO EPON PON and unauthorized-online ONU inventory without configuration writes", () => {
    const discovery = normalizeHiosoEponDiscovery({
      sysDescr: [{ oid: "1.3.6.1.2.1.1.1.0", value: "HIOSO HA7304VD" }],
      sysName: [{ oid: "1.3.6.1.2.1.1.5.0", value: "pop-a-olt" }],
      olts: [{ oid: "1.3.6.1.4.1.25355.3.2.6.3.1.12.1", value: "v1.1.28" }],
      ports: [
        { oid: "1.3.6.1.4.1.25355.3.2.6.1.1.10.1.2.4", value: 2 },
        { oid: "1.3.6.1.4.1.25355.3.2.6.1.1.12.1.2.4", value: "PON 2 port 4" },
      ],
      onus: [
        { oid: "1.3.6.1.4.1.25355.3.2.6.3.2.1.4.1.2.4", value: "001A2B" },
        { oid: "1.3.6.1.4.1.25355.3.2.6.3.2.1.5.1.2.4", value: "8245" },
        { oid: "1.3.6.1.4.1.25355.3.2.6.3.2.1.10.1.2.4", value: "Huawei" },
        { oid: "1.3.6.1.4.1.25355.3.2.6.3.2.1.35.1.2.4", value: 0 },
        { oid: "1.3.6.1.4.1.25355.3.2.6.3.2.1.36.1.2.4", value: "HWTC12345678" },
        { oid: "1.3.6.1.4.1.25355.3.2.6.3.2.1.39.1.2.4", value: 1 },
      ],
    });

    expect(discovery.healthState).toBe("online");
    expect(discovery.ports).toEqual([expect.objectContaining({ portNumber: "1/2/4", state: "up" })]);
    expect(discovery.onus).toEqual([expect.objectContaining({
      serialNumber: "HWTC12345678", vendor: "Huawei", model: "8245",
      opticalState: "online", provisioningState: "unauthorized",
    })]);
    expect(discovery.note).toMatch(/1 online ONU\(s\) require authorization review/i);
    expect(discovery.note).toMatch(/No configuration commands were sent/i);
  });

  it("uses only read-only SNMP walks against the already-approved management IP", async () => {
    const walk = vi.fn(async (_host: string, _port: number, _community: string, root: string) => {
      if (root === "1.3.6.1.2.1.1.1") return [{ oid: "1.3.6.1.2.1.1.1.0", value: "HIOSO HA7304VD" }];
      if (root === "1.3.6.1.4.1.25355.3.2.6.3.1") return [{ oid: "1.3.6.1.4.1.25355.3.2.6.3.1.12.1", value: "v1.1.28" }];
      return [];
    });
    const adapter = createHiosoEponAdapter({ walk });

    await adapter.discover(input);

    expect(walk).toHaveBeenCalledTimes(5);
    expect(walk).toHaveBeenCalledWith("10.12.4.8", 161, "private", "1.3.6.1.2.1.1.1");
    await expect(adapter.provision()).rejects.toThrow(/disabled/i);
    await expect(adapter.rollback()).rejects.toThrow(/unavailable/i);
  });

  it("fails discovery before normalization when the live model or firmware is not the approved profile", async () => {
    const walk = vi.fn(async (_host: string, _port: number, _community: string, root: string) => {
      if (root === "1.3.6.1.2.1.1.1") return [{ oid: "1.3.6.1.2.1.1.1.0", value: "HIOSO HA7304V" }];
      if (root === "1.3.6.1.4.1.25355.3.2.6.3.1") return [{ oid: "1.3.6.1.4.1.25355.3.2.6.3.1.12.1", value: "v1.1.29" }];
      return [];
    });
    const adapter = createHiosoEponAdapter({ walk });

    await expect(adapter.discover(input)).rejects.toThrow(/identity mismatch/i);
  });

  it("uses standard system identity only for HA7304G-J GPON", async () => {
    const walk = vi.fn(async (_host: string, _port: number, _community: string, root: string) => {
      if (root === "1.3.6.1.2.1.1.1") return [{ oid: "1.3.6.1.2.1.1.1.0", value: "HIOSO HA7304G-J GPON" }];
      if (root === "1.3.6.1.2.1.1.5") return [{ oid: "1.3.6.1.2.1.1.5.0", value: "gpon-pop" }];
      return [];
    });
    const adapter = createHiosoGponIdentityAdapter({ walk });
    const discovery = await adapter.discover({ ...input, model: "HA7304G-J", firmwareVersion: "unified-gpon-bin", ponTechnology: "gpon" });

    expect(discovery).toMatchObject({ healthState: "online", ports: [], onus: [] });
    expect(discovery.note).toMatch(/No GPON vendor OIDs or configuration commands were sent/i);
    expect(walk).toHaveBeenCalledTimes(2);
    await expect(adapter.provision()).rejects.toThrow(/disabled/i);
  });
});