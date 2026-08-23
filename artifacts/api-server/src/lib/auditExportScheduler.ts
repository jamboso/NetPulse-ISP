/**
 * Audit Log CSV Export Scheduler
 *
 * Reads `exportScheduleEnabled`, `exportScheduleFrequency`, `exportScheduleEmail`,
 * and `exportScheduleLastSentAt` from the settings table.
 *
 * Frequencies:
 *   daily   — send once every 24 hours
 *   weekly  — send once every 7 days
 *   monthly — send once every 30 days
 *
 * Checks every hour whether an export is due. When due:
 *   1. Queries the last 10,000 audit_log rows
 *   2. Generates a CSV string
 *   3. Emails it as an attachment via SMTP
 *   4. Updates `exportScheduleLastSentAt` so the next check knows it ran
 */

import nodemailer from "nodemailer";
import { db, auditLogsTable, settingsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { logger } from "./logger";
import { getSettings } from "./sms.js";

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

const FREQUENCY_HOURS: Record<string, number> = {
  daily:   24,
  weekly:  24 * 7,
  monthly: 24 * 30,
};

function escapeCsv(value: string): string {
  const FORMULA_CHARS = ["=", "+", "-", "@", "\t", "\r"];
  let safe = FORMULA_CHARS.some((c) => value.startsWith(c)) ? `'${value}` : value;
  if (safe.includes('"') || safe.includes(",") || safe.includes("\n")) {
    safe = `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

function flattenDiff(diff: unknown): string {
  if (diff == null) return "";
  if (typeof diff !== "object") return String(diff);
  const d = diff as Record<string, unknown>;
  if ("before" in d || "after" in d) {
    const before = (d.before ?? {}) as Record<string, unknown>;
    const after  = (d.after  ?? {}) as Record<string, unknown>;
    const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
    return keys
      .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
      .map((k) => `${k}: ${JSON.stringify(before[k] ?? null)} → ${JSON.stringify(after[k] ?? null)}`)
      .join("; ");
  }
  return JSON.stringify(diff);
}

async function generateCsv(): Promise<string> {
  const rows = await db
    .select()
    .from(auditLogsTable)
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(10000);

  const header = ["Timestamp", "User Email", "User ID", "Action", "Entity Type", "Entity ID", "Diff Summary"];
  const lines: string[] = [header.map(escapeCsv).join(",")];

  for (const row of rows) {
    const line = [
      row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
      row.userEmail ?? "",
      row.userId,
      row.action,
      row.entityType,
      row.entityId != null ? String(row.entityId) : "",
      flattenDiff(row.diff),
    ].map(escapeCsv).join(",");
    lines.push(line);
  }

  return lines.join("\r\n");
}

async function updateLastSentAt(): Promise<string> {
  const now = new Date().toISOString();
  const existing = await db
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.key, "exportScheduleLastSentAt"))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(settingsTable)
      .set({ value: now, updatedAt: new Date() })
      .where(eq(settingsTable.key, "exportScheduleLastSentAt"));
  } else {
    await db.insert(settingsTable).values({ key: "exportScheduleLastSentAt", value: now });
  }
  return now;
}

export class AuditExportConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditExportConfigurationError";
  }
}

type AuditExportTrigger = "manual" | "scheduled";

export async function sendAuditLogExport(
  trigger: AuditExportTrigger,
): Promise<{ lastSentAt: string }> {
  const s = await getSettings();
  const frequency = (s["exportScheduleFrequency"] ?? "weekly").toLowerCase();
  const email     = s["exportScheduleEmail"] ?? "";

  if (!email) {
    throw new AuditExportConfigurationError("Configure an audit log export destination email before sending.");
  }

  if (!s["smtpHost"] || !s["smtpUser"] || !s["smtpPass"]) {
    throw new AuditExportConfigurationError("Configure SMTP before sending an audit log export.");
  }

  logger.info({ trigger, frequency, email }, "Audit log export: generating CSV export");

  const csv     = await generateCsv();
  const company = s["companyName"] ?? "NetPulse ISP";
  const from    = s["smtpFrom"] ?? s["smtpUser"];
  const port    = Number(s["smtpPort"] ?? 587);
  const dateStr = new Date().toISOString().slice(0, 10);

  const transporter = nodemailer.createTransport({
    host:   s["smtpHost"],
    port,
    secure: port === 465,
    auth:   { user: s["smtpUser"], pass: s["smtpPass"] },
  });

  await transporter.sendMail({
    from,
    to:      email,
    subject: `${company} — Audit Log Export (${dateStr})`,
    text: [
      `Hi,`,
      ``,
      `Please find attached the ${trigger === "manual" ? "one-off" : `scheduled ${frequency}`} audit log export for ${company}.`,
      ``,
      `Generated: ${new Date().toUTCString()}`,
      ``,
      `— ${company}`,
    ].join("\n"),
    html: `
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111827">
  <h2 style="color:#1e40af;margin-bottom:4px">${company} — Audit Log Export</h2>
   <p style="color:#6b7280;margin-top:0">${trigger === "manual" ? "One-off" : `Scheduled ${frequency}`} export attached.</p>
  <p>Please find the attached CSV containing the latest audit log records.</p>
  <table style="border-collapse:collapse;width:100%;margin:16px 0">
    <tr>
      <td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;color:#6b7280;width:110px">Generated</td>
      <td style="padding:8px 12px;border:1px solid #e2e8f0">${new Date().toUTCString()}</td>
    </tr>
        ${trigger === "scheduled" ? `<tr>
      <td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;color:#6b7280">Frequency</td>
      <td style="padding:8px 12px;border:1px solid #e2e8f0;text-transform:capitalize">${frequency}</td>
    </tr>` : ""}
  </table>
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" />
  <p style="font-size:0.8em;color:#9ca3af">— The ${company} Team</p>
</div>`,
    attachments: [
      {
        filename: `audit-log-${dateStr}.csv`,
        content:  csv,
        contentType: "text/csv",
      },
    ],
  });

  const lastSentAt = await updateLastSentAt();

  logger.info({ trigger, email, frequency, lastSentAt }, "Audit log export: CSV export sent successfully");
  return { lastSentAt };
}

async function runExportIfDue(): Promise<void> {
  const s = await getSettings();
  const enabled = s["exportScheduleEnabled"];
  if (enabled !== "1" && enabled !== "true") return;

  const frequency = (s["exportScheduleFrequency"] ?? "weekly").toLowerCase();
  const lastSent = s["exportScheduleLastSentAt"] ?? "";
  const thresholdHours = FREQUENCY_HOURS[frequency] ?? FREQUENCY_HOURS["weekly"]!;

  if (lastSent) {
    const lastDate = new Date(lastSent);
    const hoursSinceLast = (Date.now() - lastDate.getTime()) / (1000 * 60 * 60);
    if (hoursSinceLast < thresholdHours) return;
  }

  await sendAuditLogExport("scheduled");
}

export function startAuditExportScheduler(): void {
  runExportIfDue().catch((err) =>
    logger.warn({ err }, "Audit export scheduler: initial check failed"),
  );

  setInterval(() => {
    runExportIfDue().catch((err) =>
      logger.warn({ err }, "Audit export scheduler: scheduled check failed"),
    );
  }, CHECK_INTERVAL_MS);

  logger.info({ checkIntervalMs: CHECK_INTERVAL_MS }, "Audit export scheduler started");
}
