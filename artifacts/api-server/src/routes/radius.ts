import { Router } from "express";
import { db } from "@workspace/db";
import { radacctTable, subscriptionsTable } from "@workspace/db";
import { eq, inArray, desc } from "drizzle-orm";
import { syncAllSubscriptions } from "../lib/radiusSync";
import { requireRole } from "../middlewares/requireRole";

const router = Router();

router.get("/customers/:id/radius-sessions", async (req, res) => {
  const customerId = parseInt(req.params["id"] as string);

  const subs = await db
    .select({ id: subscriptionsTable.id, pppoeUsername: subscriptionsTable.pppoeUsername })
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.customerId, customerId));

  const usernames = subs
    .map(s => s.pppoeUsername)
    .filter((u): u is string => !!u);

  if (usernames.length === 0) {
    res.json([]);
    return;
  }

  const sessions = await db
    .select()
    .from(radacctTable)
    .where(inArray(radacctTable.username, usernames))
    .orderBy(desc(radacctTable.acctstarttime))
    .limit(200);

  res.json(sessions.map(s => ({
    id:                s.radacctid,
    username:          s.username,
    nasIp:             s.nasipaddress,
    sessionId:         s.acctsessionid,
    startTime:         s.acctstarttime?.toISOString() ?? null,
    stopTime:          s.acctstoptime?.toISOString() ?? null,
    updateTime:        s.acctupdatetime?.toISOString() ?? null,
    sessionTimeSecs:   s.acctsessiontime ?? 0,
    bytesIn:           s.acctinputoctets ?? 0,
    bytesOut:          s.acctoutputoctets ?? 0,
    framedIp:          s.framedipaddress ?? null,
    callingStation:    s.callingstationid ?? null,
    calledStation:     s.calledstationid ?? null,
    terminateCause:    s.acctterminatecause ?? null,
    active:            s.acctstoptime === null,
  })));
});

router.post("/admin/radius/sync", requireRole("admin"), async (req, res) => {
  try {
    const result = await syncAllSubscriptions();
    req.log.info({ result }, "Manual RADIUS re-sync completed");
    res.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Manual RADIUS re-sync failed");
    res.status(500).json({ ok: false, error: msg });
  }
});

export default router;
