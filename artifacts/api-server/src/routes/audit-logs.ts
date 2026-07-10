import { Router } from "express";
import { db, auditLogsTable, auditPurgeLogTable } from "@workspace/db";
import { eq, and, gte, lte, desc, ilike, isNull, or } from "drizzle-orm";
import { requireRole } from "../middlewares/requireRole";
import { purgeAuditLogs } from "../lib/auditLogPurge";
import { resolveCompanyScope } from "../middlewares/companyScope";
import type { Request } from "express";

const router = Router();
router.use(resolveCompanyScope);

// Company admins only ever see their own tenant's history (plus untagged
// legacy/global rows, e.g. entries written before companyId existed). The
// owner sees everything unless they explicitly narrow with ?companyId=.
function companyAuditCondition(req: Request) {
  if (req.user!.role === "owner") {
    return req.companyId != null ? eq(auditLogsTable.companyId, req.companyId) : undefined;
  }
  return req.companyId != null
    ? or(eq(auditLogsTable.companyId, req.companyId), isNull(auditLogsTable.companyId))
    : undefined;
}

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
  const scope = companyAuditCondition(req);
  if (scope) conditions.push(scope);
  let query = db.select().from(auditLogsTable).orderBy(desc(auditLogsTable.createdAt)).$dynamic();
  if (conditions.length > 0) {
    query = query.where(conditions.length === 1 ? conditions[0]! : and(...conditions));
  }

  const rows = await query.limit(limitNum).offset(offset);
  res.json({ data: rows, page: pageNum, limit: limitNum });
});

router.get("/audit-logs/export.csv", requireRole("admin"), async (req, res) => {
  const conditions = buildAuditConditions(req.query as Record<string, string>);
  const scope = companyAuditCondition(req);
  if (scope) conditions.push(scope);
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

// Purge operates globally across all tenants' audit history, so it is
// owner-only — a company admin must never be able to wipe another
// tenant's (or their own tenant's shared/global) audit trail.
router.get("/audit-logs/purge-history", requireRole("owner"), async (req, res) => {
  const rows = await db
    .select()
    .from(auditPurgeLogTable)
    .orderBy(desc(auditPurgeLogTable.purgedAt))
    .limit(20);
  res.json({ data: rows });
});

router.post("/audit-logs/purge", requireRole("owner"), async (req, res) => {
  const deleted = await purgeAuditLogs("manual");
  res.json({ deleted });
});

export default router;
