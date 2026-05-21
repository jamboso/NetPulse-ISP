/**
 * SMS Template & Bulk Send routes
 *
 * GET    /api/sms/templates
 * POST   /api/sms/templates
 * PUT    /api/sms/templates/:id
 * DELETE /api/sms/templates/:id
 *
 * POST   /api/sms/bulk          — send to a filtered set of customers
 * GET    /api/sms/logs          — recent send logs
 * GET    /api/sms/preview       — render a template without sending
 */

import { Router } from "express";
import { db } from "@workspace/db";
import {
  smsTemplatesTable, smsLogsTable,
  customersTable, subscriptionsTable, plansTable,
} from "@workspace/db";
import { eq, desc, and, gte, lte, isNotNull, inArray } from "drizzle-orm";
import { getSettings, sendSms, renderTemplate, logSms } from "../lib/sms";

const router = Router();

// ── Templates ─────────────────────────────────────────────────────────────────

router.get("/sms/templates", async (_req, res) => {
  const rows = await db.select().from(smsTemplatesTable).orderBy(smsTemplatesTable.triggerType, smsTemplatesTable.name);
  res.json(rows);
});

router.post("/sms/templates", async (req, res) => {
  const { name, triggerType = "manual", message, isActive = true } = req.body as {
    name: string; triggerType?: string; message: string; isActive?: boolean;
  };
  if (!name?.trim() || !message?.trim()) { res.status(400).json({ error: "name and message required" }); return; }

  const [row] = await db.insert(smsTemplatesTable)
    .values({ name, triggerType, message, isActive })
    .returning();
  res.status(201).json(row);
});

