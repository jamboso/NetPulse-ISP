/**
 * Router Monitor — polls every 3 minutes, sends SMS on state change.
 *
 * State transitions:
 *   unknown  → offline  : no alert (first boot, don't spam)
 *   online   → offline  : ALERT — router down
 *   offline  → online   : ALERT — router recovered
 *
 * A state flip is only confirmed after 2 consecutive checks in the new state
 * (avoids false positives from momentary timeouts).
 */

import { db } from "@workspace/db";
import { routersTable } from "@workspace/db";
import { getSettings, sendSms, logSms } from "./sms";
import { logger } from "./logger";

const POLL_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes

type RouterState = "unknown" | "online" | "offline";

// in-memory state: routerId → { confirmed, pending, pendingCount }
const stateMap = new Map<number, {
  confirmed:    RouterState;
  pending:      RouterState | null;
  pendingCount: number;
  name:         string;
  ipAddress:    string;
}>();

// ── Quick connectivity check (3-second timeout) ────────────────────────────────

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

// ── Send alert SMS ─────────────────────────────────────────────────────────────

async function sendRouterAlert(
  routerName: string,
  ipAddress:  string,
  state:      "online" | "offline",
  settings:   Record<string, string>,
): Promise<void> {
  const phone = settings.alertPhone?.trim();
  if (!phone) return;

  const ts   = new Date().toLocaleString("en-KE", { timeZone: settings.timezone || "Africa/Nairobi" });
  const msg  = state === "offline"
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

// ── Poll loop ──────────────────────────────────────────────────────────────────

async function pollRouters(): Promise<void> {
  const settings = await getSettings();
  const alertPhone = settings.alertPhone?.trim();
  if (!settings.smsProvider || !alertPhone) return; // no-op if not configured

  const routers = await db
    .select({
      id:        routersTable.id,
      name:      routersTable.name,
      ipAddress: routersTable.ipAddress,
      apiSsl:    routersTable.apiSsl,
      username:  routersTable.username,
      password:  routersTable.password,
      enabled:   routersTable.enabled,
      routerType: routersTable.routerType,
    })
    .from(routersTable);

  await Promise.all(routers.map(async r => {
    // Only monitor enabled RouterOS devices
    if (!r.enabled || r.routerType !== "routeros") return;

    const reachable = await isReachable(r);
    const newState: RouterState = reachable ? "online" : "offline";

    const existing = stateMap.get(r.id) ?? {
      confirmed: "unknown" as RouterState,
      pending: null,
      pendingCount: 0,
      name: r.name,
      ipAddress: r.ipAddress,
    };

    if (newState === existing.confirmed) {
      // Same as confirmed state — clear any pending flip
      stateMap.set(r.id, { ...existing, pending: null, pendingCount: 0 });
      return;
    }

    if (existing.pending === newState) {
      // Second consecutive check in new state — confirm the flip
      const prevConfirmed = existing.confirmed;
      stateMap.set(r.id, { ...existing, confirmed: newState, pending: null, pendingCount: 0 });

      // Only send alert if we're moving FROM a known state (not from unknown on first boot)
      if (prevConfirmed !== "unknown") {
        logger.info({ router: r.name, from: prevConfirmed, to: newState }, "Router state change confirmed");
        await sendRouterAlert(r.name, r.ipAddress, newState, settings);
      } else {
        logger.info({ router: r.name, state: newState }, "Router initial state detected (no alert)");
      }
    } else {
      // First time seeing this new state — mark as pending
      stateMap.set(r.id, { ...existing, pending: newState, pendingCount: 1 });
    }
  }));
}

// ── Start ──────────────────────────────────────────────────────────────────────

export function startRouterMonitor(): void {
  // First run after 1 minute (allow routers to settle on startup)
  setTimeout(() => {
    pollRouters().catch(err => logger.warn({ err }, "Router monitor: first poll failed"));

    setInterval(() => {
      pollRouters().catch(err => logger.warn({ err }, "Router monitor: poll failed"));
    }, POLL_INTERVAL_MS);
  }, 60_000);

  logger.info({ intervalMs: POLL_INTERVAL_MS }, "Router monitor started");
}
