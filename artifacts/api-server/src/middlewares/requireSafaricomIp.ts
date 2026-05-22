import type { Request, Response, NextFunction } from "express";

/**
 * Safaricom's published outbound IP ranges for Daraja API callbacks.
 * Source: https://developer.safaricom.co.ke/docs#callback-urls
 * Used as the default when MPESA_ALLOWED_IPS is not set.
 */
const DEFAULT_SAFARICOM_CIDRS = [
  "196.201.214.0/24",
  "196.201.216.0/24",
  "196.201.213.0/24",
  "196.201.212.0/24",
  "196.201.211.0/24",
  "196.201.210.0/24",
  "196.201.209.0/24",
  "196.201.208.0/24",
];

/** Convert a dotted-decimal IPv4 string to a 32-bit unsigned integer. */
function ipToInt(ip: string): number {
  const parts = ip.split(".");
  if (parts.length !== 4) throw new Error(`Invalid IPv4: ${ip}`);
  return (
    ((parseInt(parts[0]!, 10) << 24) |
      (parseInt(parts[1]!, 10) << 16) |
      (parseInt(parts[2]!, 10) << 8) |
      parseInt(parts[3]!, 10)) >>>
    0
  );
}

interface ParsedCidr {
  network: number;
  mask: number;
}

/** Parse a CIDR string (e.g. "196.201.214.0/24") into network + mask integers. */
function parseCidr(cidr: string): ParsedCidr {
  const [addr, prefixStr] = cidr.trim().split("/");
  if (!addr) throw new Error(`Invalid CIDR: ${cidr}`);
  const network = ipToInt(addr);
  const prefix = prefixStr !== undefined ? parseInt(prefixStr, 10) : 32;
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return { network: (network & mask) >>> 0, mask };
}

/** Return true if `ip` falls within the given CIDR block. */
function ipInCidr(ip: string, { network, mask }: ParsedCidr): boolean {
  try {
    return (ipToInt(ip) & mask) >>> 0 === network;
  } catch {
    return false;
  }
}

/** Strip IPv6-mapped IPv4 prefix (::ffff:) so we always work with plain IPv4. */
function normalizeIp(raw: string): string {
  return raw.startsWith("::ffff:") ? raw.slice(7) : raw;
}

/**
 * Build the list of allowed CIDRs from the environment (or fall back to the
 * hard-coded Safaricom ranges).
 *
 * MPESA_ALLOWED_IPS accepts a comma-separated list of CIDRs or plain IPs.
 * A plain IP (no prefix) is treated as /32.
 *
 * Example:
 *   MPESA_ALLOWED_IPS=196.201.214.0/24,196.201.216.0/24
 */
function buildAllowList(): ParsedCidr[] {
  const raw = process.env["MPESA_ALLOWED_IPS"];
  const entries = raw
    ? raw.split(",").map((s) => s.trim()).filter(Boolean)
    : DEFAULT_SAFARICOM_CIDRS;

  return entries.map((entry) => {
    const cidr = entry.includes("/") ? entry : `${entry}/32`;
    return parseCidr(cidr);
  });
}

/**
 * Express middleware that restricts access to Safaricom's known IP ranges.
 *
 * Reads the caller IP from `req.ip` (which respects `app.set("trust proxy")`).
 * Responds with 403 and logs a warning if the IP is not in the allow-list.
 *
 * Configure allowed ranges via the MPESA_ALLOWED_IPS environment variable
 * (comma-separated CIDRs). Defaults to Safaricom's published outbound ranges.
 *
 * Set MPESA_ALLOWED_IPS=* to disable IP checking entirely (e.g. in sandbox
 * environments where callbacks originate from unknown IPs).
 */
export function requireSafaricomIp(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (process.env["MPESA_ALLOWED_IPS"] === "*") {
    next();
    return;
  }

  const raw = req.ip ?? "";
  const callerIp = normalizeIp(raw);

  const allowList = buildAllowList();
  const allowed = allowList.some((cidr) => ipInCidr(callerIp, cidr));

  if (!allowed) {
    req.log.warn({ callerIp }, "M-Pesa callback rejected: IP not in Safaricom allowlist");
    res.status(403).json({ error: "Forbidden: request origin not permitted" });
    return;
  }

  next();
}
