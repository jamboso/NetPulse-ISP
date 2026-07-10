/**
 * Network Map API
 *
 * GET  /api/network-map          — all clients + splitters with location + live session data
 * GET  /api/splitters            — list splitters
 * POST /api/splitters            — create splitter
 * PUT  /api/splitters/:id        — update splitter
 * DELETE /api/splitters/:id      — delete splitter
 * PATCH /api/customers/:id/location — update customer lat/lng only
 */

import { Router } from "express";
import { db } from "@workspace/db";
import {
  customersTable, subscriptionsTable, plansTable,
  sessionLogsTable, routersTable, splittersTable,
} from "@workspace/db";
import { eq, isNotNull, isNull, and } from "drizzle-orm";
import { resolveCompanyScope } from "../middlewares/companyScope";

const router = Router();
router.use(resolveCompanyScope);

// ── MAC vendor lookup (reuse the cache from mac-vendor route) ─────────────────
const vendorCache = new Map<string, string>();
async function getVendor(mac: string | null): Promise<string | null> {
  if (!mac) return null;
  const prefix = mac.replace(/[^a-fA-F0-9]/g, "").slice(0, 6).toUpperCase();
  if (vendorCache.has(prefix)) return vendorCache.get(prefix) ?? null;
  try {
    const r = await fetch(`https://api.macvendors.com/${encodeURIComponent(mac)}`, { signal: AbortSignal.timeout(2000) });
    if (!r.ok) { vendorCache.set(prefix, ""); return null; }
    const vendor = (await r.text()).trim();
    vendorCache.set(prefix, vendor);
    return vendor || null;
  } catch {
    return null;
  }
}

// ── Network Map overview ──────────────────────────────────────────────────────

router.get("/network-map", async (req, res) => {
  const companyId = req.companyId;
  // Customers with coords
  const customers = await db
    .select({
      id:        customersTable.id,
      name:      customersTable.name,
      phone:     customersTable.phone,
      address:   customersTable.address,
      status:    customersTable.status,
      latitude:  customersTable.latitude,
      longitude: customersTable.longitude,
    })
    .from(customersTable)
    .where(and(
      isNotNull(customersTable.latitude),
      isNotNull(customersTable.longitude),
      companyId != null ? eq(customersTable.companyId, companyId) : undefined,
    ));

  if (customers.length === 0) {
    const splitters = await db.select().from(splittersTable);
    res.json({ clients: [], splitters });
    return;
  }

  const customerIds = customers.map(c => c.id);

  // Active subscriptions for these customers
  const subs = await db
    .select({
      customerId:    subscriptionsTable.customerId,
      id:            subscriptionsTable.id,
      pppoeUsername: subscriptionsTable.pppoeUsername,
      planId:        subscriptionsTable.planId,
      status:        subscriptionsTable.status,
      routerId:      subscriptionsTable.routerId,
    })
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.status, "active"));

  // Plans
  const plans = await db.select({ id: plansTable.id, name: plansTable.name, price: plansTable.price }).from(plansTable);
  const planMap = new Map(plans.map(p => [p.id, p]));

  // Open session logs (not ended = currently online)
  const openSessions = await db
    .select({
      subscriptionId: sessionLogsTable.subscriptionId,
      ipAddress:      sessionLogsTable.ipAddress,
      macAddress:     sessionLogsTable.macAddress,
      sessionStart:   sessionLogsTable.sessionStart,
      bytesIn:        sessionLogsTable.bytesIn,
      bytesOut:       sessionLogsTable.bytesOut,
      routerName:     sessionLogsTable.routerName,
    })
    .from(sessionLogsTable)
    .where(isNull(sessionLogsTable.sessionEnd));

  const sessionBySubId = new Map(openSessions.map(s => [s.subscriptionId, s]));

  // Build customer sub map
  const subByCustomer = new Map<number, typeof subs[0]>();
  for (const s of subs) {
    if (!subByCustomer.has(s.customerId)) subByCustomer.set(s.customerId, s);
  }

  // Fetch vendors for online sessions (batch, limit vendor calls)
  const macs = [...new Set(openSessions.map(s => s.macAddress).filter(Boolean) as string[])].slice(0, 30);
  await Promise.all(macs.map(mac => getVendor(mac)));

  // Compose client features
  const clients = customers.map(c => {
    const sub     = subByCustomer.get(c.id);
    const session = sub ? sessionBySubId.get(sub.id) : undefined;
    const plan    = sub ? planMap.get(sub.planId) : undefined;

    let uptimeSecs: number | null = null;
    if (session?.sessionStart) {
      uptimeSecs = Math.floor((Date.now() - new Date(session.sessionStart).getTime()) / 1000);
    }

    const vendor = session?.macAddress ? (vendorCache.get(
      session.macAddress.replace(/[^a-fA-F0-9]/g, "").slice(0, 6).toUpperCase()
    ) ?? null) : null;

    return {
      id:            c.id,
      name:          c.name,
      phone:         c.phone,
      address:       c.address,
      status:        c.status,
      latitude:      c.latitude!,
      longitude:     c.longitude!,
      // subscription
      pppoeUsername: sub?.pppoeUsername ?? null,
      subStatus:     sub?.status ?? null,
      planName:      plan?.name ?? null,
      planPrice:     plan ? Number(plan.price) : null,
      routerId:      sub?.routerId ?? null,
      // session
      online:        !!session,
      ipAddress:     session?.ipAddress ?? null,
      macAddress:    session?.macAddress ?? null,
      deviceVendor:  vendor,
      uptimeSecs,
      routerName:    session?.routerName ?? null,
      bytesIn:       session?.bytesIn ?? null,
      bytesOut:      session?.bytesOut ?? null,
    };
  });

  const splitters = await db
    .select({
      id:          splittersTable.id,
      name:        splittersTable.name,
      description: splittersTable.description,
      latitude:    splittersTable.latitude,
      longitude:   splittersTable.longitude,
      routerId:    splittersTable.routerId,
      capacity:    splittersTable.capacity,
      location:    splittersTable.location,
      fiberColor:  splittersTable.fiberColor,
    })
    .from(splittersTable)
    .where(and(isNotNull(splittersTable.latitude), isNotNull(splittersTable.longitude)));

  res.json({ clients, splitters });
});

