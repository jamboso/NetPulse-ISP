/**
 * Session Poller — background job that runs every 5 minutes.
 *
 * For each online router it:
 *  1. Fetches ALL active PPPoE + Hotspot sessions in a single call
 *  2. Matches them to subscriptions by username
 *  3. Opens a new session_log when a subscriber connects
 *  4. Updates bytes on an already-open session_log
 *  5. Closes session_logs for subscribers that are no longer active
 *
 * This means compliance records are captured automatically — no browser
 * needs to be open.
 */

import { db } from "@workspace/db";
import {
  routersTable, subscriptionsTable, customersTable, sessionLogsTable,
} from "@workspace/db";
import { eq, isNull, and, inArray } from "drizzle-orm";
import { logger } from "./logger";

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// ── RouterOS helper (duplicated here so the poller has no circular deps) ──────

async function rosGet(
  ip: string, ssl: boolean, user: string, pass: string,
  path: string,
): Promise<unknown[]> {
  const scheme = ssl ? "https" : "http";
  const url = `${scheme}://${ip}/rest${path}`;
  const creds = Buffer.from(`${user}:${pass}`).toString("base64");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Basic ${creds}`, Accept: "application/json" },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const text = await res.text();
    const data = text.trim() ? JSON.parse(text) : [];
    return Array.isArray(data) ? data : [];
  } catch {
    clearTimeout(timer);
    return [];
  }
}

function parseUptime(uptime: string): number {
  if (!uptime) return 0;
  let secs = 0;
  const d = uptime.match(/(\d+)d/); if (d) secs += parseInt(d[1]!) * 86400;
  const h = uptime.match(/(\d+)h/); if (h) secs += parseInt(h[1]!) * 3600;
  const m = uptime.match(/(\d+)m/); if (m) secs += parseInt(m[1]!) * 60;
  const s = uptime.match(/(\d+)s/); if (s) secs += parseInt(s[1]!);
  return secs;
}

// ── Core poll function ────────────────────────────────────────────────────────

async function pollRouter(router: {
  id: number;
  name: string;
  ipAddress: string;
  apiSsl: boolean | null;
  username: string;
  password: string;
}): Promise<void> {
  const { id: routerId, name: routerName, ipAddress, apiSsl, username, password } = router;

  // Fetch all active sessions from this router in parallel
  const [pppoeList, hotspotList] = await Promise.all([
    rosGet(ipAddress, apiSsl ?? false, username, password, "/ppp/active"),
    rosGet(ipAddress, apiSsl ?? false, username, password, "/ip/hotspot/active"),
  ]);

  // Build a map: username → session data
  const activeSessions = new Map<string, {
    type: "pppoe" | "hotspot";
    ip: string | null;
    mac: string | null;
    bytesIn: number;
    bytesOut: number;
  }>();

  for (const s of pppoeList as any[]) {
    if (!s.name) continue;
    let bytesIn  = parseInt(s["bytes-in"]  ?? "0") || 0;
    let bytesOut = parseInt(s["bytes-out"] ?? "0") || 0;
    // RouterOS sometimes omits bytes from /ppp/active — try virtual interface
    if (bytesIn === 0 && bytesOut === 0) {
      try {
        const ifaces = await rosGet(
          ipAddress, apiSsl ?? false, username, password,
          `/interface?name=${encodeURIComponent(`<pppoe-${s.name}>`)}`
        ) as any[];
        if (ifaces[0]) {
          bytesIn  = parseInt(ifaces[0]["rx-byte"] ?? "0") || 0;
          bytesOut = parseInt(ifaces[0]["tx-byte"] ?? "0") || 0;
        }
      } catch { /* ignore */ }
    }
    activeSessions.set(s.name, {
      type: "pppoe",
      ip:  s.address ?? null,
      mac: s["caller-id"] ?? null,
      bytesIn,
      bytesOut,
    });
  }

  for (const s of hotspotList as any[]) {
    if (!s.user) continue;
    activeSessions.set(s.user, {
      type: "hotspot",
      ip:  s.address ?? null,
      mac: s["mac-address"] ?? null,
      bytesIn:  parseInt(s["bytes-in"]  ?? "0") || 0,
      bytesOut: parseInt(s["bytes-out"] ?? "0") || 0,
    });
  }

  // Get all subscriptions assigned to this router that have a PPPoE username
  const subs = await db
    .select({
      id:            subscriptionsTable.id,
      customerId:    subscriptionsTable.customerId,
      pppoeUsername: subscriptionsTable.pppoeUsername,
    })
    .from(subscriptionsTable)
    .where(and(
      eq(subscriptionsTable.routerId, routerId),
    ));

  const subsWithUsername = subs.filter(s => s.pppoeUsername);
  if (subsWithUsername.length === 0) return;

  const subIds = subsWithUsername.map(s => s.id);

  // Get all currently-open session logs for these subscriptions
  const openLogs = await db
    .select({
      id:             sessionLogsTable.id,
      subscriptionId: sessionLogsTable.subscriptionId,
    })
    .from(sessionLogsTable)
    .where(and(
      inArray(sessionLogsTable.subscriptionId, subIds),
      isNull(sessionLogsTable.sessionEnd),
    ));

  const openLogMap = new Map(openLogs.map(l => [l.subscriptionId, l.id]));

  // Process each subscription
  for (const sub of subsWithUsername) {
    const session = activeSessions.get(sub.pppoeUsername!);

    if (session) {
      // Subscriber is ONLINE
      const openLogId = openLogMap.get(sub.id);
      if (openLogId) {
        // Update bytes on existing open session
        await db
          .update(sessionLogsTable)
          .set({ bytesIn: session.bytesIn, bytesOut: session.bytesOut })
          .where(eq(sessionLogsTable.id, openLogId));
      } else {
        // New connection — create session log
        await db.insert(sessionLogsTable).values({
          customerId:    sub.customerId,
          subscriptionId: sub.id,
          pppoeUsername:  sub.pppoeUsername,
          ipAddress:      session.ip,
          macAddress:     session.mac,
          sessionType:    session.type,
          routerName:     routerName,
          bytesIn:        session.bytesIn,
          bytesOut:       session.bytesOut,
        });
        logger.info(
          { sub: sub.id, user: sub.pppoeUsername, router: routerName },
          "Session opened"
        );
      }
    } else {
      // Subscriber is OFFLINE — close any open session log
      const openLogId = openLogMap.get(sub.id);
      if (openLogId) {
        await db
          .update(sessionLogsTable)
          .set({ sessionEnd: new Date() })
          .where(eq(sessionLogsTable.id, openLogId));
        logger.info(
          { sub: sub.id, user: sub.pppoeUsername, router: routerName },
          "Session closed"
        );
      }
    }
  }
}

// ── Poll all routers ──────────────────────────────────────────────────────────

async function pollAllRouters(): Promise<void> {
  const routers = await db
    .select({
      id:        routersTable.id,
      name:      routersTable.name,
      ipAddress: routersTable.ipAddress,
      apiSsl:    routersTable.apiSsl,
      username:  routersTable.username,
      password:  routersTable.password,
    })
    .from(routersTable);

  if (routers.length === 0) return;

  logger.info({ count: routers.length }, "Session poller: polling routers");

  const results = await Promise.allSettled(routers.map(pollRouter));
  const failed = results.filter(r => r.status === "rejected");
  if (failed.length > 0) {
    for (const f of failed) {
      logger.warn({ err: (f as PromiseRejectedResult).reason }, "Session poller: router poll failed");
    }
  }
}

// ── Start the poller ──────────────────────────────────────────────────────────

export function startSessionPoller(): void {
  // Run once immediately on startup, then every 5 minutes
  pollAllRouters().catch(err =>
    logger.warn({ err }, "Session poller: initial poll failed")
  );

  setInterval(() => {
    pollAllRouters().catch(err =>
      logger.warn({ err }, "Session poller: poll failed")
    );
  }, POLL_INTERVAL_MS);

  logger.info({ intervalMs: POLL_INTERVAL_MS }, "Session poller started");
}
