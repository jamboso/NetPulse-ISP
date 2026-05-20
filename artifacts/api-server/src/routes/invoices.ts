import { Router } from "express";
import { db } from "@workspace/db";
import { invoicesTable, customersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const router = Router();

function fmt(inv: typeof invoicesTable.$inferSelect, customer?: typeof customersTable.$inferSelect | null) {
  return {
    ...inv,
    amount: Number(inv.amount),
    tax: inv.tax != null ? Number(inv.tax) : null,
    total: Number(inv.total),
    customer: customer ?? null,
  };
}

router.get("/invoices", async (req, res) => {
  const { customerId, status, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, parseInt(limit));
  const offset = (pageNum - 1) * limitNum;

  const rows = await db
    .select()
    .from(invoicesTable)
    .leftJoin(customersTable, eq(invoicesTable.customerId, customersTable.id))
    .orderBy(invoicesTable.createdAt);

  const filtered = rows.filter(r => {
    if (customerId && r.invoices.customerId !== parseInt(customerId)) return false;
    if (status && r.invoices.status !== status) return false;
    return true;
  });

  const total = filtered.length;
  const data = filtered.slice(offset, offset + limitNum).map(r => fmt(r.invoices, r.customers));
  res.json({ data, total, page: pageNum, limit: limitNum });
});

router.post("/invoices", async (req, res) => {
  const body = req.body;
  const tax = body.tax ?? 0;
  const total = Number(body.amount) + Number(tax);
  const [inv] = await db.insert(invoicesTable).values({
    customerId: body.customerId,
    subscriptionId: body.subscriptionId ?? null,
    amount: String(body.amount),
    tax: tax ? String(tax) : null,
    total: String(total),
    status: body.status ?? "draft",
    dueDate: body.dueDate,
    notes: body.notes ?? null,
  }).returning();
  res.status(201).json(fmt(inv!));
});

router.get("/invoices/:id", async (req, res) => {
  const id = parseInt(req.params.id!);
  const [row] = await db
    .select()
    .from(invoicesTable)
    .leftJoin(customersTable, eq(invoicesTable.customerId, customersTable.id))
    .where(eq(invoicesTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(fmt(row.invoices, row.customers));
});

router.patch("/invoices/:id", async (req, res) => {
  const id = parseInt(req.params.id!);
  const body = req.body;
  const update: Record<string, unknown> = {};
  if (body.amount !== undefined) update.amount = String(body.amount);
  if (body.tax !== undefined) update.tax = body.tax != null ? String(body.tax) : null;
  if (body.status !== undefined) {
    update.status = body.status;
    if (body.status === "paid" && !body.paidAt) update.paidAt = new Date().toISOString();
  }
  if (body.dueDate !== undefined) update.dueDate = body.dueDate;
  if (body.paidAt !== undefined) update.paidAt = body.paidAt;
  if (body.notes !== undefined) update.notes = body.notes;
  const [updated] = await db.update(invoicesTable).set(update).where(eq(invoicesTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(fmt(updated));
});

router.delete("/invoices/:id", async (req, res) => {
  const id = parseInt(req.params.id!);
  await db.delete(invoicesTable).where(eq(invoicesTable.id, id));
  res.status(204).send();
});

export default router;
