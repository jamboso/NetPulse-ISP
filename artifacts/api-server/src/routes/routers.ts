import { Router } from "express";
import { db } from "@workspace/db";
import { routersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

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
