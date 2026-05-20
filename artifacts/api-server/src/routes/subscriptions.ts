import { Router } from "express";
import { db } from "@workspace/db";
import { subscriptionsTable, customersTable, plansTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

function formatSub(s: typeof subscriptionsTable.$inferSelect, customer?: typeof customersTable.$inferSelect | null, plan?: typeof plansTable.$inferSelect | null) {
  return {
    ...s,
    customer: customer ?? null,
    plan: plan ? { ...plan, price: Number(plan.price) } : null,
  };
}

router.get("/subscriptions", async (req, res) => {
  const { customerId, status } = req.query as Record<string, string>;
  const rows = await db
    .select()
    .from(subscriptionsTable)
    .leftJoin(customersTable, eq(subscriptionsTable.customerId, customersTable.id))
    .leftJoin(plansTable, eq(subscriptionsTable.planId, plansTable.id))
    .orderBy(subscriptionsTable.createdAt);

  const filtered = rows.filter(r => {
    if (customerId && r.subscriptions.customerId !== parseInt(customerId)) return false;
    if (status && r.subscriptions.status !== status) return false;
    return true;
  });

  res.json(filtered.map(r => formatSub(r.subscriptions, r.customers, r.plans)));
});

router.post("/subscriptions", async (req, res) => {
  const body = req.body;
  const [sub] = await db.insert(subscriptionsTable).values({
    customerId: body.customerId,
    planId: body.planId,
    status: body.status ?? "active",
    startDate: body.startDate,
    endDate: body.endDate ?? null,
    ipAddress: body.ipAddress ?? null,
    macAddress: body.macAddress ?? null,
  }).returning();
  res.status(201).json(sub);
});

router.get("/subscriptions/:id", async (req, res) => {
  const id = parseInt(req.params.id!);
  const [row] = await db
    .select()
    .from(subscriptionsTable)
    .leftJoin(customersTable, eq(subscriptionsTable.customerId, customersTable.id))
    .leftJoin(plansTable, eq(subscriptionsTable.planId, plansTable.id))
    .where(eq(subscriptionsTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatSub(row.subscriptions, row.customers, row.plans));
});

router.patch("/subscriptions/:id", async (req, res) => {
  const id = parseInt(req.params.id!);
  const body = req.body;
  const update: Record<string, unknown> = {};
  if (body.planId !== undefined) update.planId = body.planId;
  if (body.status !== undefined) update.status = body.status;
  if (body.endDate !== undefined) update.endDate = body.endDate;
  if (body.ipAddress !== undefined) update.ipAddress = body.ipAddress;
  if (body.macAddress !== undefined) update.macAddress = body.macAddress;
  const [updated] = await db.update(subscriptionsTable).set(update).where(eq(subscriptionsTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

router.delete("/subscriptions/:id", async (req, res) => {
  const id = parseInt(req.params.id!);
  await db.delete(subscriptionsTable).where(eq(subscriptionsTable.id, id));
  res.status(204).send();
});

export default router;
