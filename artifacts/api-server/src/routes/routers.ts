import { Router } from "express";
import * as net from "net";
import { randomUUID } from "crypto";
import { db, routersTable, routerVpnCertsTable, vpnConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { upsertRadnas, removeRadnas } from "../lib/radiusSync";
import { generateClientCert } from "../lib/certGen";
import type { RouterVpnCert } from "@workspace/db";

const router = Router();

// ── TCP probe ─────────────────────────────────────────────────────────────────

function tcpProbe(host: string, port: number, timeoutMs = 1500): Promise<{ reachable: boolean; latencyMs: number | null }> {
  return new Promise((resolve) => {
    const start = Date.now();
    const sock = new net.Socket();
    let resolved = false;

    const done = (reachable: boolean) => {
      if (resolved) return;
      resolved = true;
      sock.destroy();
      resolve({ reachable, latencyMs: reachable ? Date.now() - start : null });
    };

    sock.setTimeout(timeoutMs);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false));
    sock.connect(port, host);
  });
}

function probePort(r: typeof routersTable.$inferSelect): number {
  if (r.routerType === "routeros") return r.port ?? (r.apiSsl ? 8729 : 8728);
  if (r.routerType === "juniper") return r.sshPort ?? r.netconfPort ?? 22;
  return r.sshPort ?? 22;
}

// ── Auto-provision helper ─────────────────────────────────────────────────────
// After creating a RouterOS router, automatically generate VPN cert + token
// so the admin immediately gets a bootstrap command to copy-paste.
async function autoProvision(routerId: number, routerName: string, log: { info: (...args: unknown[]) => void }): Promise<void> {
  try {
    const [vpnCfg] = await db.select().from(vpnConfigTable).limit(1);
    if (!vpnCfg?.caCert || !vpnCfg?.caKey) return; // VPN not set up yet — skip silently

    const cn = `netpulse-${routerName.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase()}`;
    log.info(`[auto-provision] Generating VPN cert for router ${routerId} (${cn})`);
    const clientCert = await generateClientCert(cn, vpnCfg.caCert, vpnCfg.caKey);

    // Assign next available VPN IP in subnet
    const allCerts = await db.select().from(routerVpnCertsTable);
    const usedIps = new Set((allCerts as RouterVpnCert[]).map(c => c.vpnIp).filter(Boolean));
    const subnet = vpnCfg.vpnSubnet ?? "10.8.0.0";
    const base = subnet.split(".").slice(0, 3).join(".");
    let vpnIp = "";
    for (let i = 2; i <= 254; i++) {
      const candidate = `${base}.${i}`;
      if (!usedIps.has(candidate)) { vpnIp = candidate; break; }
    }

    const existing = await db.select().from(routerVpnCertsTable).where(eq(routerVpnCertsTable.routerId, routerId));
    if (existing.length > 0) {
      await db.update(routerVpnCertsTable).set({
        clientCert: clientCert.cert,
        clientKey: clientCert.key,
        vpnIp,
        routerName,
        revokedAt: null,
        createdAt: new Date(),
      }).where(eq(routerVpnCertsTable.routerId, routerId));
    } else {
      await db.insert(routerVpnCertsTable).values({
        routerId, routerName,
        clientCert: clientCert.cert,
        clientKey: clientCert.key,
        vpnIp,
      });
    }

    await db.update(routersTable).set({ vpnIp }).where(eq(routersTable.id, routerId));
    log.info(`[auto-provision] Router ${routerId} cert generated, VPN IP: ${vpnIp}`);
  } catch (err) {
    log.info(`[auto-provision] Skipped for router ${routerId}: ${err}`);
  }
}

// ── Server-side cache for /routers/status (15s TTL) ──────────────────────────

let statusCache: { data: unknown; expiresAt: number } | null = null;
const STATUS_TTL_MS = 15_000;

router.get("/routers/status", async (_req, res) => {
  const now = Date.now();

  if (statusCache && now < statusCache.expiresAt) {
    res.setHeader("Cache-Control", "public, max-age=15");
    res.json(statusCache.data);
    return;
  }

  const rows = await db.select().from(routersTable).orderBy(routersTable.name);
  const checkedAt = new Date().toISOString();

  const results = await Promise.all(
    rows.map(async (r) => {
      if (!r.enabled) {
        return {
          id: r.id, name: r.name, routerType: r.routerType,
          ipAddress: r.ipAddress, port: r.port ?? null,
          location: r.location ?? null, enabled: false,
          reachable: false, latencyMs: null,
          lastSeen: r.lastSeen ? r.lastSeen.toISOString() : null,
          checkedAt,
          provisionStatus: r.provisionStatus,
          vpnConnected: r.vpnConnected,
          provisionToken: r.provisionToken,
          vpnIp: r.vpnIp,
        };
      }

      const port = probePort(r);
      const { reachable, latencyMs } = await tcpProbe(r.ipAddress, port);

      if (reachable) {
        await db.update(routersTable)
          .set({ lastSeen: new Date() })
          .where(eq(routersTable.id, r.id));
      }

      return {
        id: r.id, name: r.name, routerType: r.routerType,
        ipAddress: r.ipAddress, port: r.port ?? null,
        location: r.location ?? null, enabled: r.enabled,
        reachable, latencyMs,
        lastSeen: reachable ? checkedAt : (r.lastSeen ? r.lastSeen.toISOString() : null),
        checkedAt,
        provisionStatus: r.provisionStatus,
        vpnConnected: r.vpnConnected,
        provisionToken: r.provisionToken,
        vpnIp: r.vpnIp,
      };
    })
  );

  statusCache = { data: results, expiresAt: now + STATUS_TTL_MS };
  res.setHeader("Cache-Control", "public, max-age=15");
  res.json(results);
});

