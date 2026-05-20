import { Router } from "express";
import { db } from "@workspace/db";
import { equipmentTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

router.get("/equipment", async (req, res) => {
  const { status, type } = req.query as Record<string, string>;
  const rows = await db.select().from(equipmentTable).orderBy(equipmentTable.createdAt);
  const filtered = rows.filter(r => {
    if (status && r.status !== status) return false;
    if (type && r.type !== type) return false;
    return true;
  });
  res.json(filtered);
});

router.post("/equipment", async (req, res) => {
  const body = req.body;
  const [eq_] = await db.insert(equipmentTable).values({
    name: body.name,
    type: body.type ?? "router",
    model: body.model,
    brand: body.brand ?? null,
    ipAddress: body.ipAddress,
    macAddress: body.macAddress ?? null,
    location: body.location ?? null,
    status: body.status ?? "online",
    notes: body.notes ?? null,
  }).returning();
  res.status(201).json(eq_);
});

router.get("/equipment/:id", async (req, res) => {
  const id = parseInt(req.params.id!);
  const [item] = await db.select().from(equipmentTable).where(eq(equipmentTable.id, id));
  if (!item) return res.status(404).json({ error: "Not found" });
  res.json(item);
});

router.patch("/equipment/:id", async (req, res) => {
  const id = parseInt(req.params.id!);
  const body = req.body;
  const update: Record<string, unknown> = {};
  if (body.name !== undefined) update.name = body.name;
  if (body.type !== undefined) update.type = body.type;
  if (body.model !== undefined) update.model = body.model;
  if (body.brand !== undefined) update.brand = body.brand;
  if (body.ipAddress !== undefined) update.ipAddress = body.ipAddress;
  if (body.macAddress !== undefined) update.macAddress = body.macAddress;
  if (body.location !== undefined) update.location = body.location;
  if (body.status !== undefined) update.status = body.status;
  if (body.notes !== undefined) update.notes = body.notes;
  const [updated] = await db.update(equipmentTable).set(update).where(eq(equipmentTable.id, id)).returning();
  if (!updated) return res.status(404).json({ error: "Not found" });
  res.json(updated);
});

router.delete("/equipment/:id", async (req, res) => {
  const id = parseInt(req.params.id!);
  await db.delete(equipmentTable).where(eq(equipmentTable.id, id));
  res.status(204).send();
});

export default router;
