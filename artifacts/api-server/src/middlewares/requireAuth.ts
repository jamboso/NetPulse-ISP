import { auth } from "../lib/auth";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const session = await auth.api.getSession({ headers: req.headers as Record<string, string> });
    if (!session?.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    // Bypass the session cookie cache: verify active status directly from DB
    // so that deactivated accounts are rejected immediately without waiting for cache expiry.
    const [dbUser] = await db
      .select({ active: usersTable.active })
      .from(usersTable)
      .where(eq(usersTable.id, session.user.id));
    if (!dbUser || dbUser.active === false) {
      res.status(401).json({ error: "Account is deactivated" });
      return;
    }
    req.user = session.user;
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}
