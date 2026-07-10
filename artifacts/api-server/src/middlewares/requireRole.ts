import type { Request, Response, NextFunction } from "express";

export type UserRole = "owner" | "admin" | "billing" | "support" | "technician";

// "owner" is the platform superuser and is implicitly authorized for every
// role-gated route (it sits above the admin/billing/support/technician
// hierarchy). Callers should still list explicit roles for tenant staff.
export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const userRole = (req.user as (typeof req.user & { role?: string }) | undefined)?.role;
    if (!userRole) {
      res.status(403).json({ error: "Forbidden: insufficient permissions" });
      return;
    }
    if (userRole === "owner" || roles.includes(userRole as UserRole)) {
      next();
      return;
    }
    res.status(403).json({ error: "Forbidden: insufficient permissions" });
  };
}
