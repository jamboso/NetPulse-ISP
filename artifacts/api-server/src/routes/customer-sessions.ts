import { Router } from "express";
import { db } from "@workspace/db";
import {
  subscriptionsTable, routersTable, customersTable,
  usageSnapshotsTable,
} from "@workspace/db";
import { eq, desc, and, inArray } from "drizzle-orm";

const router = Router();

// ── RouterOS helper ───────────────────────────────────────────────────────────

async function rosReq(
  ip: string, ssl: boolean, user: string, pass: string,
  method: "GET" | "PUT" | "PATCH" | "DELETE",
  path: string, body?: object
): Promise<unknown> {
  const scheme = ssl ? "https" : "http";
  const url = `${scheme}://${ip}/rest${path}`;
  const creds = Buffer.from(`${user}:${pass}`).toString("base64");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Basic ${creds}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (res.status === 401) throw new Error("RouterOS authentication failed");
    if (res.status === 404) return method === "GET" ? [] : null;
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`RouterOS HTTP ${res.status}: ${t}`);
    }
    const text = await res.text();
    return text.trim() ? JSON.parse(text) : null;
  } catch (err: any) {
    clearTimeout(timer);
    if (err.name === "AbortError") throw new Error(`Timeout connecting to ${ip}`);
    throw err;
  }
}

// Parse RouterOS uptime string like "1d2h3m4s" into total seconds
function parseUptime(uptime: string): number {
  if (!uptime) return 0;
  let secs = 0;
  const d = uptime.match(/(\d+)d/); if (d) secs += parseInt(d[1]!) * 86400;
  const h = uptime.match(/(\d+)h/); if (h) secs += parseInt(h[1]!) * 3600;
  const m = uptime.match(/(\d+)m/); if (m) secs += parseInt(m[1]!) * 60;
  const s = uptime.match(/(\d+)s/); if (s) secs += parseInt(s[1]!);
  return secs;
}

