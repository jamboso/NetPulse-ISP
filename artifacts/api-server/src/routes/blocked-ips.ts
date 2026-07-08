import { Router } from "express";
import { db, blockedIpsTable } from "@workspace/db";
import { eq, gt, desc } from "drizzle-orm";
import { requireRole } from "../middlewares/requireRole";

const router = Router();

/** GET /blocked-ips — list all currently active (non-expired) blocked IPs */
router.get("/blocked-ips", requireRole("admin"), async (req, res) => {
  const now = new Date();
  const rows = await db
    .select()
    .from(blockedIpsTable)
    .where(gt(blockedIpsTable.expiresAt, now))
    .orderBy(desc(blockedIpsTable.blockedAt));

  res.json({ data: rows });
});

/** DELETE /blocked-ips/:ip — manually unblock an IP */
router.delete("/blocked-ips/:ip", requireRole("admin"), async (req, res) => {
  const ipParam = req.params["ip"];
  const ip = Array.isArray(ipParam) ? ipParam[0] : ipParam;

  if (!ip) {
    res.status(400).json({ error: "IP address is required" });
    return;
  }

  const result = await db
    .delete(blockedIpsTable)
    .where(eq(blockedIpsTable.ip, ip))
    .returning({ id: blockedIpsTable.id });

  if (result.length === 0) {
    res.status(404).json({ error: "No active block found for this IP" });
    return;
  }

  res.json({ success: true, ip });
});

export default router;
