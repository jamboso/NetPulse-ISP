/**
 * Router Monitor — polls every 3 minutes, sends SMS on state change.
 *
 * State machine per router:
 *   - Confirmed state persisted to DB (survives server restarts)
 *   - A flip is confirmed after 2 consecutive checks in the new state
 *     (avoids false positives from momentary timeouts)
 *   - unknown → offline  : no alert  (DB had no prior state, e.g. new router)
 *   - online  → offline  : ALERT — router down
 *   - offline → online   : ALERT — router recovered
 */

import { db } from "@workspace/db";
import { routersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getSettings, sendSms, logSms } from "./sms";
import { logger } from "./logger";

const POLL_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes

type RouterState = "unknown" | "online" | "offline";

interface RouterEntry {
  confirmed:    RouterState;
  pending:      RouterState | null;
  pendingCount: number;
  name:         string;
  ipAddress:    string;
}

// in-memory working state — seeded from DB on first poll
const stateMap = new Map<number, RouterEntry>();
let seeded = false;

// ── Connectivity check (3-second timeout) ─────────────────────────────────────

async function isReachable(r: {
  ipAddress: string; apiSsl: boolean | null;
  username: string; password: string;
}): Promise<boolean> {
  const scheme = r.apiSsl ? "https" : "http";
  const url    = `${scheme}://${r.ipAddress}/rest/system/identity`;
  const creds  = Buffer.from(`${r.username}:${r.password}`).toString("base64");
  const ctrl   = new AbortController();
  const timer  = setTimeout(() => ctrl.abort(), 3000);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${creds}`, Accept: "application/json" },
      signal:  ctrl.signal,
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    clearTimeout(timer);
    return false;
  }
}

// ── Persist confirmed state to DB ─────────────────────────────────────────────

async function persistState(routerId: number, state: RouterState): Promise<void> {
  try {
    await db.update(routersTable)
      .set({ monitorState: state === "unknown" ? null : state })
      .where(eq(routersTable.id, routerId));
  } catch (err) {
    logger.warn({ err, routerId }, "Router monitor: failed to persist state");
  }
}

// ── Alert SMS ─────────────────────────────────────────────────────────────────

async function sendRouterAlert(
  routerName: string,
  ipAddress:  string,
  state:      "online" | "offline",
  settings:   Record<string, string>,
): Promise<void> {
  const phone = settings.alertPhone?.trim();
  if (!phone) return;

  const ts  = new Date().toLocaleString("en-KE", { timeZone: settings.timezone || "Africa/Nairobi" });
  const msg = state === "offline"
    ? `[NetPulse ALERT] Router "${routerName}" (${ipAddress}) is OFFLINE. Detected at ${ts}. Please investigate immediately.`
    : `[NetPulse OK] Router "${routerName}" (${ipAddress}) is back ONLINE. Recovered at ${ts}.`;

  const result = await sendSms(settings, phone, msg);

  await logSms({
    customerId:  null,
    phone,
    message:     msg,
    triggerType: state === "offline" ? "router_down" : "router_up",
    status:      result.success ? "sent" : "failed",
    error:       result.success ? null : result.message,
  });

  logger.info({ routerName, state, phone, success: result.success }, "Router alert SMS sent");
}

// ── Seed in-memory state from DB ──────────────────────────────────────────────

async function seedFromDb(routers: Array<{ id: number; name: string; ipAddress: string; monitorState: string | null }>): Promise<void> {
  for (const r of routers) {
    if (stateMap.has(r.id)) continue; // already seeded (e.g. mid-run re-call)
    const saved = r.monitorState as RouterState | null;
    stateMap.set(r.id, {
      confirmed:    saved ?? "unknown",
      pending:      null,
      pendingCount: 0,
      name:         r.name,
      ipAddress:    r.ipAddress,
    });
  }
}

// ── Poll loop ──────────────────────────────────────────────────────────────────

async function pollRouters(): Promise<void> {
  const settings   = await getSettings();
  const alertPhone = settings.alertPhone?.trim();
  if (!settings.smsProvider || !alertPhone) {
    logger.info("Router monitor: skipping poll — smsProvider or alertPhone not configured");
    return;
  }

  const routers = await db
    .select({
      id:           routersTable.id,
      name:         routersTable.name,
      ipAddress:    routersTable.ipAddress,
      apiSsl:       routersTable.apiSsl,
      username:     routersTable.username,
      password:     routersTable.password,
      enabled:      routersTable.enabled,
      routerType:   routersTable.routerType,
      monitorState: routersTable.monitorState,
    })
    .from(routersTable);

  // On first poll, seed confirmed states from DB so restarts don't reset history
  if (!seeded) {
    await seedFromDb(routers);
    seeded = true;
  }

  await Promise.all(routers.map(async r => {
    if (!r.enabled || r.routerType !== "routeros") return;

    const reachable = await isReachable(r);
    const newState: RouterState = reachable ? "online" : "offline";

    const existing = stateMap.get(r.id) ?? {
      confirmed:    "unknown" as RouterState,
      pending:      null,
      pendingCount: 0,
      name:         r.name,
      ipAddress:    r.ipAddress,
    };

    logger.info({ router: r.name, reachable, confirmed: existing.confirmed, pending: existing.pending }, "Router poll result");

    if (newState === existing.confirmed) {
      // Stable — clear any pending flip
      stateMap.set(r.id, { ...existing, pending: null, pendingCount: 0 });
      return;
    }

    if (existing.pending === newState) {
      // Second consecutive check in new state — confirm the flip
      const prevConfirmed = existing.confirmed;
      stateMap.set(r.id, { ...existing, confirmed: newState, pending: null, pendingCount: 0 });
      await persistState(r.id, newState);

      if (prevConfirmed !== "unknown") {
        logger.info({ router: r.name, from: prevConfirmed, to: newState }, "Router state change confirmed — sending alert");
        await sendRouterAlert(r.name, r.ipAddress, newState, settings);
      } else {
        // First-ever detection for this router (no prior DB state)
        logger.info({ router: r.name, state: newState }, "Router initial state confirmed (no alert)");
      }
    } else {
      // First check in a new state — mark pending, wait for confirmation
      logger.info({ router: r.name, currentConfirmed: existing.confirmed, pendingNew: newState }, "Router state change pending confirmation");
      stateMap.set(r.id, { ...existing, pending: newState, pendingCount: 1 });
    }
  }));
}

// ── Start ──────────────────────────────────────────────────────────────────────

export function startRouterMonitor(): void {
  // First poll after 1 minute (allow server to fully start)
  setTimeout(() => {
    pollRouters().catch(err => logger.warn({ err }, "Router monitor: first poll failed"));

    setInterval(() => {
      pollRouters().catch(err => logger.warn({ err }, "Router monitor: poll failed"));
    }, POLL_INTERVAL_MS);
  }, 60_000);

  logger.info({ intervalMs: POLL_INTERVAL_MS }, "Router monitor started");
}
