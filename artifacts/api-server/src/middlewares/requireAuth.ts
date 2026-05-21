import { auth } from "../lib/auth";
import type { Request, Response, NextFunction } from "express";

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const session = await auth.api.getSession({ headers: req.headers as Record<string, string> });
    if (!session?.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    (req as Request & { user: typeof session.user }).user = session.user;
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}