// Format bytes into human-readable string
function fmtBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} KB`;
  return `${n} B`;
}

interface SessionResult {
  subscriptionId: number;
  planName: string | null;
  routerName: string | null;
  pppoeUsername: string | null;
  pppoePassword: string | null;
  ipAddress: string | null;
  status: "online" | "offline" | "no_router";
  uptimeSeconds: number;
  uptimeRaw: string | null;
  bytesIn: number;
  bytesOut: number;
  bytesInFormatted: string;
  bytesOutFormatted: string;
  callerMac: string | null;
  sessionType: "pppoe" | "hotspot" | "none";
  routerError: string | null;
}

// ── GET /api/customers/:id/sessions ──────────────────────────────────────────

router.get("/customers/:id/sessions", async (req, res) => {
  const customerId = parseInt(req.params.id!);

  const [customer] = await db.select({ id: customersTable.id })
    .from(customersTable).where(eq(customersTable.id, customerId));
  if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }

  const subs = await db
    .select({
      id: subscriptionsTable.id,
      pppoeUsername: subscriptionsTable.pppoeUsername,
      pppoePassword: subscriptionsTable.pppoePassword,
      ipAddress: subscriptionsTable.ipAddress,
      planId: subscriptionsTable.planId,
      routerId: subscriptionsTable.routerId,
      status: subscriptionsTable.status,
    })
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.customerId, customerId));

  if (subs.length === 0) { res.json([]); return; }

  // Fetch routers for all subs that have routerId
  const routerIds = [...new Set(subs.map(s => s.routerId).filter(Boolean))] as number[];
  const routers = routerIds.length > 0
    ? await db.select().from(routersTable).where(inArray(routersTable.id, routerIds))
    : [];

  const routerMap = new Map(routers.map(r => [r.id, r]));

  const results: SessionResult[] = await Promise.all(
    subs.map(async (sub): Promise<SessionResult> => {
      const router = sub.routerId ? routerMap.get(sub.routerId) : null;

      if (!router || !sub.pppoeUsername) {
        return {
          subscriptionId: sub.id,
          planName: null,
          routerName: router?.name ?? null,
          pppoeUsername: sub.pppoeUsername ?? null,
          pppoePassword: sub.pppoePassword ?? null,
          ipAddress: sub.ipAddress ?? null,
          status: "no_router",
          uptimeSeconds: 0,
          uptimeRaw: null,
          bytesIn: 0,
          bytesOut: 0,
          bytesInFormatted: "0 B",
          bytesOutFormatted: "0 B",
          callerMac: null,
          sessionType: "none",
          routerError: null,
        };
      }

      const { ipAddress: ip, apiSsl: ssl, username: user, password: pass } = router;

      // Try PPPoE active first, then Hotspot active
      try {
        const [pppoeActive, hotspotActive] = await Promise.all([
          rosReq(ip, ssl ?? false, user, pass, "GET", `/ppp/active?name=${encodeURIComponent(sub.pppoeUsername)}`).catch(() => []),
          rosReq(ip, ssl ?? false, user, pass, "GET", `/ip/hotspot/active?user=${encodeURIComponent(sub.pppoeUsername)}`).catch(() => []),
        ]);

        const pppoeList = Array.isArray(pppoeActive) ? pppoeActive as any[] : [];
        const hotspotList = Array.isArray(hotspotActive) ? hotspotActive as any[] : [];

        const pppoeSession = pppoeList.find((s: any) => s.name === sub.pppoeUsername);
        const hotspotSession = hotspotList.find((s: any) => s.user === sub.pppoeUsername);

        if (pppoeSession) {
          let bytesIn  = parseInt(pppoeSession["bytes-in"]  ?? "0") || 0;
          let bytesOut = parseInt(pppoeSession["bytes-out"] ?? "0") || 0;

          // RouterOS REST API often omits bytes-in/bytes-out from /ppp/active.
          // Fall back to the virtual PPPoE interface (<pppoe-USERNAME>) which
          // always exposes rx-byte / tx-byte as session counters.
          if (bytesIn === 0 && bytesOut === 0) {
            try {
              const ifaceName = `<pppoe-${sub.pppoeUsername}>`;
              const ifaceData = await rosReq(
                ip, ssl ?? false, user, pass, "GET",
                `/interface?name=${encodeURIComponent(ifaceName)}`
              ).catch(() => null);
              const iface = Array.isArray(ifaceData) ? (ifaceData as any[])[0] : null;
              if (iface) {
                bytesIn  = parseInt(iface["rx-byte"] ?? "0") || 0;
                bytesOut = parseInt(iface["tx-byte"] ?? "0") || 0;
              }
            } catch { /* ignore — keep 0 */ }
          }

          return {
            subscriptionId: sub.id,
            planName: null,
            routerName: router.name,
            pppoeUsername: sub.pppoeUsername,
            pppoePassword: sub.pppoePassword ?? null,
            ipAddress: pppoeSession.address ?? sub.ipAddress ?? null,
            status: "online",
            uptimeSeconds: parseUptime(pppoeSession.uptime ?? ""),
            uptimeRaw: pppoeSession.uptime ?? null,
            bytesIn,
            bytesOut,
            bytesInFormatted: fmtBytes(bytesIn),
            bytesOutFormatted: fmtBytes(bytesOut),
            callerMac: pppoeSession["caller-id"] ?? null,
            sessionType: "pppoe",
            routerError: null,
          };
        }

        if (hotspotSession) {
          const bytesIn = parseInt(hotspotSession["bytes-in"] ?? "0") || 0;
          const bytesOut = parseInt(hotspotSession["bytes-out"] ?? "0") || 0;
          return {
            subscriptionId: sub.id,
            planName: null,
            routerName: router.name,
            pppoeUsername: sub.pppoeUsername,
            pppoePassword: sub.pppoePassword ?? null,
            ipAddress: hotspotSession.address ?? sub.ipAddress ?? null,
            status: "online",
            uptimeSeconds: parseUptime(hotspotSession["session-time"] ?? ""),
            uptimeRaw: hotspotSession["session-time"] ?? null,
            bytesIn,
            bytesOut,
            bytesInFormatted: fmtBytes(bytesIn),
            bytesOutFormatted: fmtBytes(bytesOut),
            callerMac: hotspotSession["mac-address"] ?? null,
            sessionType: "hotspot",
            routerError: null,
          };
        }

        // Not found in active sessions → offline
        return {
          subscriptionId: sub.id,
          planName: null,
          routerName: router.name,
          pppoeUsername: sub.pppoeUsername,
          pppoePassword: sub.pppoePassword ?? null,
          ipAddress: sub.ipAddress ?? null,
          status: "offline",
          uptimeSeconds: 0,
          uptimeRaw: null,
          bytesIn: 0,
          bytesOut: 0,
          bytesInFormatted: "0 B",
          bytesOutFormatted: "0 B",
          callerMac: null,
          sessionType: "pppoe",
          routerError: null,
        };
      } catch (err: any) {
        return {
          subscriptionId: sub.id,
          planName: null,
          routerName: router.name,
          pppoeUsername: sub.pppoeUsername,
          pppoePassword: sub.pppoePassword ?? null,
          ipAddress: sub.ipAddress ?? null,
          status: "offline",
          uptimeSeconds: 0,
          uptimeRaw: null,
          bytesIn: 0,
          bytesOut: 0,
          bytesInFormatted: "0 B",
          bytesOutFormatted: "0 B",
          callerMac: null,
          sessionType: "pppoe",
          routerError: err.message,
        };
      }
    })
  );

  res.json(results);
});

// ── GET /api/customers/:id/usage-snapshots ───────────────────────────────────
// Returns last 48 snapshots per subscription (for usage graphs)

router.get("/customers/:id/usage-snapshots", async (req, res) => {
  const customerId = parseInt(req.params.id!);

  const subs = await db
    .select({ id: subscriptionsTable.id })
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.customerId, customerId));

  if (subs.length === 0) { res.json({}); return; }

  const subIds = subs.map(s => s.id);
  const snapshots = await db
    .select()
    .from(usageSnapshotsTable)
    .where(inArray(usageSnapshotsTable.subscriptionId, subIds))
    .orderBy(desc(usageSnapshotsTable.recordedAt))
    .limit(48 * subIds.length);

  // Group by subscriptionId, reverse to chronological order
  const grouped: Record<number, typeof snapshots> = {};
  for (const snap of snapshots) {
    if (!grouped[snap.subscriptionId]) grouped[snap.subscriptionId] = [];
    grouped[snap.subscriptionId]!.push(snap);
  }
  for (const id of Object.keys(grouped)) {
    grouped[parseInt(id)]!.reverse();
  }

  res.json(grouped);
});

// ── POST /api/customers/:id/sessions/snapshot ────────────────────────────────
// Called by frontend on each poll to persist a usage data point for graphing

router.post("/customers/:id/sessions/snapshot", async (req, res) => {
  const customerId = parseInt(req.params.id!);
  const { snapshots } = req.body as {
    snapshots: Array<{ subscriptionId: number; bytesIn: number; bytesOut: number }>;
  };

  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    res.status(400).json({ error: "snapshots array required" });
    return;
  }

  // Verify all subscriptions belong to this customer
  const subIds = snapshots.map(s => s.subscriptionId);
  const ownedSubs = await db
    .select({ id: subscriptionsTable.id })
    .from(subscriptionsTable)
    .where(and(
      eq(subscriptionsTable.customerId, customerId),
      inArray(subscriptionsTable.id, subIds)
    ));
  const ownedIds = new Set(ownedSubs.map(s => s.id));

  const toInsert = snapshots
    .filter(s => ownedIds.has(s.subscriptionId))
    .map(s => ({ subscriptionId: s.subscriptionId, bytesIn: s.bytesIn, bytesOut: s.bytesOut }));

  if (toInsert.length > 0) {
    await db.insert(usageSnapshotsTable).values(toInsert);
  }

  // Keep only last 100 snapshots per subscription to avoid unbounded growth
  for (const subId of ownedIds) {
    const old = await db
      .select({ id: usageSnapshotsTable.id })
      .from(usageSnapshotsTable)
      .where(eq(usageSnapshotsTable.subscriptionId, subId))
      .orderBy(desc(usageSnapshotsTable.recordedAt))
      .offset(100);
    if (old.length > 0) {
      await db.delete(usageSnapshotsTable).where(
        inArray(usageSnapshotsTable.id, old.map(o => o.id))
      );
    }
  }

  res.status(201).json({ saved: toInsert.length });
});

export default router;
