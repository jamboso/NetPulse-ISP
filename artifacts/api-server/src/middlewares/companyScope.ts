import type { Request, Response, NextFunction } from "express";
import { db, companiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Resolves the effective companyId to scope tenant-owned queries by.
 *
 * - "owner" role users are not scoped to a company. Their requests to
 *   regular tenant routes (customers, invoices, etc) are only meaningful if
 *   they pass an explicit `?companyId=` query param or a trusted
 *   `x-netpulse-company-id` request header (used sparingly by tenant-aware
 *   workspace tools); otherwise this returns null and route handlers should
 *   treat that as "no data" rather than leaking cross-tenant rows.
 * - Every other role must have a companyId on their user record (assigned
 *   at account creation). Requests from users with no companyId are
 *   rejected — this should never happen in practice once all staff
 *   accounts are migrated, but fails safe instead of leaking data.
 */
export async function resolveCompanyScope(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (user.role === "owner") {
    const explicitCompanyScope = req.query["companyId"] ?? req.headers["x-netpulse-company-id"];
    const queryCompanyId = Number(Array.isArray(explicitCompanyScope) ? explicitCompanyScope[0] : explicitCompanyScope);
    req.companyId = Number.isFinite(queryCompanyId) && queryCompanyId > 0 ? queryCompanyId : null;
    next();
    return;
  }

  if (!user.companyId) {
    res.status(403).json({ error: "Forbidden: account is not assigned to a company" });
    return;
  }

  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, user.companyId));
  if (!company) {
    res.status(403).json({ error: "Forbidden: company not found" });
    return;
  }

  const expired = company.accessUntil != null && company.accessUntil.getTime() < Date.now();
  const suspended = company.accessStatus === "suspended" || expired;
  if (suspended && !company.exempt) {
    res.status(402).json({
      error: "Service suspended",
      code: "COMPANY_SUSPENDED",
      message: "Your organisation's access has been suspended or its subscription has expired. Please contact your provider to restore access.",
    });
    return;
  }

  req.companyId = user.companyId;
  next();
}
