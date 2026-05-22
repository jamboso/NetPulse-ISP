import { Router } from "express";
import { db, auditLogsTable } from "@workspace/db";
import { eq, and, gte, lte, desc, ilike } from "drizzle-orm";
import { requireRole } from "../middlewares/requireRole";
import { purgeAuditLogs } from "../lib/auditLogPurge";

const router = Router();

function buildAuditConditions(query: Record<string, string>) {
  const { entityType, entityId, userId, userEmail, action, from, to } = query;
  const conditions = [];
  if (entityType) conditions.push(eq(auditLogsTable.entityType, entityType));
  if (entityId)   conditions.push(eq(auditLogsTable.entityId, parseInt(entityId)));
  if (userId)     conditions.push(eq(auditLogsTable.userId, userId));
  if (userEmail)  conditions.push(ilike(auditLogsTable.userEmail, `%${userEmail}%`));
  if (action)     conditions.push(eq(auditLogsTable.action, action));
  if (from)       conditions.push(gte(auditLogsTable.createdAt, new Date(from)));
  if (to)         conditions.push(lte(auditLogsTable.createdAt, new Date(to)));
  return conditions;
}

function flattenDiff(diff: unknown): string {
  if (diff == null) return "";
  if (typeof diff !== "object") return String(diff);
  const d = diff as Record<string, unknown>;
  if ("before" in d || "after" in d) {
    const before = (d.before ?? {}) as Record<string, unknown>;
    const after  = (d.after  ?? {}) as Record<string, unknown>;
    const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
    return keys
      .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
      .map((k) => `${k}: ${JSON.stringify(before[k] ?? null)} → ${JSON.stringify(after[k] ?? null)}`)
      .join("; ");
  }
  return JSON.stringify(diff);
}

function escapeCsv(value: string): string {
  const FORMULA_CHARS = ["=", "+", "-", "@", "\t", "\r"];
  let safe = FORMULA_CHARS.some((c) => value.startsWith(c)) ? `'${value}` : value;
  if (safe.includes('"') || safe.includes(",") || safe.includes("\n")) {
    safe = `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

router.get("/audit-logs", requireRole("admin"), async (req, res) => {
  const {
    page = "1",
    limit = "50",
    ...filters
  } = req.query as Record<string, string>;

  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(200, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = buildAuditConditions(filters);
  let query = db.select().from(auditLogsTable).orderBy(desc(auditLogsTable.createdAt)).$dynamic();
  if (conditions.length > 0) {
    query = query.where(conditions.length === 1 ? conditions[0]! : and(...conditions));
  }

  const rows = await query.limit(limitNum).offset(offset);
  res.json({ data: rows, page: pageNum, limit: limitNum });
});

router.get("/audit-logs/export.csv", requireRole("admin"), async (req, res) => {
  const conditions = buildAuditConditions(req.query as Record<string, string>);
  let query = db.select().from(auditLogsTable).orderBy(desc(auditLogsTable.createdAt)).$dynamic();
  if (conditions.length > 0) {
    query = query.where(conditions.length === 1 ? conditions[0]! : and(...conditions));
  }

  const rows = await query.limit(10000);

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="audit-log-${Date.now()}.csv"`);

  const header = ["Timestamp", "User Email", "User ID", "Action", "Entity Type", "Entity ID", "Diff Summary"];
  res.write(header.map(escapeCsv).join(",") + "\r\n");

  for (const row of rows) {
    const line = [
      row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
      row.userEmail ?? "",
      row.userId,
      row.action,
      row.entityType,
      row.entityId != null ? String(row.entityId) : "",
      flattenDiff(row.diff),
    ].map(escapeCsv).join(",");
    res.write(line + "\r\n");
  }

  res.end();
});

router.post("/audit-logs/purge", requireRole("admin"), async (req, res) => {
  const deleted = await purgeAuditLogs();
  res.json({ deleted });
});

export default router;
