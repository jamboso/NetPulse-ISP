import { Router } from "express";
import { db, auditLogsTable } from "@workspace/db";
import { paymentsTable, subscriptionsTable, plansTable, customersTable } from "@workspace/db";
import { eq, gte, and, sql, desc } from "drizzle-orm";
import { requireRole } from "../middlewares/requireRole.js";

const router = Router();

/*
 * GET /api/sales/summary
 * KPIs: revenue, new subscriptions, active subs, MRR, churn
 * Admin + billing
 */
router.get("/sales/summary", requireRole("admin", "billing"), async (req, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    const [revThisMonth] = await db
      .select({ total: sql<string>`coalesce(sum(amount), 0)` })
      .from(paymentsTable)
      .where(and(eq(paymentsTable.status, "completed"), gte(paymentsTable.createdAt, startOfMonth)));

    const [revLastMonth] = await db
      .select({ total: sql<string>`coalesce(sum(amount), 0)` })
      .from(paymentsTable)
      .where(
        and(
          eq(paymentsTable.status, "completed"),
          gte(paymentsTable.createdAt, startOfLastMonth),
          sql`${paymentsTable.createdAt} <= ${endOfLastMonth}`,
        ),
      );

    const [subsThisMonth] = await db
      .select({ count: sql<string>`count(*)` })
      .from(subscriptionsTable)
      .where(gte(subscriptionsTable.createdAt, startOfMonth));

    const [subsLastMonth] = await db
      .select({ count: sql<string>`count(*)` })
      .from(subscriptionsTable)
      .where(
        and(
          gte(subscriptionsTable.createdAt, startOfLastMonth),
          sql`${subscriptionsTable.createdAt} <= ${endOfLastMonth}`,
        ),
      );

    const [activeSubs] = await db
      .select({ count: sql<string>`count(*)` })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.status, "active"));

    const [totalCustomers] = await db
      .select({ count: sql<string>`count(*)` })
      .from(customersTable);

    const [allTimeRev] = await db
      .select({ total: sql<string>`coalesce(sum(amount), 0)` })
      .from(paymentsTable)
      .where(eq(paymentsTable.status, "completed"));

    res.json({
      revenueThisMonth: Number(revThisMonth?.total ?? 0),
      revenueLastMonth: Number(revLastMonth?.total ?? 0),
      newSubsThisMonth: Number(subsThisMonth?.count ?? 0),
      newSubsLastMonth: Number(subsLastMonth?.count ?? 0),
      activeSubs: Number(activeSubs?.count ?? 0),
      totalCustomers: Number(totalCustomers?.count ?? 0),
      allTimeRevenue: Number(allTimeRev?.total ?? 0),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch sales summary");
    res.status(500).json({ error: "Failed to fetch sales summary" });
  }
});

/*
 * GET /api/sales/trends?period=30d|90d|12m
 * Returns daily (30d/90d) or monthly (12m) revenue + new-subscriptions data points.
 */
