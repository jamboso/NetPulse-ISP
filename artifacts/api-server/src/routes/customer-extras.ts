/**
 * Extra customer sub-routes powering the new detail tabs:
 *   GET  /api/customers/:id/session-logs     — usage history tab
 *   GET  /api/customers/:id/communications   — communication tab
 *   POST /api/customers/:id/communications   — add note/SMS record
 *   GET  /api/customers/:id/equipment        — company equipment tab
 *   GET  /api/customers/:id/payments         — payments for audit log
 */

import { Router } from "express";
import { db } from "@workspace/db";
import {
  sessionLogsTable, customerCommunicationsTable, equipmentTable, paymentsTable,
} from "@workspace/db";
import { eq, desc, and, gte, lte } from "drizzle-orm";

const router = Router();

// ── GET /api/customers/:id/session-logs ──────────────────────────────────────

router.get("/customers/:id/session-logs", async (req, res) => {
  const customerId = parseInt(req.params.id!);
  const limit = Math.min(parseInt(req.query.limit as string || "100"), 500);
  const from  = req.query.from ? new Date(req.query.from as string) : new Date(Date.now() - 90 * 86400_000);
  const to    = req.query.to   ? new Date(req.query.to   as string) : new Date();

  const logs = await db
    .select()
    .from(sessionLogsTable)
    .where(and(
      eq(sessionLogsTable.customerId, customerId),
      gte(sessionLogsTable.sessionStart, from),
      lte(sessionLogsTable.sessionStart, to),
    ))
    .orderBy(desc(sessionLogsTable.sessionStart))
    .limit(limit);

  res.json(logs);
});

// ── GET /api/customers/:id/communications ─────────────────────────────────────

router.get("/customers/:id/communications", async (req, res) => {
  const customerId = parseInt(req.params.id!);
  const limit = Math.min(parseInt(req.query.limit as string || "100"), 500);

  const rows = await db
    .select()
    .from(customerCommunicationsTable)
    .where(eq(customerCommunicationsTable.customerId, customerId))
    .orderBy(desc(customerCommunicationsTable.createdAt))
    .limit(limit);

  res.json(rows);
});

// ── POST /api/customers/:id/communications ────────────────────────────────────

router.post("/customers/:id/communications", async (req, res) => {
  const customerId = parseInt(req.params.id!);
  const { type = "note", direction = "outbound", subject, content, sentBy } = req.body as {
    type?: string; direction?: string; subject?: string; content: string; sentBy?: string;
  };

  if (!content?.trim()) { res.status(400).json({ error: "content required" }); return; }

  const [row] = await db
    .insert(customerCommunicationsTable)
    .values({ customerId, type, direction, subject: subject ?? null, content, sentBy: sentBy ?? null })
    .returning();

  res.status(201).json(row);
});

// ── DELETE /api/customers/:id/communications/:commId ──────────────────────────

router.delete("/customers/:id/communications/:commId", async (req, res) => {
  const commId = parseInt(req.params.commId!);
  await db.delete(customerCommunicationsTable).where(eq(customerCommunicationsTable.id, commId));
  res.status(204).end();
});

// ── GET /api/customers/:id/equipment ─────────────────────────────────────────

router.get("/customers/:id/equipment", async (req, res) => {
  const customerId = parseInt(req.params.id!);

  const rows = await db
    .select()
    .from(equipmentTable)
    .where(eq(equipmentTable.customerId, customerId))
    .orderBy(desc(equipmentTable.createdAt));

  res.json(rows);
});

// ── GET /api/customers/:id/payments ──────────────────────────────────────────

router.get("/customers/:id/payments", async (req, res) => {
  const customerId = parseInt(req.params.id!);

  const rows = await db
    .select()
    .from(paymentsTable)
    .where(eq(paymentsTable.customerId, customerId))
    .orderBy(desc(paymentsTable.createdAt))
    .limit(100);

  res.json(rows);
});

export default router;
