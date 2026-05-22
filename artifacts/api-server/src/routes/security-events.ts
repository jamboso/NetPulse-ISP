import { Router } from "express";
import { db, securityEventsTable } from "@workspace/db";
import { desc, gte, sql } from "drizzle-orm";
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

/** GET /security-events/summary — count of blocked attempts in the last 24 h */
router.get("/security-events/summary", requireRole("admin"), async (req, res) => {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [row] = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(securityEventsTable)
    .where(gte(securityEventsTable.createdAt, since));

  const count = row?.count ?? 0;
  res.json({ blockedLast24h: count, threshold: 5 });
});

export default router;