router.put("/sms/templates/:id", async (req, res) => {
  const id = parseInt(req.params.id!);
  const { name, triggerType, message, isActive } = req.body as Partial<{
    name: string; triggerType: string; message: string; isActive: boolean;
  }>;
  const [row] = await db.update(smsTemplatesTable)
    .set({ ...(name !== undefined && { name }), ...(triggerType !== undefined && { triggerType }), ...(message !== undefined && { message }), ...(isActive !== undefined && { isActive }), updatedAt: new Date() })
    .where(eq(smsTemplatesTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Template not found" }); return; }
  res.json(row);
});

router.delete("/sms/templates/:id", async (req, res) => {
  await db.delete(smsTemplatesTable).where(eq(smsTemplatesTable.id, parseInt(req.params.id!)));
  res.status(204).end();
});

// ── Preview ───────────────────────────────────────────────────────────────────

router.post("/sms/preview", async (req, res) => {
  const { message, customerId } = req.body as { message: string; customerId?: number };
  const settings = await getSettings();
  const paybill  = settings.mpesaPaybillNumber || settings.mpesaShortcode || settings.mpesaBusinessShortCode || "XXXXXX";

  let vars = {
    name: "John Doe", username: "john.doe", account: "john.doe",
    plan: "Home Fiber 20M", amount: "2,500", paybill,
    daysLeft: 3, expiryDate: "25 May 2026", phone: "0712345678",
  };

  if (customerId) {
    const rows = await db
      .select({ c: customersTable, s: subscriptionsTable, p: plansTable })
      .from(customersTable)
      .leftJoin(subscriptionsTable, and(eq(subscriptionsTable.customerId, customerId), eq(subscriptionsTable.status, "active")))
      .leftJoin(plansTable, eq(subscriptionsTable.planId, plansTable.id))
      .where(eq(customersTable.id, customerId))
      .limit(1);
    if (rows[0]) {
      const { c, s, p } = rows[0];
      vars = {
        name:       c.name,
        username:   s?.pppoeUsername ?? "",
        account:    s?.pppoeUsername ?? "",
        plan:       p?.name ?? "—",
        amount:     p ? Number(p.price).toLocaleString("en-KE") : "0",
        paybill,
        daysLeft:   3,
        expiryDate: s?.endDate ? new Date(s.endDate).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "—",
        phone:      c.phone,
      };
    }
  }

  res.json({ preview: renderTemplate(message, vars), vars });
});

// ── Bulk Send ─────────────────────────────────────────────────────────────────

router.post("/sms/bulk", async (req, res) => {
  const {
    templateId,
    message: customMessage,
    filter = "all",    // "all" | "active" | "suspended" | "expiring_7"
    customerIds,       // optional array to target specific customers
  } = req.body as {
    templateId?: number;
    message?: string;
    filter?: string;
    customerIds?: number[];
  };

  let messageTemplate = customMessage ?? "";
  if (!messageTemplate && templateId) {
    const [tmpl] = await db.select().from(smsTemplatesTable).where(eq(smsTemplatesTable.id, templateId));
    if (tmpl) messageTemplate = tmpl.message;
  }
  if (!messageTemplate) { res.status(400).json({ error: "message or templateId required" }); return; }

  const settings = await getSettings();
  if (!settings.smsProvider) { res.status(400).json({ error: "No SMS provider configured. Go to Settings → SMS." }); return; }
  const paybill = settings.mpesaPaybillNumber || settings.mpesaShortcode || settings.mpesaBusinessShortCode || "";

  // Build query based on filter
  const today = new Date().toISOString().slice(0, 10);
  const in7   = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);

  let query = db
    .select({ c: customersTable, s: subscriptionsTable, p: plansTable })
    .from(customersTable)
    .leftJoin(subscriptionsTable, eq(subscriptionsTable.customerId, customersTable.id))
    .leftJoin(plansTable, eq(subscriptionsTable.planId, plansTable.id))
    .where(isNotNull(customersTable.phone));

  // Apply filter
  const conditions = [isNotNull(customersTable.phone)];
  if (customerIds?.length) conditions.push(inArray(customersTable.id, customerIds));
  if (filter === "active")      conditions.push(eq(subscriptionsTable.status, "active"));
  if (filter === "suspended")   conditions.push(eq(subscriptionsTable.status, "suspended"));
  if (filter === "expiring_7")  conditions.push(and(eq(subscriptionsTable.status, "active"), gte(subscriptionsTable.endDate, today), lte(subscriptionsTable.endDate, in7)) as any);

  const rows = await db
    .select({ c: customersTable, s: subscriptionsTable, p: plansTable })
    .from(customersTable)
    .leftJoin(subscriptionsTable, eq(subscriptionsTable.customerId, customersTable.id))
    .leftJoin(plansTable, eq(subscriptionsTable.planId, plansTable.id))
    .where(and(...conditions) as any);

  // Deduplicate by customer (one SMS per customer even if multiple subscriptions)
  const seen = new Set<number>();
  const targets = rows.filter(r => { if (seen.has(r.c.id)) return false; seen.add(r.c.id); return true; });

  let sent = 0, failed = 0;
  const errors: string[] = [];

  for (const { c, s, p } of targets) {
    const expiryDate = s?.endDate
      ? new Date(s.endDate).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" })
      : "—";
    const endDate    = s?.endDate ? new Date(s.endDate) : new Date();
    const daysLeft   = Math.max(0, Math.floor((endDate.getTime() - Date.now()) / 86400_000));

    const message = renderTemplate(messageTemplate, {
      name:       c.name,
      username:   s?.pppoeUsername ?? "",
      account:    s?.pppoeUsername ?? "",
      plan:       p?.name ?? "—",
      amount:     p ? Number(p.price).toLocaleString("en-KE") : "0",
      paybill,
      daysLeft,
      expiryDate,
      phone:      c.phone,
    });

    const result = await sendSms(settings, c.phone, message);
    await logSms({
      customerId:     c.id,
      subscriptionId: s?.id ?? null,
      phone:          c.phone,
      message,
      templateId:     templateId ?? null,
      triggerType:    "bulk",
      status:         result.success ? "sent" : "failed",
      error:          result.success ? null : result.message,
    });
    if (result.success) sent++;
    else { failed++; errors.push(`${c.name}: ${result.message}`); }
  }

  res.json({ sent, failed, total: targets.length, errors: errors.slice(0, 10) });
});

// ── Logs ──────────────────────────────────────────────────────────────────────

router.get("/sms/logs", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string || "100"), 500);
  const rows = await db
    .select({ log: smsLogsTable, customer: customersTable })
    .from(smsLogsTable)
    .leftJoin(customersTable, eq(smsLogsTable.customerId, customersTable.id))
    .orderBy(desc(smsLogsTable.createdAt))
    .limit(limit);
  res.json(rows.map(r => ({ ...r.log, customerName: r.customer?.name ?? null })));
});

export default router;
