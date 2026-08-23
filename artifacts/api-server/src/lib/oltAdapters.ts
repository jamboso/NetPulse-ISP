import * as net from "node:net";
import { hiosoEponAdapter, hiosoGponIdentityAdapter } from "./hiosoEponAdapter";
import { vendorStandardSnmpIdentityAdapter } from "./vendorStandardSnmpIdentityAdapter";

export type OltAdapterInput = {
  id: number;
  vendor: string;
  model: string;
  firmwareVersion: string | null;
  ponTechnology: string;
  managementHost: string;
  managementPort: number;
  managementProtocol: string;
  snmpCommunity?: string;
};

export type OltDiscovery = {
  healthState: "online" | "offline" | "unknown";
  ports: Array<{ portNumber: string; label?: string; state: string; opticalState?: string }>;
  onus: Array<{
    serialNumber?: string;
    loid?: string;
    portNumber?: string;
    vendor?: string;
    model?: string;
    macAddress?: string;
    opticalState?: string;
    rxPowerDbm?: string;
    txPowerDbm?: string;
    provisioningState: string;
  }>;
  note?: string;
};

export type OltVendorAdapter = {
  readonly id: string;
  supports(input: OltAdapterInput): boolean;
  checkConnectivity(input: OltAdapterInput): Promise<{ reachable: boolean; latencyMs: number | null }>;
  discover(input: OltAdapterInput): Promise<OltDiscovery>;
  validateServiceProfile(profile: { vlanId: number; accessMode: string }): { valid: boolean; reason?: string };
  provision(): Promise<never>;
  rollback(): Promise<never>;
};

function tcpProbe(host: string, port: number, timeoutMs = 2_000): Promise<{ reachable: boolean; latencyMs: number | null }> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const startedAt = Date.now();
    let complete = false;
    const done = (reachable: boolean) => {
      if (complete) return;
      complete = true;
      socket.destroy();
      resolve({ reachable, latencyMs: reachable ? Date.now() - startedAt : null });
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(port, host);
  });
}

const safeReadOnlyAdapter: OltVendorAdapter = {
  id: "safe-read-only",
  supports: () => true,
  checkConnectivity: (input) => tcpProbe(input.managementHost, input.managementPort),
  async discover(input) {
    if (input.managementProtocol === "snmp-v2c" || input.managementProtocol === "snmp-v3") {
      return {
        healthState: "unknown",
        ports: [],
        onus: [],
        note: "The approved SNMP target is ready for a vendor inventory adapter. The generic adapter does not send SNMP requests.",
      };
    }
    const connection = await tcpProbe(input.managementHost, input.managementPort);
    return {
      healthState: connection.reachable ? "online" : "offline",
      ports: [],
      onus: [],
      note: connection.reachable
        ? "Management port is reachable. Vendor inventory discovery is not enabled for this OLT profile yet."
        : "Management port is not reachable. Check the address, port, and network path.",
    };
  },
  validateServiceProfile(profile) {
    if (profile.vlanId < 1 || profile.vlanId > 4094) return { valid: false, reason: "VLAN ID must be between 1 and 4094." };
    return { valid: true };
  },
  async provision() {
    throw new Error("No vendor write adapter is enabled. Run a dry run or install a verified vendor adapter.");
  },
  async rollback() {
    throw new Error("No vendor write adapter is enabled. Rollback is unavailable until a verified vendor adapter is installed.");
  },
};

export function getOltAdapter(input: OltAdapterInput): OltVendorAdapter {
  if (hiosoEponAdapter.supports(input)) return hiosoEponAdapter;
  if (hiosoGponIdentityAdapter.supports(input)) return hiosoGponIdentityAdapter;
  if (vendorStandardSnmpIdentityAdapter.supports(input)) return vendorStandardSnmpIdentityAdapter;
  // The default adapter never sends device configuration commands.
  return safeReadOnlyAdapter;
}