// ── Splitter CRUD ─────────────────────────────────────────────────────────────

router.get("/splitters", async (_req, res) => {
  const rows = await db
    .select({
      s: splittersTable,
      routerName: routersTable.name,
    })
    .from(splittersTable)
    .leftJoin(routersTable, eq(splittersTable.routerId, routersTable.id))
    .orderBy(splittersTable.name);
  res.json(rows.map(r => ({ ...r.s, routerName: r.routerName ?? null })));
});

router.post("/splitters", async (req, res) => {
  const { name, description, latitude, longitude, routerId, capacity, location, fiberColor } =
    req.body as Partial<{ name: string; description: string; latitude: number; longitude: number; routerId: number; capacity: number; location: string; fiberColor: string }>;
  if (!name?.trim()) { res.status(400).json({ error: "name required" }); return; }
  const [row] = await db.insert(splittersTable).values({
    name, description: description ?? null,
    latitude: latitude ?? null, longitude: longitude ?? null,
    routerId: routerId ?? null, capacity: capacity ?? 8,
    location: location ?? null, fiberColor: fiberColor ?? null,
  }).returning();
  res.status(201).json(row);
});

router.put("/splitters/:id", async (req, res) => {
  const id = parseInt(req.params.id!);
  const body = req.body as Partial<{ name: string; description: string; latitude: number; longitude: number; routerId: number; capacity: number; location: string; fiberColor: string }>;
  const [row] = await db.update(splittersTable)
    .set({
      ...(body.name        !== undefined && { name:        body.name }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.latitude    !== undefined && { latitude:    body.latitude }),
      ...(body.longitude   !== undefined && { longitude:   body.longitude }),
      ...(body.routerId    !== undefined && { routerId:    body.routerId }),
      ...(body.capacity    !== undefined && { capacity:    body.capacity }),
      ...(body.location    !== undefined && { location:    body.location }),
      ...(body.fiberColor  !== undefined && { fiberColor:  body.fiberColor }),
    })
    .where(eq(splittersTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.delete("/splitters/:id", async (req, res) => {
  await db.delete(splittersTable).where(eq(splittersTable.id, parseInt(req.params.id!)));
  res.status(204).end();
});

// ── Customer location update ───────────────────────────────────────────────────

router.patch("/customers/:id/location", async (req, res) => {
  const id = parseInt(req.params.id!);
  const { latitude, longitude } = req.body as { latitude?: number; longitude?: number };
  const [row] = await db.update(customersTable)
    .set({ latitude: latitude ?? null, longitude: longitude ?? null })
    .where(
      req.companyId != null
        ? and(eq(customersTable.id, id), eq(customersTable.companyId, req.companyId))
        : eq(customersTable.id, id),
    )
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

export default router;
