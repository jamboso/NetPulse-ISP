import type { Request, Response, NextFunction } from "express";
import { db, settingsTable, securityEventsTable, blockedIpsTable } from "@workspace/db";
import { eq, gte, and, gt } from "drizzle-orm";
import { sql } from "drizzle-orm";

/**
 * Number of blocked attempts within the rolling window before an IP is auto-blocked.
 * Override with MPESA_BLOCK_THRESHOLD env var.
 */
const BLOCK_THRESHOLD = parseInt(process.env["MPESA_BLOCK_THRESHOLD"] ?? "10", 10);

/**
 * Rolling window in milliseconds to count blocked attempts (default: 1 hour).
 * Override with MPESA_BLOCK_WINDOW_MINUTES env var.
 */
const BLOCK_WINDOW_MS =
  parseInt(process.env["MPESA_BLOCK_WINDOW_MINUTES"] ?? "60", 10) * 60 * 1000;

/**
 * How long a temporary block lasts in hours (default: 24 hours).
 * Override with MPESA_BLOCK_DURATION_HOURS env var.
 */
const BLOCK_DURATION_HOURS = parseInt(process.env["MPESA_BLOCK_DURATION_HOURS"] ?? "24", 10);

/**
 * Safaricom's published outbound IP ranges for Daraja API callbacks.
 * Source: https://developer.safaricom.co.ke/docs#callback-urls
 * Used as the default when neither the DB setting nor MPESA_ALLOWED_IPS is set.
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
 * Parse a comma-separated list of CIDRs/IPs into ParsedCidr entries.
 * Plain IPs (no prefix) are treated as /32.
 */
function parseCidrList(raw: string): ParsedCidr[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const cidr = entry.includes("/") ? entry : `${entry}/32`;
      return parseCidr(cidr);
    });
}

/**
 * Fetch the allowed CIDR list, checking in priority order:
 *   1. DB setting `mpesaAllowedIps` (updated live via Settings UI)
 *   2. MPESA_ALLOWED_IPS environment variable
 *   3. Hard-coded Safaricom default ranges
 *
 * Returns the wildcard sentinel "*" if bypass is configured at any level.
 */
async function fetchAllowList(): Promise<ParsedCidr[] | "*"> {
  // 1. DB lookup — changes take effect on next request without restart
  try {
    const rows = await db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.key, "mpesaAllowedIps"));
    const dbValue = rows[0]?.value?.trim();
    if (dbValue && dbValue.length > 0) {
      if (dbValue === "*") return "*";
      return parseCidrList(dbValue);
    }
  } catch {
    // DB unavailable — fall through to env var
  }

  // 2. Environment variable fallback
  const envValue = process.env["MPESA_ALLOWED_IPS"];
  if (envValue) {
    if (envValue === "*") return "*";
    return parseCidrList(envValue);
  }

  // 3. Default Safaricom published ranges
  return DEFAULT_SAFARICOM_CIDRS.map((cidr) => parseCidr(cidr));
}

/**
 * Check whether the given IP is currently in the temporary block list.
 * Returns the blocked_ips row if the IP is blocked and the block has not expired,
 * or null if the IP is not blocked.
 */
