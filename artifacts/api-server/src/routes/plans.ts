import { Router } from "express";
import { db } from "@workspace/db";
import { plansTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

router.get("/plans", async (_req, res) => {
  const plans = await db.select().from(plansTable).orderBy(plansTable.createdAt);
  res.json(plans.map(p => ({ ...p, price: Number(p.price) })));
});

router.post("/plans", async (req, res) => {
  const body = req.body;
  const [plan] = await db.insert(plansTable).values({
    name: body.name,
    description: body.description ?? null,
    downloadSpeed: body.downloadSpeed,
    uploadSpeed: body.uploadSpeed,
    price: String(body.price),
    billingCycle: body.billingCycle ?? "monthly",
    isActive: body.isActive ?? true,
    rosProfileName: body.rosProfileName ?? null,
  }).returning();
  res.status(201).json({ ...plan, price: Number(plan!.price) });
});

router.get("/plans/:id", async (req, res) => {
  const id = parseInt(req.params.id!);
  const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, id));
  if (!plan) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...plan, price: Number(plan.price) });
});

router.patch("/plans/:id", async (req, res) => {
  const id = parseInt(req.params.id!);
  const body = req.body;
  const update: Record<string, unknown> = {};
  if (body.name !== undefined) update.name = body.name;
  if (body.description !== undefined) update.description = body.description;
  if (body.downloadSpeed !== undefined) update.downloadSpeed = body.downloadSpeed;
  if (body.uploadSpeed !== undefined) update.uploadSpeed = body.uploadSpeed;
  if (body.price !== undefined) update.price = String(body.price);
  if (body.billingCycle !== undefined) update.billingCycle = body.billingCycle;
  if (body.isActive !== undefined) update.isActive = body.isActive;
  if (body.rosProfileName !== undefined) update.rosProfileName = body.rosProfileName;
  const [updated] = await db.update(plansTable).set(update).where(eq(plansTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...updated, price: Number(updated.price) });
});

router.delete("/plans/:id", async (req, res) => {
  const id = parseInt(req.params.id!);
  await db.delete(plansTable).where(eq(plansTable.id, id));
  res.status(204).send();
});

export default router;
