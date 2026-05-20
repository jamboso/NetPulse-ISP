import { Router } from "express";
import * as net from "net";
import { db } from "@workspace/db";
import { routersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

// TCP probe: tries to open a TCP socket to host:port within timeoutMs
function tcpProbe(host: string, port: number, timeoutMs = 2500): Promise<{ reachable: boolean; latencyMs: number | null }> {
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

// Determine the probe port for a given router
function probePort(r: typeof routersTable.$inferSelect): number {
  if (r.routerType === "routeros") return r.port ?? (r.apiSsl ? 8729 : 8728);
  if (r.routerType === "juniper") return r.sshPort ?? r.netconfPort ?? 22;
  // edgerouter
  return r.sshPort ?? 22;
}

// GET /routers/status — MUST be declared before /routers/:id
router.get("/routers/status", async (_req, res) => {
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
      };
    })
  );

  res.json(results);
});

router.get("/routers", async (_req, res) => {
  const rows = await db.select().from(routersTable).orderBy(routersTable.createdAt);
  res.json(rows);
});

router.post("/routers", async (req, res) => {
  const body = req.body;
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
  }).returning();
  res.status(201).json(created);
});

router.get("/routers/:id", async (req, res) => {
  const id = parseInt(req.params.id!);
  const [row] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.patch("/routers/:id", async (req, res) => {
  const id = parseInt(req.params.id!);
  const body = req.body;
  const update: Record<string, unknown> = {};
  const fields = [
    "name", "routerType", "ipAddress", "port", "username", "password",
    "description", "location", "apiSsl", "sshPort", "netconfPort", "enabled",
  ] as const;
  for (const f of fields) {
    if (body[f] !== undefined) update[f] = body[f];
  }
  const [updated] = await db.update(routersTable).set(update).where(eq(routersTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

router.delete("/routers/:id", async (req, res) => {
  const id = parseInt(req.params.id!);
  await db.delete(routersTable).where(eq(routersTable.id, id));
  res.status(204).send();
});

export default router;
