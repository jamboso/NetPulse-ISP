import type { OltAdapterInput, OltDiscovery, OltVendorAdapter } from "./oltAdapters";
import { getOltCapability } from "./oltCapabilities";
import { snmpV2c, type SnmpVarbind } from "./snmpV2c";

type SnmpReader = typeof snmpV2c;
type Row = Record<number, string | number | null>;

const SYS_DESCR = "1.3.6.1.2.1.1.1";
const SYS_NAME = "1.3.6.1.2.1.1.5";
const OLT_TABLE = "1.3.6.1.4.1.25355.3.2.6.3.1";
const PON_PORT_TABLE = "1.3.6.1.4.1.25355.3.2.6.1.1";
const ONU_TABLE = "1.3.6.1.4.1.25355.3.2.6.3.2.1";

function tableRows(root: string, values: SnmpVarbind[]): Map<string, Row> {
  const rows = new Map<string, Row>();
  for (const value of values) {
    const suffix = value.oid.slice(root.length + 1).split(".").map(Number);
    const [column, ...index] = suffix;
    if (!column || !index.length) continue;
    const key = index.join(".");
    const row = rows.get(key) ?? {};
    row[column] = value.value;
    rows.set(key, row);
  }
  return rows;
}

function text(value: string | number | null | undefined): string | undefined {
  return value == null ? undefined : String(value).trim() || undefined;
}

function onuAuth(value: string | number | null | undefined): "authorized" | "unauthorized" | "denied" | "unknown" {
  if (value === 1 || value === "1") return "authorized";
  if (value === 2 || value === "2") return "denied";
  if (value === 0 || value === "0") return "unauthorized";
  return "unknown";
}

function onuLink(value: string | number | null | undefined): "online" | "offline" | "power-off" | "not-present" | "unknown" {
  if (value === 1 || value === "1") return "online";
  if (value === 2 || value === "2") return "offline";
  if (value === 3 || value === "3") return "power-off";
  if (value === 0 || value === "0") return "not-present";
  return "unknown";
}

function normalized(value: string | number | null | undefined): string {
  return String(value ?? "").trim().toUpperCase().replace(/[\s_-]+/g, "");
}

function firmware(value: string | number | null | undefined): string {
  return normalized(value).replace(/^V/, "");
}

function validateLiveHiosoProfile(input: OltAdapterInput, sysDescr: SnmpVarbind[], oltValues: SnmpVarbind[]): void {
  const expectedModel = normalized(input.model);
  const advertisedDescription = sysDescr.map((value) => String(value.value ?? "")).join(" ");
  const advertisedModel = advertisedDescription.match(/HA\s*7304V(?:D)?/i)?.[0];
  if (!/HIOSO/i.test(advertisedDescription) || !advertisedModel || normalized(advertisedModel) !== expectedModel) {
    throw new Error(`HIOSO device identity mismatch: expected ${input.vendor} ${input.model}, but the SNMP system description reported ${advertisedDescription || "no matching model"}.`);
  }

  const firmwareValues = [...tableRows(OLT_TABLE, oltValues).values()]
    .flatMap((row) => [row[12]])
    .filter((value): value is string | number => value != null);
  const expectedFirmware = firmware(input.firmwareVersion);
  if (!expectedFirmware || !firmwareValues.some((value) => firmware(value) === expectedFirmware)) {
    throw new Error(`HIOSO firmware mismatch: expected ${input.firmwareVersion ?? "an exact firmware version"}, but the OLT MIB reported ${firmwareValues.map(String).join(", ") || "no firmware value"}.`);
  }
}

export function normalizeHiosoEponDiscovery(data: {
  sysDescr: SnmpVarbind[];
  sysName: SnmpVarbind[];
  olts: SnmpVarbind[];
  ports: SnmpVarbind[];
  onus: SnmpVarbind[];
}): OltDiscovery {
  const oltRows = tableRows(OLT_TABLE, data.olts);
  const portRows = tableRows(PON_PORT_TABLE, data.ports);
  const onuRows = tableRows(ONU_TABLE, data.onus);
  const ports: OltDiscovery["ports"] = [];

  for (const [index, row] of portRows) {
    const [slot, pon, port] = index.split(".");
    if (!slot || !pon || !port) continue;
    const portNumber = `${slot}/${pon}/${port}`;
    const state = row[10] === 2 || row[10] === "2" ? "up" : row[10] == null ? "unknown" : "down";
    ports.push({
      portNumber,
      label: text(row[12]) ?? `PON ${slot}/${pon} · port ${port}`,
      state,
    });
  }

  const onus = [...onuRows.entries()].map(([index, row]) => {
    const auth = onuAuth(row[35]);
    const link = onuLink(row[39]);
    return {
      serialNumber: text(row[36]),
      // The ONU table identifies slot/PON/ONU but does not include the LNP
      // port index, so it must not be joined to a triple-indexed port record.
      vendor: text(row[10]),
      model: text(row[5]),
      opticalState: link,
      provisioningState: auth,
    };
  });

  const unauthorizedOnline = onus.filter((onu) => onu.opticalState === "online" && (onu.provisioningState === "unauthorized" || onu.provisioningState === "denied")).length;
  const identity = [
    text(data.sysDescr[0]?.value),
    text(data.sysName[0]?.value),
    ...[...oltRows.values()].flatMap((row) => [text(row[11]), text(row[12])]).filter(Boolean),
  ].filter(Boolean).join(" · ");
  return {
    healthState: "online",
    ports,
    onus,
    note: `HIOSO EPON SNMP inventory read completed${identity ? ` (${identity})` : ""}. ${unauthorizedOnline} online ONU(s) require authorization review. No configuration commands were sent.`,
  };
}

