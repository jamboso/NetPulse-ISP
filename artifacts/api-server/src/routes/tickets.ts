import { Router } from "express";
import { db } from "@workspace/db";
import { ticketsTable, ticketRepliesTable, customersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

function fmt(t: typeof ticketsTable.$inferSelect, customer?: typeof customersTable.$inferSelect | null) {
  return { ...t, isStaff: undefined, customer: customer ?? null };
}

function fmtReply(r: typeof ticketRepliesTable.$inferSelect) {
  return { ...r, isStaff: r.isStaff === "true" };
}

router.get("/tickets", async (req, res) => {
  const { customerId, status, priority } = req.query as Record<string, string>;
  const rows = await db
    .select()
    .from(ticketsTable)
    .leftJoin(customersTable, eq(ticketsTable.customerId, customersTable.id))
    .orderBy(ticketsTable.createdAt);

  const filtered = rows.filter(r => {
    if (customerId && r.tickets.customerId !== parseInt(customerId)) return false;
    if (status && r.tickets.status !== status) return false;
    if (priority && r.tickets.priority !== priority) return false;
    return true;
  });

  res.json(filtered.map(r => ({ ...r.tickets, customer: r.customers ?? null })));
});

router.post("/tickets", async (req, res) => {
  const body = req.body;
  const [ticket] = await db.insert(ticketsTable).values({
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
  const id = parseInt(req.params.id!);
  const [row] = await db
    .select()
    .from(ticketsTable)
    .leftJoin(customersTable, eq(ticketsTable.customerId, customersTable.id))
    .where(eq(ticketsTable.id, id));
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json({ ...row.tickets, customer: row.customers ?? null });
});

router.patch("/tickets/:id", async (req, res) => {
  const id = parseInt(req.params.id!);
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
  const [updated] = await db.update(ticketsTable).set(update).where(eq(ticketsTable.id, id)).returning();
  if (!updated) return res.status(404).json({ error: "Not found" });
  res.json(updated);
});

router.delete("/tickets/:id", async (req, res) => {
  const id = parseInt(req.params.id!);
  await db.delete(ticketRepliesTable).where(eq(ticketRepliesTable.ticketId, id));
  await db.delete(ticketsTable).where(eq(ticketsTable.id, id));
  res.status(204).send();
});

router.post("/tickets/:id/reply", async (req, res) => {
  const id = parseInt(req.params.id!);
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
  const id = parseInt(req.params.id!);
  const replies = await db.select().from(ticketRepliesTable)
    .where(eq(ticketRepliesTable.ticketId, id))
    .orderBy(ticketRepliesTable.createdAt);
  res.json(replies.map(fmtReply));
});

export default router;
