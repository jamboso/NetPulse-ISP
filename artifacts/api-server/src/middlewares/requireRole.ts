import type { Request, Response, NextFunction } from "express";

export type UserRole = "owner" | "admin" | "billing" | "support" | "technician";

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const userRole = (req.user as (typeof req.user & { role?: string }) | undefined)?.role;
    if (!userRole || !roles.includes(userRole as UserRole)) {
      res.status(403).json({ error: "Forbidden: insufficient permissions" });
      return;
    }
    next();
  };
}
