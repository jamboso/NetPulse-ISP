import type { User } from "../lib/auth";

declare global {
  namespace Express {
    interface Request {
      user?: User;
      companyId?: number | null;
    }
  }
}
