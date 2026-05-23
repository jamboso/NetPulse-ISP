import { Router } from "express";
import { db, securityEventsTable } from "@workspace/db";
import { desc, gte, lt, sql } from "drizzle-orm";
import { requireRole } from "../middlewares/requireRole";

const router = Router();

/** GET /security-events — paginated list of blocked callback attempts */
router.get("/security-events", requireRole("admin"), async (req, res) => {
  const { page = "1", limit = "50" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(200, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const rows = await db
    .select()
    .from(securityEventsTable)
    .orderBy(desc(securityEventsTable.createdAt))
    .limit(limitNum)
    .offset(offset);

  res.json({ data: rows, page: pageNum, limit: limitNum });
});

/** GET /security-events/summary — count of blocked attempts in the last 24 h + total */
router.get("/security-events/summary", requireRole("admin"), async (req, res) => {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [[last24h], [total]] = await Promise.all([
    db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(securityEventsTable)
      .where(gte(securityEventsTable.createdAt, since)),
    db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(securityEventsTable),
  ]);

  res.json({
    blockedLast24h: last24h?.count ?? 0,
    threshold: 5,
    totalCount: total?.count ?? 0,
  });
});

/** GET /security-events/export.csv — download all events as a CSV file */
router.get("/security-events/export.csv", requireRole("admin"), async (req, res) => {
  const rows = await db
    .select()
    .from(securityEventsTable)
    .orderBy(desc(securityEventsTable.createdAt));

  const header = "id,eventType,callerIp,endpoint,method,reason,createdAt";
  const escape = (v: string | number) => {
    const s = String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const lines = rows.map((r) =>
    [r.id, r.eventType, r.callerIp, r.endpoint, r.method, r.reason, r.createdAt.toISOString()]
      .map(escape)
      .join(",")
  );

  const csv = [header, ...lines].join("\r\n");
  const filename = `security-events-${new Date().toISOString().slice(0, 10)}.csv`;

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csv);
});

/** DELETE /security-events — remove records older than retentionDays (0 = all) */
router.delete("/security-events", requireRole("admin"), async (req, res) => {
  const raw = req.query.retentionDays as string | undefined;
  const parsed = raw !== undefined ? parseInt(raw, 10) : 0;
  if (raw !== undefined && (isNaN(parsed) || parsed < 0 || !Number.isInteger(parsed))) {
    res.status(400).json({ error: "retentionDays must be a non-negative integer" });
    return;
  }
  const retentionDays = parsed;

  let deletedCount: number;

  if (retentionDays === 0) {
    const [result] = await db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(securityEventsTable);
    await db.delete(securityEventsTable);
    deletedCount = result?.count ?? 0;
  } else {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const [result] = await db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(securityEventsTable)
      .where(lt(securityEventsTable.createdAt, cutoff));
    await db.delete(securityEventsTable).where(lt(securityEventsTable.createdAt, cutoff));
    deletedCount = result?.count ?? 0;
  }

  res.json({ deletedCount });
});

export default router;