router.get("/sales/trends", requireRole("admin", "billing"), async (req, res) => {
  const period = (req.query["period"] as string) || "30d";

  try {
    let points: { date: string; revenue: number; newSubs: number }[] = [];

    if (period === "12m") {
      const rows = await db.execute(sql`
        SELECT
          to_char(date_trunc('month', gs), 'YYYY-MM') AS month,
          coalesce(sum(p.amount) FILTER (WHERE p.status = 'completed'), 0) AS revenue,
          coalesce(count(DISTINCT s.id), 0) AS new_subs
        FROM generate_series(
          date_trunc('month', now()) - interval '11 months',
          date_trunc('month', now()),
          '1 month'
        ) AS gs
        LEFT JOIN payments p ON date_trunc('month', p.created_at) = gs
        LEFT JOIN subscriptions s ON date_trunc('month', s.created_at) = gs
        GROUP BY month
        ORDER BY month
      `);
      points = (rows.rows as Array<{ month: string; revenue: string; new_subs: string }>).map((r) => ({
        date: r.month,
        revenue: Number(r.revenue),
        newSubs: Number(r.new_subs),
      }));
    } else {
      const days = period === "90d" ? 90 : 30;
      const rows = await db.execute(sql`
        SELECT
          to_char(gs::date, 'YYYY-MM-DD') AS day,
          coalesce(sum(p.amount) FILTER (WHERE p.status = 'completed'), 0) AS revenue,
          coalesce(count(DISTINCT s.id), 0) AS new_subs
        FROM generate_series(
          (now() - interval '1 day' * ${days})::date,
          now()::date,
          '1 day'
        ) AS gs
        LEFT JOIN payments p ON p.created_at::date = gs::date
        LEFT JOIN subscriptions s ON s.created_at::date = gs::date
        GROUP BY day
        ORDER BY day
      `);
      points = (rows.rows as Array<{ day: string; revenue: string; new_subs: string }>).map((r) => ({
        date: r.day,
        revenue: Number(r.revenue),
        newSubs: Number(r.new_subs),
      }));
    }

    res.json({ period, data: points });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch sales trends");
    res.status(500).json({ error: "Failed to fetch sales trends" });
  }
});

/*
 * GET /api/sales/by-plan
 * Revenue and subscription count broken down by service plan.
 */
router.get("/sales/by-plan", requireRole("admin", "billing"), async (req, res) => {
  try {
    const rows = await db
      .select({
        planId: plansTable.id,
        planName: plansTable.name,
        price: plansTable.price,
        billingCycle: plansTable.billingCycle,
        subsCount: sql<string>`count(s.id)`,
        activeSubs: sql<string>`count(s.id) filter (where s.status = 'active')`,
      })
      .from(plansTable)
      .leftJoin(subscriptionsTable, eq(subscriptionsTable.planId, plansTable.id))
      .where(eq(plansTable.isActive, true))
      .groupBy(plansTable.id)
      .orderBy(desc(sql`count(s.id)`));

    const data = rows.map((r) => ({
      planId: r.planId,
      planName: r.planName,
      price: Number(r.price),
      billingCycle: r.billingCycle,
      subsCount: Number(r.subsCount),
      activeSubs: Number(r.activeSubs),
      mrr: Number(r.price) * Number(r.activeSubs),
    }));

    res.json({ data });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch sales by plan");
    res.status(500).json({ error: "Failed to fetch sales by plan" });
  }
});

/*
 * GET /api/sales/staff-activity?days=30
 * Staff activity from audit logs — who created customers/subscriptions/payments.
 */
router.get("/sales/staff-activity", requireRole("admin", "billing"), async (req, res) => {
  const days = Math.min(Number(req.query["days"] ?? 30), 365);
  const since = new Date(Date.now() - days * 86400_000);

  try {
    const rows = await db.execute(sql`
      SELECT
        user_email,
        entity_type,
        action,
        count(*) AS count
      FROM audit_logs
      WHERE created_at >= ${since}
        AND action = 'create'
        AND entity_type IN ('customer', 'subscription', 'payment')
      GROUP BY user_email, entity_type, action
      ORDER BY user_email, entity_type
    `);

    type Row = { user_email: string; entity_type: string; count: string };
    const byStaff: Record<string, { email: string; customers: number; subscriptions: number; payments: number; total: number }> = {};

    for (const r of rows.rows as Row[]) {
      const email = r.user_email ?? "unknown";
      if (!byStaff[email]) byStaff[email] = { email, customers: 0, subscriptions: 0, payments: 0, total: 0 };
      const n = Number(r.count);
      if (r.entity_type === "customer") byStaff[email]!.customers += n;
      if (r.entity_type === "subscription") byStaff[email]!.subscriptions += n;
      if (r.entity_type === "payment") byStaff[email]!.payments += n;
      byStaff[email]!.total += n;
    }

    const data = Object.values(byStaff).sort((a, b) => b.total - a.total);
    res.json({ days, data });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch staff activity");
    res.status(500).json({ error: "Failed to fetch staff activity" });
  }
});

export default router;
