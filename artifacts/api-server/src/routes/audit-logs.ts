import { Router } from "express";
import { db, auditLogsTable } from "@workspace/db";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { requireRole } from "../middlewares/requireRole";

const router = Router();

router.get("/audit-logs", requireRole("admin"), async (req, res) => {
  const {
    entityType,
    entityId,
    userId,
    action,
    from,
    to,
    page = "1",
    limit = "50",
  } = req.query as Record<string, string>;

  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(200, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  if (entityType) conditions.push(eq(auditLogsTable.entityType, entityType));
  if (entityId)   conditions.push(eq(auditLogsTable.entityId, parseInt(entityId)));
  if (userId)     conditions.push(eq(auditLogsTable.userId, userId));
  if (action)     conditions.push(eq(auditLogsTable.action, action));
  if (from)       conditions.push(gte(auditLogsTable.createdAt, new Date(from)));
  if (to)         conditions.push(lte(auditLogsTable.createdAt, new Date(to)));

  let query = db.select().from(auditLogsTable).orderBy(desc(auditLogsTable.createdAt)).$dynamic();
  if (conditions.length > 0) {
    query = query.where(conditions.length === 1 ? conditions[0]! : and(...conditions));
  }

  const rows = await query.limit(limitNum).offset(offset);
  res.json({ data: rows, page: pageNum, limit: limitNum });
});

export default router;
