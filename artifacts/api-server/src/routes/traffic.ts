/**
 * Network traffic analysis routes.
 *
 *  GET /api/network/traffic          — top domains + category breakdown + daily trend
 *  GET /api/customers/:id/bandwidth-history — daily bandwidth totals for a customer
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { dnsObservationsTable, sessionLogsTable } from "@workspace/db";
import { and, gte, lte, eq, desc, sql } from "drizzle-orm";

const router = Router();

// ── GET /api/network/traffic ──────────────────────────────────────────────────
// Query params: routerId?, from? (YYYY-MM-DD), to? (YYYY-MM-DD), limit?

router.get("/network/traffic", async (req, res) => {
  const routerId = req.query.routerId ? parseInt(req.query.routerId as string) : null;
  const defaultFrom = new Date(Date.now() - 7 * 86400_000).toISOString().split("T")[0]!;
  const from  = (req.query.from  as string | undefined) ?? defaultFrom;
  const to    = (req.query.to    as string | undefined) ?? new Date().toISOString().split("T")[0]!;
  const limit = Math.min(parseInt((req.query.limit as string) || "50"), 200);

  const conds = [
    gte(dnsObservationsTable.recordedDate, from),
    lte(dnsObservationsTable.recordedDate, to),
    ...(routerId ? [eq(dnsObservationsTable.routerId, routerId)] : []),
  ];

  // Top N domains ordered by cumulative hit count
  const topDomains = await db
    .select({
      domain:      dnsObservationsTable.domain,
      category:    dnsObservationsTable.category,
      totalHits:   sql<number>`SUM(${dnsObservationsTable.hitCount})::int`,
      lastSeen:    sql<string>`MAX(${dnsObservationsTable.lastSeen})`,
    })
    .from(dnsObservationsTable)
    .where(and(...conds))
    .groupBy(dnsObservationsTable.domain, dnsObservationsTable.category)
    .orderBy(desc(sql`SUM(${dnsObservationsTable.hitCount})`))
    .limit(limit);

  // Per-category totals
  const categoryTotals = await db
    .select({
      category:      dnsObservationsTable.category,
      totalHits:     sql<number>`SUM(${dnsObservationsTable.hitCount})::int`,
      uniqueDomains: sql<number>`COUNT(DISTINCT ${dnsObservationsTable.domain})::int`,
    })
    .from(dnsObservationsTable)
    .where(and(...conds))
    .groupBy(dnsObservationsTable.category)
    .orderBy(desc(sql`SUM(${dnsObservationsTable.hitCount})`));

  // Daily activity trend
  const dailyTrend = await db
    .select({
      date:          dnsObservationsTable.recordedDate,
      totalHits:     sql<number>`SUM(${dnsObservationsTable.hitCount})::int`,
      uniqueDomains: sql<number>`COUNT(DISTINCT ${dnsObservationsTable.domain})::int`,
    })
    .from(dnsObservationsTable)
    .where(and(...conds))
    .groupBy(dnsObservationsTable.recordedDate)
    .orderBy(dnsObservationsTable.recordedDate);

  res.json({ topDomains, categoryTotals, dailyTrend });
});

// ── GET /api/customers/:id/bandwidth-history ──────────────────────────────────
// Query params: from? (YYYY-MM-DD or ISO), to? (YYYY-MM-DD or ISO)
// Returns daily bandwidth aggregates derived from session_logs.

router.get("/customers/:id/bandwidth-history", async (req, res) => {
  const customerId = parseInt(req.params.id!);
  if (isNaN(customerId)) { res.status(400).json({ error: "invalid id" }); return; }

  const from = req.query.from
    ? new Date(req.query.from as string)
    : new Date(Date.now() - 365 * 86400_000);
  const to = req.query.to
    ? new Date(req.query.to as string)
    : new Date();

  // Adjust `to` to end of day
  to.setHours(23, 59, 59, 999);

  const rows = await db.execute(sql`
    SELECT
      DATE(session_start)::text            AS date,
      COALESCE(SUM(bytes_in),  0)::bigint  AS bytes_in,
      COALESCE(SUM(bytes_out), 0)::bigint  AS bytes_out,
      COUNT(*)::int                         AS sessions
    FROM session_logs
    WHERE customer_id = ${customerId}
      AND session_start >= ${from}
      AND session_start <= ${to}
    GROUP BY DATE(session_start)
    ORDER BY DATE(session_start) ASC
  `);

  res.json(rows.rows);
});

export default router;