export function createHiosoEponAdapter(reader: SnmpReader = snmpV2c): OltVendorAdapter {
  return {
    id: "hioso-epon-snmp-v2c-read-only",
    supports: (input) => getOltCapability(input).adapter === "hioso-epon-mib",
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
      if (!input.snmpCommunity) throw new Error("HIOSO SNMP discovery needs an encrypted SNMP community configured for this OLT.");
      const [sysDescr, sysName, olts, ports, onus] = await Promise.all([
        reader.walk(input.managementHost, input.managementPort, input.snmpCommunity, SYS_DESCR),
        reader.walk(input.managementHost, input.managementPort, input.snmpCommunity, SYS_NAME),
        reader.walk(input.managementHost, input.managementPort, input.snmpCommunity, OLT_TABLE),
        reader.walk(input.managementHost, input.managementPort, input.snmpCommunity, PON_PORT_TABLE),
        reader.walk(input.managementHost, input.managementPort, input.snmpCommunity, ONU_TABLE),
      ]);
      validateLiveHiosoProfile(input, sysDescr, olts);
      return normalizeHiosoEponDiscovery({ sysDescr, sysName, olts, ports, onus });
    },
    validateServiceProfile(profile) {
      if (profile.vlanId < 1 || profile.vlanId > 4094) return { valid: false, reason: "VLAN ID must be between 1 and 4094." };
      return { valid: true };
    },
    async provision() {
      throw new Error("HIOSO provisioning is disabled. This adapter performs read-only SNMP discovery only.");
    },
    async rollback() {
      throw new Error("HIOSO rollback is unavailable because no write profile has been lab-validated.");
    },
  };
}

export const hiosoEponAdapter = createHiosoEponAdapter();

export function createHiosoGponIdentityAdapter(reader: SnmpReader = snmpV2c): OltVendorAdapter {
  return {
    id: "hioso-gpon-standard-snmp-identity-read-only",
    supports: (input) => getOltCapability(input).adapter === "hioso-gpon-identity",
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
      if (!input.snmpCommunity) throw new Error("HIOSO SNMP discovery needs an encrypted SNMP community configured for this OLT.");
      const [sysDescr, sysName] = await Promise.all([
        reader.walk(input.managementHost, input.managementPort, input.snmpCommunity, SYS_DESCR),
        reader.walk(input.managementHost, input.managementPort, input.snmpCommunity, SYS_NAME),
      ]);
      const description = sysDescr.map((value) => String(value.value ?? "")).join(" ");
      const expectedModel = normalized(input.model);
      const reportedModel = description.match(/HA\s*7304G[\s-]*J/i)?.[0];
      if (!/HIOSO/i.test(description) || !reportedModel || normalized(reportedModel) !== expectedModel) {
        throw new Error(`HIOSO GPON device identity mismatch: expected ${input.vendor} ${input.model}, but the SNMP system description reported ${description || "no matching model"}.`);
      }
      return {
        healthState: "online",
        ports: [],
        onus: [],
        note: `HIOSO GPON system identity verified${text(sysName[0]?.value) ? ` (${text(sysName[0]?.value)})` : ""}. No GPON vendor OIDs or configuration commands were sent.`,
      };
    },
    validateServiceProfile(profile) {
      if (profile.vlanId < 1 || profile.vlanId > 4094) return { valid: false, reason: "VLAN ID must be between 1 and 4094." };
      return { valid: true };
    },
    async provision() {
      throw new Error("HIOSO GPON provisioning is disabled because no GPON write profile has been lab-validated.");
    },
    async rollback() {
      throw new Error("HIOSO GPON rollback is unavailable because no GPON write profile has been lab-validated.");
    },
  };
}

export const hiosoGponIdentityAdapter = createHiosoGponIdentityAdapter();