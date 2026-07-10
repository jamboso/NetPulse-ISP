import { db, companiesTable, usersTable } from "@workspace/db";
import { and, eq, isNull, ne } from "drizzle-orm";
import { logger } from "./logger";

const DEFAULT_COMPANY_ID = 1;

/**
 * Idempotent startup safeguard for the multi-tenant migration. Ensures:
 *  - the default company (id=1, exempt) exists, so pre-migration tenant
 *    data (which defaults companyId to 1) always resolves to a real row.
 *  - every non-owner user has a companyId, so existing staff accounts from
 *    before the multi-tenant conversion are never locked out by
 *    resolveCompanyScope after a deploy/merge.
 *
 * Runs on every boot; both operations are no-ops once applied.
 */
export async function ensureCompanyBackfill(): Promise<void> {
  const [defaultCompany] = await db.select().from(companiesTable).where(eq(companiesTable.id, DEFAULT_COMPANY_ID));

  if (!defaultCompany) {
    await db.insert(companiesTable).values({
      id: DEFAULT_COMPANY_ID,
      name: "Default Company",
      username: "DEFAULT",
      ownerEmail: "owner@localhost",
      accessStatus: "active",
      exempt: true,
      accessUntil: null,
    }).onConflictDoNothing();
    logger.info({ companyId: DEFAULT_COMPANY_ID }, "Created default company for multi-tenant backfill");
  }

  const orphaned = await db
    .update(usersTable)
    .set({ companyId: DEFAULT_COMPANY_ID })
    .where(and(ne(usersTable.role, "owner"), isNull(usersTable.companyId)))
    .returning({ id: usersTable.id });

  if (orphaned.length > 0) {
    logger.warn(
      { count: orphaned.length, userIds: orphaned.map(u => u.id) },
      "Backfilled companyId for users left without a tenant assignment",
    );
  }
}
