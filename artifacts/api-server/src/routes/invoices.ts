import { Router } from "express";
import { db } from "@workspace/db";
import { invoicesTable, customersTable, subscriptionsTable } from "@workspace/db";
import { eq, sql, and } from "drizzle-orm";
import { z } from "zod/v4";
import { requireRole } from "../middlewares/requireRole";
import { validateBody } from "../middlewares/validateBody";
import { resolveCompanyScope } from "../middlewares/companyScope";
import { writeAuditLog } from "../lib/audit";

const INVOICE_STATUSES = ["draft", "sent", "paid", "overdue"] as const;

const createInvoiceSchema = z.object({
  customerId:     z.number().int().positive(),
  subscriptionId: z.number().int().positive().optional().nullable(),
  amount:         z.number().nonnegative(),
  tax:            z.number().nonnegative().optional().nullable(),
  status:         z.enum(INVOICE_STATUSES).optional(),
  dueDate:        z.string().min(1),
  notes:          z.string().optional().nullable(),
});

const updateInvoiceSchema = z.object({
  amount:  z.number().nonnegative().optional(),
  tax:     z.number().nonnegative().optional().nullable(),
  status:  z.enum(INVOICE_STATUSES).optional(),
  dueDate: z.string().optional(),
  paidAt:  z.string().optional().nullable(),
  notes:   z.string().optional().nullable(),
});

const router = Router();
router.use(resolveCompanyScope);

function scopedInvoiceWhere(req: import("express").Request, id: number) {
  return req.companyId != null
    ? and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, req.companyId))
    : eq(invoicesTable.id, id);
}

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
    if (req.companyId != null && r.invoices.companyId !== req.companyId) return false;
    if (customerId && r.invoices.customerId !== parseInt(customerId)) return false;
    if (status && r.invoices.status !== status) return false;
    return true;
  });

  const total = filtered.length;
  const data = filtered.slice(offset, offset + limitNum).map(r => fmt(r.invoices, r.customers));
  res.json({ data, total, page: pageNum, limit: limitNum });
});

router.post("/invoices", requireRole("admin", "billing"), validateBody(createInvoiceSchema), async (req, res) => {
  const body = req.body;
  const tax = body.tax ?? 0;
  const total = Number(body.amount) + Number(tax);

  const [customer] = await db.select({ id: customersTable.id }).from(customersTable).where(
    req.companyId != null
      ? and(eq(customersTable.id, body.customerId), eq(customersTable.companyId, req.companyId))
      : eq(customersTable.id, body.customerId),
  );
  if (!customer) { res.status(400).json({ error: "Invalid customerId" }); return; }

  if (body.subscriptionId != null) {
    const [subscription] = await db.select({ id: subscriptionsTable.id }).from(subscriptionsTable).where(
      req.companyId != null
        ? and(eq(subscriptionsTable.id, body.subscriptionId), eq(subscriptionsTable.companyId, req.companyId))
        : eq(subscriptionsTable.id, body.subscriptionId),
    );
    if (!subscription) { res.status(400).json({ error: "Invalid subscriptionId" }); return; }
  }

  const [inv] = await db.insert(invoicesTable).values({
    companyId: req.companyId!,
    customerId: body.customerId,
    subscriptionId: body.subscriptionId ?? null,
    amount: String(body.amount),
    tax: tax ? String(tax) : null,
    total: String(total),
    status: body.status ?? "draft",
    dueDate: body.dueDate,
    notes: body.notes ?? null,
  }).returning();

  void writeAuditLog({
    companyId:  req.companyId,
    userId:     req.user!.id,
    userEmail:  req.user!.email,
    action:     "create",
    entityType: "invoice",
    entityId:   inv!.id,
    diff:       { after: fmt(inv!) },
  });

  res.status(201).json(fmt(inv!));
});

router.get("/invoices/:id", async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const [row] = await db
    .select()
    .from(invoicesTable)
    .leftJoin(customersTable, eq(invoicesTable.customerId, customersTable.id))
    .where(scopedInvoiceWhere(req, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(fmt(row.invoices, row.customers));
});

router.patch("/invoices/:id", requireRole("admin", "billing"), validateBody(updateInvoiceSchema), async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const body = req.body;

  const [before] = await db.select().from(invoicesTable).where(scopedInvoiceWhere(req, id));
  if (!before) { res.status(404).json({ error: "Not found" }); return; }

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

  const [updated] = await db.update(invoicesTable).set(update).where(scopedInvoiceWhere(req, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  void writeAuditLog({
    companyId:  req.companyId,
    userId:     req.user!.id,
    userEmail:  req.user!.email,
    action:     "update",
    entityType: "invoice",
    entityId:   id,
    diff:       { before: fmt(before), after: fmt(updated) },
  });

  res.json(fmt(updated));
});

router.delete("/invoices/:id", requireRole("admin"), async (req, res) => {
  const id = parseInt(req.params["id"] as string);

  const [before] = await db.select().from(invoicesTable).where(scopedInvoiceWhere(req, id));

  await db.delete(invoicesTable).where(scopedInvoiceWhere(req, id));

  void writeAuditLog({
    companyId:  req.companyId,
    userId:     req.user!.id,
    userEmail:  req.user!.email,
    action:     "delete",
    entityType: "invoice",
    entityId:   id,
    diff:       { before: before ? fmt(before) : null },
  });

  res.status(204).send();
});

export default router;
