/**
 * System Monitoring API
 *
 * GET /api/monitoring/overview
 *   - Router reachability + resource stats
 *   - ONU/mass-disconnect failure events (>5 drops in same 5-min window)
 *   - Account flapping alerts (>5 sessions per subscription in 24 h)
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { routersTable, sessionLogsTable, subscriptionsTable, customersTable } from "@workspace/db";
import { gte, desc, isNotNull, and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { getRouterManagementHost } from "../lib/routerManagement";

const router = Router();

// ── RouterOS ping helper (3-second timeout) ───────────────────────────────────

async function pingRouter(r: {
  ipAddress: string; apiSsl: boolean | null;
  username: string; password: string;
}): Promise<{ online: boolean; identity: string | null; cpu: number | null; memory: number | null; uptime: string | null; version: string | null; model: string | null }> {
  const scheme = r.apiSsl ? "https" : "http";
  const url    = `${scheme}://${r.ipAddress}/rest/system/resource`;
  const creds  = Buffer.from(`${r.username}:${r.password}`).toString("base64");
  const ctrl   = new AbortController();
  const timer  = setTimeout(() => ctrl.abort(), 3500);

  try {
    const res  = await fetch(url, {
      headers: { Authorization: `Basic ${creds}`, Accept: "application/json" },
      signal:  ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { online: false, identity: null, cpu: null, memory: null, uptime: null, version: null, model: null };
    const d    = await res.json() as Record<string, string>;
    const totalMem = parseInt(d["total-memory"] ?? "0") || 1;
    const freeMem  = parseInt(d["free-memory"]  ?? "0") || 0;
    return {
      online:   true,
      identity: null,
      cpu:      parseInt(d["cpu-load"] ?? "0") || 0,
      memory:   Math.round(((totalMem - freeMem) / totalMem) * 100),
      uptime:   d["uptime"] ?? null,
      version:  d["version"] ?? null,
      model:    d["board-name"] ?? null,
    };
  } catch {
    clearTimeout(timer);
    return { online: false, identity: null, cpu: null, memory: null, uptime: null, version: null, model: null };
  }
}

// ── ONU failure detector ──────────────────────────────────────────────────────
// A "mass disconnect event" = ≥5 sessions closed within the same 5-minute bucket
// on the same router within the last 24 hours.

interface OnuEvent {
  routerName: string;
  bucket:     string;   // ISO timestamp of the 5-min bucket start
  count:      number;
  usernames:  string[];
}

async function detectOnuFailures(thresholdCount = 5, allowedRouterNames?: Set<string>): Promise<OnuEvent[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Pull all closed sessions in last 24 h where we know which router
  const allRows = await db
    .select({
      routerName:   sessionLogsTable.routerName,
      pppoeUsername: sessionLogsTable.pppoeUsername,
      sessionEnd:   sessionLogsTable.sessionEnd,
    })
    .from(sessionLogsTable)
    .where(and(
      gte(sessionLogsTable.sessionEnd, since),
      isNotNull(sessionLogsTable.sessionEnd),
      isNotNull(sessionLogsTable.routerName),
    ))
    .orderBy(sessionLogsTable.sessionEnd);

  const rows = allowedRouterNames
    ? allRows.filter(r => r.routerName != null && allowedRouterNames.has(r.routerName))
    : allRows;

  // Group into 5-minute buckets per router
  type Bucket = { count: number; usernames: string[] };
  const buckets = new Map<string, Bucket>();

  for (const row of rows) {
    const end   = new Date(row.sessionEnd!);
    const ms    = end.getTime();
    const fiveM = Math.floor(ms / (5 * 60 * 1000)) * (5 * 60 * 1000);
    const key   = `${row.routerName ?? ""}||${fiveM}`;
    const existing = buckets.get(key) ?? { count: 0, usernames: [] };
    existing.count++;
    if (row.pppoeUsername) existing.usernames.push(row.pppoeUsername);
    buckets.set(key, existing);
  }

  const events: OnuEvent[] = [];
  for (const [key, b] of buckets) {
    if (b.count < thresholdCount) continue;
    const [routerName, msStr] = key.split("||");
    events.push({
      routerName: routerName ?? "Unknown",
      bucket:     new Date(parseInt(msStr!)).toISOString(),
      count:      b.count,
      usernames:  b.usernames.slice(0, 20),
    });
  }

  // Sort newest first
  return events.sort((a, b) => new Date(b.bucket).getTime() - new Date(a.bucket).getTime()).slice(0, 50);
}

// ── Account flapping detector ─────────────────────────────────────────────────
// Flapping = same subscription has >5 sessions started in last 24 h

interface FlappingAccount {
  customerId:    number;
  customerName:  string;
  pppoeUsername: string;
  routerName:    string | null;
  sessionCount:  number;
  lastSeen:      string;
}

async function detectFlapping(thresholdCount = 5, allowedRouterNames?: Set<string>): Promise<FlappingAccount[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Count sessions per subscription in last 24 h
  const allRows = await db
    .select({
      subscriptionId: sessionLogsTable.subscriptionId,
      pppoeUsername:  sessionLogsTable.pppoeUsername,
      routerName:     sessionLogsTable.routerName,
      count:          sql<number>`count(*)::int`,
      lastSeen:       sql<string>`max(${sessionLogsTable.sessionStart})`,
    })
    .from(sessionLogsTable)
    .where(gte(sessionLogsTable.sessionStart, since))
    .groupBy(sessionLogsTable.subscriptionId, sessionLogsTable.pppoeUsername, sessionLogsTable.routerName)
    .orderBy(desc(sql`count(*)`));

  const rows = allowedRouterNames
    ? allRows.filter(r => r.routerName != null && allowedRouterNames.has(r.routerName))
    : allRows;

  const flapping = rows.filter(r => r.count > thresholdCount);
  if (flapping.length === 0) return [];

  // Join to customer names
  const subIds = flapping.map(r => r.subscriptionId);
  const subs = await db
    .select({ id: subscriptionsTable.id, customerId: subscriptionsTable.customerId })
    .from(subscriptionsTable)
    .where(sql`${subscriptionsTable.id} = ANY(${sql.raw(`ARRAY[${subIds.join(",")}]::int[]`)})`)
    .catch(() => [] as { id: number; customerId: number }[]);

  const customerIds = [...new Set(subs.map(s => s.customerId))];
  const customers = customerIds.length > 0
    ? await db
        .select({ id: customersTable.id, name: customersTable.name })
        .from(customersTable)
        .where(sql`${customersTable.id} = ANY(${sql.raw(`ARRAY[${customerIds.join(",")}]::int[]`)})`)
        .catch(() => [] as { id: number; name: string }[])
    : [];

  const subMap = new Map(subs.map(s => [s.id, s.customerId]));
  const custMap = new Map(customers.map(c => [c.id, c.name]));

  return flapping.map(r => {
    const custId = subMap.get(r.subscriptionId) ?? 0;
    return {
      customerId:    custId,
      customerName:  custMap.get(custId) ?? "Unknown",
      pppoeUsername: r.pppoeUsername ?? "—",
      routerName:    r.routerName,
      sessionCount:  r.count,
      lastSeen:      r.lastSeen,
    };
  });
}

// ── Route ─────────────────────────────────────────────────────────────────────

router.get("/monitoring/overview", async (req, res) => {
  const onu_threshold   = parseInt(req.query.onu_threshold   as string || "5");
  const flap_threshold  = parseInt(req.query.flap_threshold  as string || "5");

  // Load routers scoped to the requesting company (owners with no companyId see all)
  const allRouters = req.companyId != null
    ? await db
        .select({
          id:        routersTable.id,
          name:      routersTable.name,
          ipAddress: routersTable.ipAddress,
          apiSsl:    routersTable.apiSsl,
          username:  routersTable.username,
          password:  routersTable.password,
          enabled:   routersTable.enabled,
          location:  routersTable.location,
          routerType: routersTable.routerType,
          lastSeen:  routersTable.lastSeen,
          vpnIp:        routersTable.vpnIp,
          vpnConnected: routersTable.vpnConnected,
        })
        .from(routersTable)
        .where(eq(routersTable.companyId, req.companyId))
        .orderBy(routersTable.name)
    : await db
        .select({
          id:        routersTable.id,
          name:      routersTable.name,
          ipAddress: routersTable.ipAddress,
          apiSsl:    routersTable.apiSsl,
          username:  routersTable.username,
          password:  routersTable.password,
          enabled:   routersTable.enabled,
          location:  routersTable.location,
          routerType: routersTable.routerType,
          lastSeen:  routersTable.lastSeen,
          vpnIp:        routersTable.vpnIp,
          vpnConnected: routersTable.vpnConnected,
        })
        .from(routersTable)
        .orderBy(routersTable.name);

  const allowedRouterNames = req.companyId != null
    ? new Set(allRouters.map(r => r.name))
    : undefined;

  // Ping all RouterOS routers in parallel; non-ROS just show as unknown
  const [pinged, onuEvents, flapping] = await Promise.all([
    Promise.all(
      allRouters.map(async r => {
        if (r.routerType !== "routeros" || !r.enabled) {
          return { ...r, online: false, cpu: null, memory: null, uptime: null, version: null, model: null };
        }
        const managementHost = getRouterManagementHost(r);
        if (!managementHost) {
          return { ...r, online: false, cpu: null, memory: null, uptime: null, version: null, model: null };
        }
        const stats = await pingRouter({ ...r, ipAddress: managementHost });
        return { ...r, ...stats };
      })
    ),
    detectOnuFailures(onu_threshold, allowedRouterNames),
    detectFlapping(flap_threshold, allowedRouterNames),
  ]);

  const onlineCount  = pinged.filter(r => r.online).length;
  const offlineCount = pinged.filter(r => !r.online && r.enabled).length;

  res.json({
    fetchedAt:    new Date().toISOString(),
    summary: {
      totalRouters:  allRouters.length,
      onlineRouters: onlineCount,
      offlineRouters: offlineCount,
      onuEvents:     onuEvents.length,
      flappingAccounts: flapping.length,
    },
    routers:   pinged.map(r => ({
      id:        r.id,
      name:      r.name,
      ipAddress: r.ipAddress,
      location:  r.location,
      routerType: r.routerType,
      enabled:   r.enabled,
      online:    r.online,
      cpu:       r.cpu,
      memory:    r.memory,
      uptime:    r.uptime,
      version:   r.version,
      model:     r.model,
      lastSeen:  r.lastSeen,
    })),
    onuEvents,
    flappingAccounts: flapping,
  });
});

export default router;
