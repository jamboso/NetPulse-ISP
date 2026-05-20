import { Router } from "express";
import { db } from "@workspace/db";
import { ipPoolsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

router.get("/ip-pools", async (_req, res) => {
  const pools = await db.select().from(ipPoolsTable).orderBy(ipPoolsTable.createdAt);
  res.json(pools);
});

router.post("/ip-pools", async (req, res) => {
  const body = req.body;
  // Calculate total IPs from CIDR if possible
  const cidrMatch = body.network?.match(/\/(\d+)$/);
  const prefix = cidrMatch ? parseInt(cidrMatch[1]) : 24;
  const totalIps = prefix <= 32 ? Math.pow(2, 32 - prefix) - 2 : 0;

  const [pool] = await db.insert(ipPoolsTable).values({
    name: body.name,
    network: body.network,
    gateway: body.gateway,
    subnetMask: body.subnetMask,
    dns1: body.dns1 ?? null,
    dns2: body.dns2 ?? null,
    totalIps,
    usedIps: 0,
    description: body.description ?? null,
  }).returning();
  res.status(201).json(pool);
});

router.get("/ip-pools/:id", async (req, res) => {
  const id = parseInt(req.params.id!);
  const [pool] = await db.select().from(ipPoolsTable).where(eq(ipPoolsTable.id, id));
  if (!pool) { res.status(404).json({ error: "Not found" }); return; }
  res.json(pool);
});

router.patch("/ip-pools/:id", async (req, res) => {
  const id = parseInt(req.params.id!);
  const body = req.body;
  const update: Record<string, unknown> = {};
  if (body.name !== undefined) update.name = body.name;
  if (body.gateway !== undefined) update.gateway = body.gateway;
  if (body.subnetMask !== undefined) update.subnetMask = body.subnetMask;
  if (body.dns1 !== undefined) update.dns1 = body.dns1;
  if (body.dns2 !== undefined) update.dns2 = body.dns2;
  if (body.description !== undefined) update.description = body.description;
  const [updated] = await db.update(ipPoolsTable).set(update).where(eq(ipPoolsTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

router.delete("/ip-pools/:id", async (req, res) => {
  const id = parseInt(req.params.id!);
  await db.delete(ipPoolsTable).where(eq(ipPoolsTable.id, id));
  res.status(204).send();
});

export default router;
