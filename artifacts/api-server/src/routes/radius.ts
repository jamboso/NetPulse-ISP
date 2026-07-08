import { Router } from "express";
import { db } from "@workspace/db";
import { radacctTable, subscriptionsTable } from "@workspace/db";
import { eq, inArray, desc } from "drizzle-orm";
import { syncAllSubscriptions, syncStaffUserRadius } from "../lib/radiusSync";
import { requireRole } from "../middlewares/requireRole";
import { getRouter, getRadiusConfig, upsertRos, rosReq } from "./pppoe";
import { auth } from "../lib/auth";

const router = Router();

// ── POST /api/routers/:id/ros/radius/admin-login ──────────────────────────────
// Configures the MikroTik router so staff/admin logins (Winbox, SSH, web,
// API, telnet) are authenticated against the app's RADIUS server, instead of
// (or in addition to) local RouterOS user accounts. This is separate from PPP
// AAA (subscriber PPPoE auth) — RouterOS keeps these as distinct AAA settings
// under `/radius` (service=login) and `/user/aaa`.
router.post("/routers/:id/ros/radius/admin-login", requireRole("admin"), async (req, res) => {
  const r = await getRouter(parseInt(req.params["id"] as string));
  if (!r) { res.status(404).json({ error: "Router not found" }); return; }

  const radius = await getRadiusConfig(r);
  if (!radius) {
    res.status(400).json({
      error: "RADIUS is not configured yet. Set a RADIUS server & secret in Settings → Network first.",
    });
    return;
  }

  const { ipAddress: ip, apiSsl: ssl, username: user, password: pass } = r;
  const steps: string[] = [];
  const errors: string[] = [];

  async function tryStep(label: string, fn: () => Promise<unknown>) {
    try { await fn(); steps.push(`✓ ${label}`); }
    catch (e: any) { errors.push(`✗ ${label}: ${e.message}`); }
  }

  await tryStep("Add RADIUS server for router login", () =>
    upsertRos(ip, ssl ?? false, user, pass, "/radius", {
      address: radius.server,
      service: "login",
    }, {
      secret: radius.secret,
      "authentication-port": String(radius.authPort),
      "accounting-port": String(radius.acctPort),
      disabled: "no",
    })
  );
  await tryStep("Enable RADIUS for router admin login (Winbox/SSH/web/API)", () =>
    rosReq(ip, ssl ?? false, user, pass, "PATCH", "/user/aaa", {
      "use-radius": "yes",
    })
  );

  res.json({ success: errors.length === 0, steps, errors });
});

// ── POST /api/radius/staff-login/sync ──────────────────────────────────────
// Self-service sync for the *current* signed-in staff/admin user. Needed
// because better-auth stores passwords hashed — the app can only mirror a
// plaintext password into FreeRADIUS's radcheck table at the moment it is
// known (sign-up, change-password, or here, by re-confirming it). This lets
// existing accounts (created before RADIUS admin-login existed) start
// logging into routers via RADIUS without changing their app password.
router.post("/radius/staff-login/sync", async (req, res) => {
  const { password } = req.body as { password?: string };
  if (!password) {
    res.status(400).json({ error: "Password is required." });
    return;
  }

  const user = req.user!;
  try {
    const check = await auth.api.signInEmail({
      body: { email: user.email, password },
    });
    if (!check?.user) {
      res.status(400).json({ error: "Incorrect password." });
      return;
    }
  } catch {
    res.status(400).json({ error: "Incorrect password." });
    return;
  }

  await syncStaffUserRadius(user.email, password);
  res.json({ success: true });
});

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