router.get("/routers", async (_req, res) => {
  const rows = await db.select().from(routersTable).orderBy(routersTable.createdAt);
  res.setHeader("Cache-Control", "public, max-age=10");
  res.json(rows);
});

router.post("/routers", async (req, res) => {
  statusCache = null;
  const body = req.body;

  // Generate a unique provision token for zero-touch provisioning
  const provisionToken = randomUUID();

  const [created] = await db.insert(routersTable).values({
    name: body.name,
    routerType: body.routerType ?? "routeros",
    ipAddress: body.ipAddress,
    port: body.port ?? null,
    username: body.username,
    password: body.password,
    description: body.description ?? null,
    location: body.location ?? null,
    apiSsl: body.apiSsl ?? false,
    sshPort: body.sshPort ?? null,
    netconfPort: body.netconfPort ?? null,
    enabled: body.enabled !== undefined ? body.enabled : true,
    radiusSecret: body.radiusSecret ?? null,
    radiusPort: body.radiusPort ?? null,
    provisionToken,
    provisionStatus: "pending",
  }).returning();

  if (created!.radiusSecret) {
    void upsertRadnas({ ipAddress: created!.ipAddress, name: created!.name, radiusSecret: created!.radiusSecret, radiusPort: created!.radiusPort });
  }

  // Auto-generate VPN cert if VPN is configured (RouterOS only)
  if (created!.routerType === "routeros") {
    void autoProvision(created!.id, created!.name, req.log);
  }

  res.status(201).json(created);
});

router.get("/routers/:id", async (req, res) => {
  const id = parseInt(req.params.id!);
  const [row] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

// ── GET /api/routers/:id/provision-info ──────────────────────────────────────
// Returns provision status + token for UI polling (auth-protected)
router.get("/routers/:id/provision-info", async (req, res) => {
  const id = parseInt(req.params.id!);
  const [row] = await db.select({
    id: routersTable.id,
    name: routersTable.name,
    routerType: routersTable.routerType,
    provisionToken: routersTable.provisionToken,
    provisionStatus: routersTable.provisionStatus,
    macAddress: routersTable.macAddress,
    rosVersion: routersTable.rosVersion,
    vpnConnected: routersTable.vpnConnected,
    vpnIp: routersTable.vpnIp,
    lastCallbackAt: routersTable.lastCallbackAt,
  }).from(routersTable).where(eq(routersTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

// ── POST /api/routers/:id/reprovision ────────────────────────────────────────
// Regenerate provision token + VPN cert (admin action)
router.post("/routers/:id/reprovision", async (req, res) => {
  statusCache = null;
  const id = parseInt(req.params.id!);
  const [row] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }

  const newToken = randomUUID();
  await db.update(routersTable).set({
    provisionToken: newToken,
    provisionStatus: "pending",
    vpnConnected: false,
    lastCallbackAt: null,
  }).where(eq(routersTable.id, id));

  void autoProvision(id, row.name, req.log);
  res.json({ success: true, provisionToken: newToken });
});

router.patch("/routers/:id", async (req, res) => {
  statusCache = null;
  const id = parseInt(req.params.id!);
  const body = req.body;
  const update: Record<string, unknown> = {};
  const fields = [
    "name", "routerType", "ipAddress", "port", "username", "password",
    "description", "location", "apiSsl", "sshPort", "netconfPort", "enabled",
    "radiusSecret", "radiusPort",
  ] as const;
  for (const f of fields) {
    if (body[f] !== undefined) update[f] = body[f];
  }
  const [updated] = await db.update(routersTable).set(update).where(eq(routersTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  if (updated.radiusSecret) {
    void upsertRadnas({ ipAddress: updated.ipAddress, name: updated.name, radiusSecret: updated.radiusSecret, radiusPort: updated.radiusPort });
  } else if (body.radiusSecret === null || body.radiusSecret === "") {
    void removeRadnas(updated.ipAddress);
  }
  res.json(updated);
});

router.delete("/routers/:id", async (req, res) => {
  statusCache = null;
  const id = parseInt(req.params.id!);
  const [existing] = await db.select({ ipAddress: routersTable.ipAddress, radiusSecret: routersTable.radiusSecret })
    .from(routersTable).where(eq(routersTable.id, id));
  await db.delete(routersTable).where(eq(routersTable.id, id));
  if (existing?.radiusSecret) void removeRadnas(existing.ipAddress);
  res.status(204).send();
});

export default router;
