import { Router } from "express";
import { db } from "@workspace/db";
import { paymentsTable, customersTable, invoicesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

function fmt(p: typeof paymentsTable.$inferSelect, customer?: typeof customersTable.$inferSelect | null) {
  return { ...p, amount: Number(p.amount), customer: customer ?? null };
}

router.get("/payments", async (req, res) => {
  const { customerId, invoiceId } = req.query as Record<string, string>;
  const rows = await db
    .select()
    .from(paymentsTable)
    .leftJoin(customersTable, eq(paymentsTable.customerId, customersTable.id))
    .orderBy(paymentsTable.createdAt);

  const filtered = rows.filter(r => {
    if (customerId && r.payments.customerId !== parseInt(customerId)) return false;
    if (invoiceId && r.payments.invoiceId !== parseInt(invoiceId)) return false;
    return true;
  });

  res.json(filtered.map(r => fmt(r.payments, r.customers)));
});

router.post("/payments", async (req, res) => {
  const body = req.body;
  const [payment] = await db.insert(paymentsTable).values({
    customerId: body.customerId,
    invoiceId: body.invoiceId,
    amount: String(body.amount),
    method: body.method ?? "cash",
    status: body.status ?? "completed",
    reference: body.reference ?? null,
    notes: body.notes ?? null,
  }).returning();

  // Mark invoice as paid if payment is completed
  if (payment!.status === "completed") {
    await db.update(invoicesTable).set({ status: "paid", paidAt: new Date().toISOString() })
      .where(eq(invoicesTable.id, payment!.invoiceId));
  }

  res.status(201).json(fmt(payment!));
});

router.get("/payments/:id", async (req, res) => {
  const id = parseInt(req.params.id!);
  const [row] = await db
    .select()
    .from(paymentsTable)
    .leftJoin(customersTable, eq(paymentsTable.customerId, customersTable.id))
    .where(eq(paymentsTable.id, id));
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(fmt(row.payments, row.customers));
});

export default router;
