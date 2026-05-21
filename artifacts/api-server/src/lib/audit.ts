import { db, auditLogsTable } from "@workspace/db";

export type AuditAction =
  | "create"
  | "update"
  | "delete";

export type AuditEntityType =
  | "customer"
  | "invoice"
  | "payment"
  | "subscription";

interface AuditParams {
  userId: string;
  userEmail?: string | null;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId?: number | null;
  diff?: unknown;
}

export async function writeAuditLog(params: AuditParams): Promise<void> {
  try {
    await db.insert(auditLogsTable).values({
      userId:     params.userId,
      userEmail:  params.userEmail ?? null,
      action:     params.action,
      entityType: params.entityType,
      entityId:   params.entityId ?? null,
      diff:       params.diff ?? null,
    });
  } catch {
    // Audit log failures must never break the main request
  }
}
