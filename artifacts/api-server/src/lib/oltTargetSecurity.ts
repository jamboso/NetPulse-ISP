import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { OltAdapterInput } from "./oltAdapters";

const PORTS_BY_PROTOCOL: Record<string, number> = {
  "snmp-v2c": 161,
  "snmp-v3": 161,
  ssh: 22,
  https: 443,
  telnet: 23,
};

type LookupResult = { address: string; family: number };
type Lookup = (hostname: string, options: { all: true; verbatim: true }) => Promise<LookupResult[]>;

export class OltTargetSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OltTargetSecurityError";
  }
}

function parseAllowedCidrs(): Array<{ network: number; prefix: number }> {
  const configured = process.env["OLT_MANAGEMENT_ALLOWED_CIDRS"]?.trim();
  if (!configured) {
    throw new OltTargetSecurityError(
      "OLT discovery is disabled until OLT_MANAGEMENT_ALLOWED_CIDRS is configured with approved IPv4 management networks.",
    );
  }

  const cidrs = configured.split(",").map((value) => value.trim()).filter(Boolean);
  if (!cidrs.length) {
    throw new OltTargetSecurityError("OLT discovery has no approved management networks configured.");
  }

  return cidrs.map((cidr) => {
    const match = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d|[12]\d|3[0-2])$/.exec(cidr);
    if (!match) throw new OltTargetSecurityError("OLT_MANAGEMENT_ALLOWED_CIDRS must contain valid IPv4 CIDRs.");
    const prefix = Number(match[2]);
    if (prefix < 8) throw new OltTargetSecurityError("OLT management networks must be narrower than /8.");
    const octets = match[1]!.split(".").map(Number);
    if (octets.some((octet) => octet > 255)) throw new OltTargetSecurityError("OLT_MANAGEMENT_ALLOWED_CIDRS contains an invalid IPv4 address.");
    const network = octets.reduce((value, octet) => ((value << 8) | octet) >>> 0, 0);
    return { network, prefix };
  });
}

function toIpv4Integer(address: string): number {
  return address.split(".").map(Number).reduce((value, octet) => ((value << 8) | octet) >>> 0, 0);
}

function isForbiddenAddress(address: string): boolean {
  const [first, second] = address.split(".").map(Number);
  return first === 0 || first === 127 || (first === 169 && second === 254) || first >= 224;
}

function isInAllowedNetwork(address: string, cidrs: Array<{ network: number; prefix: number }>): boolean {
  const value = toIpv4Integer(address);
  return cidrs.some(({ network, prefix }) => {
    const mask = prefix === 32 ? 0xffffffff : (0xffffffff << (32 - prefix)) >>> 0;
    return (value & mask) === (network & mask);
  });
}

/**
 * Resolves a registered hostname immediately before a probe and returns an
 * approved IP address. The caller must connect to this IP, never re-resolve
 * the hostname, which prevents DNS-rebinding between validation and use.
 */
export async function resolveApprovedOltTarget(
  input: Pick<OltAdapterInput, "managementHost" | "managementPort" | "managementProtocol">,
  lookup: Lookup = dnsLookup,
): Promise<string> {
  const expectedPort = PORTS_BY_PROTOCOL[input.managementProtocol];
  if (!expectedPort || input.managementPort !== expectedPort) {
    throw new OltTargetSecurityError(
      `${input.managementProtocol} discovery must use management port ${expectedPort ?? "an approved protocol port"}.`,
    );
  }

  const host = input.managementHost.trim();
  if (!host || host !== input.managementHost || host.includes("/") || host.includes("@")) {
    throw new OltTargetSecurityError("The OLT management host is invalid.");
  }

  const records = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await lookup(host, { all: true, verbatim: true });
  const cidrs = parseAllowedCidrs();
  if (!records.length) throw new OltTargetSecurityError("The OLT management host did not resolve to an approved address.");

  for (const record of records) {
    if (record.family !== 4 || isIP(record.address) !== 4 || isForbiddenAddress(record.address)) {
      throw new OltTargetSecurityError("OLT discovery only permits approved, routable IPv4 management addresses.");
    }
    if (!isInAllowedNetwork(record.address, cidrs)) {
      throw new OltTargetSecurityError("The OLT management address is outside the configured approved management networks.");
    }
  }

  return records[0]!.address;
}