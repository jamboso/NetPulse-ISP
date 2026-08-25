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
import { sendRouterAlertEmail } from "./mailer";
import { logger } from "./logger";
import { getRouterManagementHost } from "./routerManagement";

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

// ── Alert delivery ────────────────────────────────────────────────────────────

export function buildRouterAlertMessage(
  routerName: string,
  ipAddress: string,
  state: "online" | "offline",
  timezone: string,
): string {
  const timestamp = new Date().toLocaleString("en-KE", {
    timeZone: timezone || "Africa/Nairobi",
  });

  return state === "offline"
    ? `[NetPulse ALERT] Router "${routerName}" (${ipAddress}) is OFFLINE. Detected at ${timestamp}. Please investigate immediately.`
    : `[NetPulse OK] Router "${routerName}" (${ipAddress}) is back ONLINE. Recovered at ${timestamp}.`;
}

async function sendSlackRouterAlert(
  webhook: string,
  message: string,
  routerName: string,
  state: "online" | "offline",
): Promise<void> {
  try {
    const response = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message }),
    });

    if (!response.ok) {
      logger.warn(
        { routerName, state, status: response.status },
        "Router alert Slack webhook failed",
      );
      return;
    }

    logger.info({ routerName, state }, "Router alert Slack webhook sent");
  } catch (err) {
    logger.warn({ err, routerName, state }, "Router alert Slack webhook failed");
  }
}

export async function sendRouterAlert(
  routerName: string,
  ipAddress:  string,
  state:      "online" | "offline",
  settings:   Record<string, string>,
): Promise<void> {
  const phone = settings.alertPhone?.trim();
  const webhook = settings.alertSlackWebhook?.trim();
  const email = settings.alertEmail?.trim();
  const message = buildRouterAlertMessage(routerName, ipAddress, state, settings.timezone ?? "");
  const subject = state === "offline"
    ? `Router offline: ${routerName}`
    : `Router recovered: ${routerName}`;

  const deliveries: Promise<void>[] = [];

  // Preserve existing SMS behavior: only use the SMS channel when both its
  // destination and provider are configured.
  if (phone && settings.smsProvider) {
    deliveries.push((async () => {
      const result = await sendSms(settings, phone, message);

      try {
        await logSms({
          customerId: null,
          phone,
          message,
          triggerType: state === "offline" ? "router_down" : "router_up",
          status: result.success ? "sent" : "failed",
          error: result.success ? null : result.message,
        });
      } catch (err) {
        logger.warn({ err, routerName, state }, "Router alert SMS log failed");
      }

      logger.info({ routerName, state, phone, success: result.success }, "Router alert SMS sent");
    })());
  }

  if (webhook) {
    deliveries.push(sendSlackRouterAlert(webhook, message, routerName, state));
  }

  if (email) {
    deliveries.push((async () => {
      const result = await sendRouterAlertEmail({
        to: email,
        subject,
        text: message,
        settings,
      });
      const logMethod = result.success ? logger.info.bind(logger) : logger.warn.bind(logger);
      logMethod({ routerName, state, success: result.success }, "Router alert email sent");
    })());
  }

  await Promise.all(deliveries);
}

// ── Seed in-memory state from DB ──────────────────────────────────────────────

async function seedFromDb(routers: Array<{ id: number; name: string; managementHost: string | null; monitorState: string | null }>): Promise<void> {
  for (const r of routers) {
    if (stateMap.has(r.id)) continue; // already seeded (e.g. mid-run re-call)
    const saved = r.monitorState as RouterState | null;
    stateMap.set(r.id, {
      confirmed:    saved ?? "unknown",
      pending:      null,
      pendingCount: 0,
      name:         r.name,
      ipAddress:    r.managementHost ?? "VPN pending",
    });
  }
}

// ── Poll loop ──────────────────────────────────────────────────────────────────

async function pollRouters(): Promise<void> {
  const settings = await getSettings();
  const hasSmsAlert = Boolean(settings.smsProvider && settings.alertPhone?.trim());
  const hasSlackAlert = Boolean(settings.alertSlackWebhook?.trim());
  const hasEmailAlert = Boolean(settings.alertEmail?.trim());
  if (!hasSmsAlert && !hasSlackAlert && !hasEmailAlert) {
    logger.info("Router monitor: skipping poll — no alert destination configured");
    return;
  }

  const routers = await db
    .select({
      id:           routersTable.id,
      name:         routersTable.name,
      ipAddress:    routersTable.ipAddress,
      vpnIp:        routersTable.vpnIp,
      vpnConnected: routersTable.vpnConnected,
      apiSsl:       routersTable.apiSsl,
      username:     routersTable.username,
      password:     routersTable.password,
      enabled:      routersTable.enabled,
      routerType:   routersTable.routerType,
      monitorState: routersTable.monitorState,
    })
    .from(routersTable);

  // On first poll, seed confirmed states from DB so restarts don't reset history
  const routersWithTargets = routers.map(r => ({ ...r, managementHost: getRouterManagementHost(r) }));
  if (!seeded) {
    await seedFromDb(routersWithTargets);
    seeded = true;
  }

  await Promise.all(routersWithTargets.map(async r => {
    if (!r.enabled || r.routerType !== "routeros") return;

    const reachable = r.managementHost
      ? await isReachable({ ...r, ipAddress: r.managementHost })
      : false;
    const newState: RouterState = reachable ? "online" : "offline";

    const existing = stateMap.get(r.id) ?? {
      confirmed:    "unknown" as RouterState,
      pending:      null,
      pendingCount: 0,
      name:         r.name,
        ipAddress:    r.managementHost ?? "VPN pending",
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
        await sendRouterAlert(r.name, r.managementHost ?? "VPN pending", newState, settings);
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
