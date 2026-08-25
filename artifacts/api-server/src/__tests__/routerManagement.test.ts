import { describe, expect, it } from "vitest";
import { getRouterManagementHost } from "../lib/routerManagement";

describe("RouterOS VPN management target", () => {
  it("uses the private VPN IP after zero-touch provisioning", () => {
    expect(getRouterManagementHost({
      routerType: "routeros",
      ipAddress: "198.51.100.10",
      vpnIp: "10.8.0.24",
      vpnConnected: true,
    })).toBe("10.8.0.24");
  });

  it("does not fall back to a public router address while a managed tunnel is disconnected", () => {
    expect(getRouterManagementHost({
      routerType: "routeros",
      ipAddress: "198.51.100.10",
      vpnIp: "10.8.0.24",
      vpnConnected: false,
    })).toBeNull();
  });
});