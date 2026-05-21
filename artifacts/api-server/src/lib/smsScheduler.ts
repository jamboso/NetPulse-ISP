/**
 * SMS Reminder Scheduler — runs once daily.
 *
 * For each active template with triggerType "reminder_N" (N = 0..6),
 * it finds all active subscriptions whose endDate is exactly N days away,
 * renders the message, sends it, and logs it — deduplicating so the same
 * subscription never gets the same reminder twice per cycle.
 */

import { db } from "@workspace/db";
import {
  subscriptionsTable, customersTable, plansTable,
  smsTemplatesTable, smsLogsTable,
} from "@workspace/db";
import { eq, and, gte, lte, isNotNull } from "drizzle-orm";
import { getSettings, sendSms, renderTemplate, logSms } from "./sms";
import { logger } from "./logger";

const SCHEDULE_INTERVAL_MS = 60 * 60 * 1000; // check hourly, but only send once per day per trigger

// Track which date we last sent for each trigger to avoid re-firing within the same day
const lastRunDate: Record<string, string> = {};

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function alreadySent(subscriptionId: number, triggerType: string): Promise<boolean> {
  // Check if we sent this reminder for this subscription today
  const dayStart = new Date(todayStr() + "T00:00:00.000Z");
  const dayEnd   = new Date(todayStr() + "T23:59:59.999Z");

  const existing = await db
    .select({ id: smsLogsTable.id })
    .from(smsLogsTable)
    .where(and(
      eq(smsLogsTable.subscriptionId, subscriptionId),
      eq(smsLogsTable.triggerType, triggerType),
      gte(smsLogsTable.createdAt, dayStart),
      lte(smsLogsTable.createdAt, dayEnd),
    ))
    .limit(1);

  return existing.length > 0;
}

async function runReminders(): Promise<void> {
  const today = todayStr();

  // Load all active reminder templates
  const templates = await db
    .select()
    .from(smsTemplatesTable)
    .where(and(
      eq(smsTemplatesTable.isActive, true),
    ));

  const reminderTemplates = templates.filter(t => t.triggerType.startsWith("reminder_"));
  if (reminderTemplates.length === 0) return;

  const settings = await getSettings();
  if (!settings.smsProvider) {
    logger.warn("SMS scheduler: no provider configured, skipping");
    return;
  }

  const paybill = settings.mpesaPaybillNumber || settings.mpesaShortcode || settings.mpesaBusinessShortCode || "";

  for (const template of reminderTemplates) {
    // Guard: only fire once per day per trigger type
    if (lastRunDate[template.triggerType] === today) continue;

    const daysMatch = template.triggerType.match(/reminder_(\d+)/);
    if (!daysMatch) continue;
    const daysLeft = parseInt(daysMatch[1]!);

    // Find the target expiry date: today + daysLeft
    const targetDate = addDays(today, daysLeft);

    // Find active subscriptions expiring on that date that have a phone number
    const rows = await db
      .select({
        sub:      subscriptionsTable,
        customer: customersTable,
        plan:     plansTable,
      })
      .from(subscriptionsTable)
      .innerJoin(customersTable, eq(subscriptionsTable.customerId, customersTable.id))
      .innerJoin(plansTable,     eq(subscriptionsTable.planId,     plansTable.id))
      .where(and(
        eq(subscriptionsTable.status, "active"),
        eq(subscriptionsTable.endDate, targetDate),
        isNotNull(customersTable.phone),
      ));

    if (rows.length === 0) continue;

    logger.info({ trigger: template.triggerType, daysLeft, targetDate, count: rows.length },
      "SMS scheduler: sending reminders");

    let sent = 0, skipped = 0, failed = 0;

    for (const { sub, customer, plan } of rows) {
      // Deduplication: skip if already sent today
      if (await alreadySent(sub.id, template.triggerType)) { skipped++; continue; }

      const expiryDate = new Date(targetDate).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" });
      const message = renderTemplate(template.message, {
        name:       customer.name,
        username:   sub.pppoeUsername ?? "",
        account:    sub.pppoeUsername ?? "",
        plan:       plan.name,
        amount:     Number(plan.price).toLocaleString("en-KE"),
        paybill,
        daysLeft,
        expiryDate,
        phone:      customer.phone,
      });

      const result = await sendSms(settings, customer.phone, message);

      await logSms({
        customerId:     customer.id,
        subscriptionId: sub.id,
        phone:          customer.phone,
        message,
        templateId:     template.id,
        triggerType:    template.triggerType,
        status:         result.success ? "sent" : "failed",
        error:          result.success ? null : result.message,
      });

      if (result.success) sent++;
      else failed++;
    }

    logger.info({ trigger: template.triggerType, sent, skipped, failed }, "SMS scheduler: done");
    lastRunDate[template.triggerType] = today;
  }
}

export function startSmsScheduler(): void {
  // Run immediately on startup
  runReminders().catch(err => logger.warn({ err }, "SMS scheduler: initial run failed"));

  // Then every hour
  setInterval(() => {
    runReminders().catch(err => logger.warn({ err }, "SMS scheduler: run failed"));
  }, SCHEDULE_INTERVAL_MS);

  logger.info({ intervalMs: SCHEDULE_INTERVAL_MS }, "SMS scheduler started");
}
