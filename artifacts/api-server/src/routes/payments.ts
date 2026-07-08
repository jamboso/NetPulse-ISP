import { Router } from "express";
import { db } from "@workspace/db";
import { paymentsTable, customersTable, invoicesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { requireRole } from "../middlewares/requireRole";
import { validateBody } from "../middlewares/validateBody";
import { writeAuditLog } from "../lib/audit";

const PAYMENT_METHODS = ["cash", "mpesa", "bank", "card"] as const;
const PAYMENT_STATUSES = ["completed", "pending", "failed"] as const;

const createPaymentSchema = z.object({
  customerId: z.number().int().positive().optional().nullable(),
  invoiceId:  z.number().int().positive().optional().nullable(),
  amount:     z.number().nonnegative(),
  method:     z.enum(PAYMENT_METHODS).optional(),
  status:     z.enum(PAYMENT_STATUSES).optional(),
  reference:  z.string().optional().nullable(),
  notes:      z.string().optional().nullable(),
});

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

router.post("/payments", requireRole("admin", "billing"), validateBody(createPaymentSchema), async (req, res) => {
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

  if (payment!.status === "completed" && payment!.invoiceId != null) {
    await db.update(invoicesTable).set({ status: "paid", paidAt: new Date().toISOString() })
      .where(eq(invoicesTable.id, payment!.invoiceId));
  }

  void writeAuditLog({
    userId:     req.user!.id,
    userEmail:  req.user!.email,
    action:     "create",
    entityType: "payment",
    entityId:   payment!.id,
    diff:       { after: fmt(payment!) },
  });

  res.status(201).json(fmt(payment!));
});

router.get("/payments/:id", async (req, res) => {
  const id = parseInt(req.params.id!);
  const [row] = await db
    .select()
    .from(paymentsTable)
    .leftJoin(customersTable, eq(paymentsTable.customerId, customersTable.id))
    .where(eq(paymentsTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(fmt(row.payments, row.customers));
});

export default router;