async function getActiveBlock(ip: string) {
  try {
    const now = new Date();
    const rows = await db
      .select()
      .from(blockedIpsTable)
      .where(
        and(
          eq(blockedIpsTable.ip, ip),
          gt(blockedIpsTable.expiresAt, now)
        )
      )
      .limit(1);
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Persist a blocked callback attempt to the security_events table.
 * Failures are swallowed so a DB hiccup never affects the 403 response.
 */
async function recordBlockedAttempt(
  req: Request,
  callerIp: string,
  reason: string
): Promise<void> {
  try {
    await db.insert(securityEventsTable).values({
      eventType: "blocked_callback",
      callerIp,
      endpoint: req.path,
      method: req.method,
      reason,
    });
  } catch {
    // Non-fatal — best-effort logging
  }
}

/**
 * After recording a blocked attempt, count how many blocked_callback events
 * came from this IP within the rolling window. If the count reaches the
 * threshold, insert or refresh an auto-block entry in blocked_ips.
 */
async function maybeAutoBlock(req: Request, callerIp: string): Promise<void> {
  try {
    const since = new Date(Date.now() - BLOCK_WINDOW_MS);

    const [row] = await db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(securityEventsTable)
      .where(
        and(
          eq(securityEventsTable.callerIp, callerIp),
          eq(securityEventsTable.eventType, "blocked_callback"),
          gte(securityEventsTable.createdAt, since)
        )
      );

    const count = row?.count ?? 0;

    if (count >= BLOCK_THRESHOLD) {
      const expiresAt = new Date(Date.now() + BLOCK_DURATION_HOURS * 60 * 60 * 1000);
      const reason = `Auto-blocked: ${count} blocked attempts in the last ${Math.round(BLOCK_WINDOW_MS / 60000)} minutes`;

      await db
        .insert(blockedIpsTable)
        .values({ ip: callerIp, expiresAt, attemptCount: count, reason })
        .onConflictDoUpdate({
          target: blockedIpsTable.ip,
          set: {
            blockedAt: new Date(),
            expiresAt,
            attemptCount: count,
            reason,
          },
        });

      req.log.warn(
        { callerIp, count, expiresAt },
        "M-Pesa callback: IP auto-blocked after repeated forged attempts"
      );
    }
  } catch {
    // Non-fatal — auto-blocking failure should not affect the 403 response
  }
}

/**
 * Express middleware that restricts access to Safaricom's known IP ranges.
 *
 * Reads the caller IP from `req.ip` (which respects `app.set("trust proxy")`).
 * Responds with 403 and logs a warning if the IP is not in the allow-list.
 * Also writes a record to the `security_events` table for admin visibility.
 *
 * Additionally, if an IP accumulates ≥ BLOCK_THRESHOLD blocked attempts within
 * BLOCK_WINDOW_MS, it is automatically added to the `blocked_ips` table and
 * rejected immediately on subsequent requests until BLOCK_DURATION_HOURS elapses
 * (or until an admin manually unblocks it).
 *
 * Priority for allowed ranges (highest wins):
 *   1. `mpesaAllowedIps` setting in the DB (editable via Settings → M-Pesa Security)
 *   2. MPESA_ALLOWED_IPS environment variable
 *   3. Safaricom's published outbound CIDR ranges (default)
 *
 * Set the value to "*" at any level to disable IP checking (e.g. sandbox environments).
 */
export async function requireSafaricomIp(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const raw = req.ip ?? "";
  const callerIp = normalizeIp(raw);

  // Check auto-block list first (fast path — avoids allowlist DB lookup for repeat offenders)
  const activeBlock = await getActiveBlock(callerIp);
  if (activeBlock) {
    req.log.warn(
      { callerIp, expiresAt: activeBlock.expiresAt },
      "M-Pesa callback rejected: IP is temporarily blocked"
    );
    res.status(403).json({
      error: "Forbidden: IP temporarily blocked due to repeated forged callback attempts",
    });
    return;
  }

  const allowList = await fetchAllowList();

  if (allowList === "*") {
    next();
    return;
  }

  const allowed = allowList.some((cidr) => ipInCidr(callerIp, cidr));

  if (!allowed) {
    req.log.warn({ callerIp }, "M-Pesa callback rejected: IP not in Safaricom allowlist");
    await recordBlockedAttempt(req, callerIp, "IP not in Safaricom allowlist");
    // Fire auto-block check asynchronously — don't delay the 403 response
    maybeAutoBlock(req, callerIp).catch(() => {});
    res.status(403).json({ error: "Forbidden: request origin not permitted" });
    return;
  }

  next();
}
