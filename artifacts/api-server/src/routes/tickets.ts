import { Router } from "express";
import { db } from "@workspace/db";
import { ticketsTable, ticketRepliesTable, customersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { z } from "zod/v4";
import { validateBody } from "../middlewares/validateBody";
import { requireRole } from "../middlewares/requireRole";
import { resolveCompanyScope } from "../middlewares/companyScope";

const TICKET_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;
const TICKET_PRIORITIES = ["low", "medium", "high", "urgent"] as const;

const createTicketSchema = z.object({
  customerId:  z.number().int().positive(),
  subject:     z.string().min(1),
  description: z.string().min(1),
  status:      z.enum(TICKET_STATUSES).optional(),
  priority:    z.enum(TICKET_PRIORITIES).optional(),
  category:    z.string().optional().nullable(),
  assignedTo:  z.string().optional().nullable(),
});

const updateTicketSchema = z.object({
  subject:     z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  status:      z.enum(TICKET_STATUSES).optional(),
  priority:    z.enum(TICKET_PRIORITIES).optional(),
  category:    z.string().optional().nullable(),
  assignedTo:  z.string().optional().nullable(),
  resolvedAt:  z.string().optional().nullable(),
});

const createTicketReplySchema = z.object({
  message: z.string().min(1),
  author:  z.string().min(1),
  isStaff: z.boolean().optional(),
});

const router = Router();
router.use(resolveCompanyScope);

function fmtReply(r: typeof ticketRepliesTable.$inferSelect) {
  return { ...r, isStaff: r.isStaff === "true" };
}

function scopedTicketWhere(req: import("express").Request, id: number) {
  return req.companyId != null
    ? and(eq(ticketsTable.id, id), eq(ticketsTable.companyId, req.companyId))
    : eq(ticketsTable.id, id);
}

router.get("/tickets", async (req, res) => {
  const { customerId, status, priority, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const rows = await db
    .select()
    .from(ticketsTable)
    .leftJoin(customersTable, eq(ticketsTable.customerId, customersTable.id))
    .orderBy(ticketsTable.createdAt);

  const filtered = rows.filter(r => {
    if (req.companyId != null && r.tickets.companyId !== req.companyId) return false;
    if (customerId && r.tickets.customerId !== parseInt(customerId)) return false;
    if (status && r.tickets.status !== status) return false;
    if (priority && r.tickets.priority !== priority) return false;
    return true;
  });

  const total = filtered.length;
  const data = filtered.slice(offset, offset + limitNum).map(r => ({ ...r.tickets, customer: r.customers ?? null }));

  res.json({ data, total, page: pageNum, limit: limitNum });
});

router.post("/tickets", requireRole("admin", "billing", "support"), validateBody(createTicketSchema), async (req, res) => {
  const body = req.body;
  const [ticket] = await db.insert(ticketsTable).values({
    companyId: req.companyId!,
    customerId: body.customerId,
    subject: body.subject,
    description: body.description,
    status: body.status ?? "open",
    priority: body.priority ?? "medium",
    category: body.category ?? null,
    assignedTo: body.assignedTo ?? null,
  }).returning();
  res.status(201).json(ticket);
});

router.get("/tickets/:id", async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const [row] = await db
    .select()
    .from(ticketsTable)
    .leftJoin(customersTable, eq(ticketsTable.customerId, customersTable.id))
    .where(scopedTicketWhere(req, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...row.tickets, customer: row.customers ?? null });
});

router.patch("/tickets/:id", requireRole("admin", "billing", "support"), validateBody(updateTicketSchema), async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const body = req.body;
  const update: Record<string, unknown> = {};
  if (body.subject !== undefined) update.subject = body.subject;
  if (body.description !== undefined) update.description = body.description;
  if (body.status !== undefined) {
    update.status = body.status;
    if (body.status === "resolved") update.resolvedAt = new Date().toISOString();
  }
  if (body.priority !== undefined) update.priority = body.priority;
  if (body.category !== undefined) update.category = body.category;
  if (body.assignedTo !== undefined) update.assignedTo = body.assignedTo;
  if (body.resolvedAt !== undefined) update.resolvedAt = body.resolvedAt;
  const [updated] = await db.update(ticketsTable).set(update).where(scopedTicketWhere(req, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

router.delete("/tickets/:id", requireRole("admin"), async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const [existing] = await db.select({ id: ticketsTable.id }).from(ticketsTable).where(scopedTicketWhere(req, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  await db.delete(ticketRepliesTable).where(eq(ticketRepliesTable.ticketId, id));
  await db.delete(ticketsTable).where(eq(ticketsTable.id, id));
  res.status(204).send();
});

router.post("/tickets/:id/reply", requireRole("admin", "billing", "support"), validateBody(createTicketReplySchema), async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const [ticketExists] = await db.select({ id: ticketsTable.id }).from(ticketsTable).where(scopedTicketWhere(req, id));
  if (!ticketExists) { res.status(404).json({ error: "Not found" }); return; }
  const body = req.body;
  const [reply] = await db.insert(ticketRepliesTable).values({
    ticketId: id,
    message: body.message,
    author: body.author,
    isStaff: body.isStaff ? "true" : "false",
  }).returning();
  // Move ticket to in_progress if it was open and staff replied
  if (body.isStaff) {
    await db.update(ticketsTable)
      .set({ status: "in_progress" })
      .where(eq(ticketsTable.id, id));
  }
  res.status(201).json(fmtReply(reply!));
});

router.get("/tickets/:id/replies", async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const [ticketExists] = await db.select({ id: ticketsTable.id }).from(ticketsTable).where(scopedTicketWhere(req, id));
  if (!ticketExists) { res.status(404).json({ error: "Not found" }); return; }
  const replies = await db.select().from(ticketRepliesTable)
    .where(eq(ticketRepliesTable.ticketId, id))
    .orderBy(ticketRepliesTable.createdAt);
  res.json(replies.map(fmtReply));
});

export default router;
