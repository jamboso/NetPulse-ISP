import { Router } from "express";
import { db } from "@workspace/db";
import { paymentsTable, customersTable, invoicesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { z } from "zod/v4";
import { requireRole } from "../middlewares/requireRole";
import { validateBody } from "../middlewares/validateBody";
import { resolveCompanyScope } from "../middlewares/companyScope";
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
router.use(resolveCompanyScope);

function scopedPaymentWhere(req: import("express").Request, id: number) {
  return req.companyId != null
    ? and(eq(paymentsTable.id, id), eq(paymentsTable.companyId, req.companyId))
    : eq(paymentsTable.id, id);
}

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
    if (req.companyId != null && r.payments.companyId !== req.companyId) return false;
    if (customerId && r.payments.customerId !== parseInt(customerId)) return false;
    if (invoiceId && r.payments.invoiceId !== parseInt(invoiceId)) return false;
    return true;
  });

  res.json(filtered.map(r => fmt(r.payments, r.customers)));
});

router.post("/payments", requireRole("admin", "billing"), validateBody(createPaymentSchema), async (req, res) => {
  const body = req.body;

  if (body.customerId != null) {
    const [customer] = await db.select({ id: customersTable.id }).from(customersTable).where(
      req.companyId != null
        ? and(eq(customersTable.id, body.customerId), eq(customersTable.companyId, req.companyId))
        : eq(customersTable.id, body.customerId),
    );
    if (!customer) { res.status(400).json({ error: "Invalid customerId" }); return; }
  }

  if (body.invoiceId != null) {
    const [invoice] = await db.select({ id: invoicesTable.id }).from(invoicesTable).where(
      req.companyId != null
        ? and(eq(invoicesTable.id, body.invoiceId), eq(invoicesTable.companyId, req.companyId))
        : eq(invoicesTable.id, body.invoiceId),
    );
    if (!invoice) { res.status(400).json({ error: "Invalid invoiceId" }); return; }
  }

  const [payment] = await db.insert(paymentsTable).values({
    companyId: req.companyId!,
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
      .where(
        req.companyId != null
          ? and(eq(invoicesTable.id, payment!.invoiceId), eq(invoicesTable.companyId, req.companyId))
          : eq(invoicesTable.id, payment!.invoiceId),
      );
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
    .where(scopedPaymentWhere(req, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(fmt(row.payments, row.customers));
});

export default router;
