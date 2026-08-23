import type { OltAdapterInput, OltVendorAdapter } from "./oltAdapters";
import { getOltCapability } from "./oltCapabilities";
import { snmpV2c, type SnmpVarbind } from "./snmpV2c";

type SnmpReader = typeof snmpV2c;

const SYS_DESCR = "1.3.6.1.2.1.1.1";
const SYS_NAME = "1.3.6.1.2.1.1.5";

function normalized(value: string): string {
  return value.trim().toUpperCase().replace(/[\s_-]+/g, "");
}

function text(value: SnmpVarbind | undefined): string | undefined {
  const result = value?.value == null ? undefined : String(value.value).trim();
  return result || undefined;
}

function validateLiveIdentity(input: OltAdapterInput, sysDescr: SnmpVarbind[]): void {
  const description = sysDescr.map((value) => String(value.value ?? "")).join(" ");
  const received = normalized(description);
  if (!received.includes(normalized(input.vendor)) || !received.includes(normalized(input.model))) {
    throw new Error(`OLT device identity mismatch: expected ${input.vendor} ${input.model}, but the SNMP system description reported ${description || "no matching vendor/model"}.`);
  }
}

/**
 * Uses only RFC 1213/standard SNMP system identity values. This adapter does
 * not access vendor enterprise OIDs, returns no PON/ONU inventory, and cannot
 * execute configuration commands.
 */
export function createVendorStandardSnmpIdentityAdapter(reader: SnmpReader = snmpV2c): OltVendorAdapter {
  return {
    id: "vendor-standard-snmp-identity-read-only",
    supports: (input) => getOltCapability(input).adapter === "vendor-standard-snmp-identity",
    async checkConnectivity(input) {
      if (!input.snmpCommunity) return { reachable: false, latencyMs: null };
      const startedAt = Date.now();
      try {
        await reader.walk(input.managementHost, input.managementPort, input.snmpCommunity, SYS_DESCR);
        return { reachable: true, latencyMs: Date.now() - startedAt };
      } catch {
        return { reachable: false, latencyMs: null };
      }
    },
    async discover(input) {
      if (!input.snmpCommunity) throw new Error(`${input.vendor} SNMP identity discovery needs an encrypted SNMP community configured for this OLT.`);
      const [sysDescr, sysName] = await Promise.all([
        reader.walk(input.managementHost, input.managementPort, input.snmpCommunity, SYS_DESCR),
        reader.walk(input.managementHost, input.managementPort, input.snmpCommunity, SYS_NAME),
      ]);
      validateLiveIdentity(input, sysDescr);
      return {
        healthState: "online",
        ports: [],
        onus: [],
        note: `${input.vendor} ${input.model} system identity verified${text(sysName[0]) ? ` (${text(sysName[0])})` : ""} through standard SNMP only. No vendor enterprise OIDs, PON/ONU inventory, or configuration commands were sent.`,
      };
    },
    validateServiceProfile(profile) {
      if (profile.vlanId < 1 || profile.vlanId > 4094) return { valid: false, reason: "VLAN ID must be between 1 and 4094." };
      return { valid: true };
    },
    async provision() {
      throw new Error("Vendor provisioning is disabled until a model- and firmware-specific write workflow is lab-validated.");
    },
    async rollback() {
      throw new Error("Vendor rollback is unavailable until a model- and firmware-specific recovery workflow is lab-validated.");
    },
  };
}

export const vendorStandardSnmpIdentityAdapter = createVendorStandardSnmpIdentityAdapter();