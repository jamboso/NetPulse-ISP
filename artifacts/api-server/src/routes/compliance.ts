import { Router } from "express";
import { db } from "@workspace/db";
import {
  sessionLogsTable, customersTable, subscriptionsTable, plansTable,
} from "@workspace/db";
import { eq, and, gte, lte, desc, isNull } from "drizzle-orm";

const router = Router();

// ── GET /api/compliance/report ────────────────────────────────────────────────
// Full subscriber compliance report for a given customer & date range.

router.get("/compliance/report", async (req, res) => {
  const customerId = parseInt(req.query.customerId as string || "0");
  const from = req.query.from ? new Date(req.query.from as string) : new Date(Date.now() - 90 * 86400_000);
  const to   = req.query.to   ? new Date(req.query.to   as string) : new Date();

  if (!customerId) { res.status(400).json({ error: "customerId required" }); return; }

  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, customerId));
  if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }

  const subs = await db
    .select({ sub: subscriptionsTable, plan: plansTable })
    .from(subscriptionsTable)
    .leftJoin(plansTable, eq(subscriptionsTable.planId, plansTable.id))
    .where(eq(subscriptionsTable.customerId, customerId));

  const logs = await db
    .select()
    .from(sessionLogsTable)
    .where(and(
      eq(sessionLogsTable.customerId, customerId),
      gte(sessionLogsTable.sessionStart, from),
      lte(sessionLogsTable.sessionStart, to),
    ))
    .orderBy(desc(sessionLogsTable.sessionStart));

  const totalBytesIn  = logs.reduce((s, l) => s + (l.bytesIn  ?? 0), 0);
  const totalBytesOut = logs.reduce((s, l) => s + (l.bytesOut ?? 0), 0);

  res.json({
    generatedAt: new Date().toISOString(),
    period: { from: from.toISOString(), to: to.toISOString() },
    customer,
    subscriptions: subs.map(r => ({ ...r.sub, plan: r.plan })),
    sessions: logs,
    summary: {
      totalSessions: logs.length,
      totalBytesIn,
      totalBytesOut,
      totalBytes: totalBytesIn + totalBytesOut,
    },
  });
});

// ── GET /api/compliance/sessions ──────────────────────────────────────────────
// Search sessions by IP or MAC (useful when only a network identifier is known)

router.get("/compliance/sessions", async (req, res) => {
  const ip  = (req.query.ip  as string | undefined)?.trim();
  const mac = (req.query.mac as string | undefined)?.trim();
  const from = req.query.from ? new Date(req.query.from as string) : new Date(Date.now() - 90 * 86400_000);
  const to   = req.query.to   ? new Date(req.query.to   as string) : new Date();

  if (!ip && !mac) { res.status(400).json({ error: "ip or mac required" }); return; }

  const logs = await db
    .select({ log: sessionLogsTable, customer: customersTable })
    .from(sessionLogsTable)
    .leftJoin(customersTable, eq(sessionLogsTable.customerId, customersTable.id))
    .where(and(
      gte(sessionLogsTable.sessionStart, from),
      lte(sessionLogsTable.sessionStart, to),
    ))
    .orderBy(desc(sessionLogsTable.sessionStart))
    .limit(500);

  const filtered = logs.filter(r =>
    (ip  && r.log.ipAddress?.toLowerCase().includes(ip.toLowerCase())) ||
    (mac && r.log.macAddress?.toLowerCase().replace(/[:-]/g, "") === mac.toLowerCase().replace(/[:-]/g, ""))
  );

  res.json(filtered.map(r => ({ ...r.log, customer: r.customer })));
});

// ── POST /api/customers/:id/sessions/log ──────────────────────────────────────
// Called alongside snapshot saves to maintain persistent session logs

router.post("/customers/:id/sessions/log", async (req, res) => {
  const customerId = parseInt(req.params.id!);
  const { sessions } = req.body as {
    sessions: Array<{
      subscriptionId: number;
      pppoeUsername: string | null;
      ipAddress: string | null;
      macAddress: string | null;
      sessionType: string;
      routerName: string | null;
      bytesIn: number;
      bytesOut: number;
      online: boolean;
    }>;
  };

  if (!Array.isArray(sessions)) { res.status(400).json({ error: "sessions array required" }); return; }

  for (const s of sessions) {
    if (s.online) {
      // Check for an open (no sessionEnd) log for this subscription
      const [open] = await db
        .select({ id: sessionLogsTable.id })
        .from(sessionLogsTable)
        .where(and(
          eq(sessionLogsTable.subscriptionId, s.subscriptionId),
          isNull(sessionLogsTable.sessionEnd),
        ))
        .limit(1);

      if (open) {
        // Update bytes on the open session
        await db
          .update(sessionLogsTable)
          .set({ bytesIn: s.bytesIn, bytesOut: s.bytesOut })
          .where(eq(sessionLogsTable.id, open.id));
      } else {
        // Create new session log entry
        await db.insert(sessionLogsTable).values({
          customerId,
          subscriptionId: s.subscriptionId,
          pppoeUsername:  s.pppoeUsername,
          ipAddress:      s.ipAddress,
          macAddress:     s.macAddress,
          sessionType:    s.sessionType ?? "pppoe",
          routerName:     s.routerName,
          bytesIn:        s.bytesIn,
          bytesOut:       s.bytesOut,
        });
      }
    } else {
      // Close any open session for this subscription
      await db
        .update(sessionLogsTable)
        .set({ sessionEnd: new Date() })
        .where(and(
          eq(sessionLogsTable.subscriptionId, s.subscriptionId),
          isNull(sessionLogsTable.sessionEnd),
        ));
    }
  }

  res.status(201).json({ ok: true });
});

export default router;
