import { Router } from "express";
import { db } from "@workspace/db";
import { settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireRole } from "../middlewares/requireRole";
import { sendTestEmail } from "../lib/mailer";

const router = Router();

const SETTINGS_KEYS = [
  "companyName", "companyAddress", "companyPhone", "companyEmail",
  "timezone", "currency", "invoicePrefix", "invoiceDueDays",
  "lateFeePercent", "autoSuspendDays", "gracePeriodDays",
  "defaultRouterType", "ntpServer", "radiusServer", "radiusSecret",
  // SMS gateway
  "smsProvider", "smsApiKey", "smsApiSecret", "smsSenderId",
  "smsUsername", "smsEnvironment", "smsPartnerId", "smsClientId",
  "smsNotifyInvoice", "smsNotifyPayment", "smsNotifyExpiry",
  "smsNotifyTicket", "smsNotifyWelcome", "smsExpiryNotifyDays",
  // Telegram
  "telegramBotToken", "telegramChatId",
  // SMTP
  "smtpHost", "smtpPort", "smtpUser", "smtpPass", "smtpFrom",
  // M-Pesa
  "mpesaConsumerKey", "mpesaConsumerSecret", "mpesaShortcode",
  "mpesaPasskey", "mpesaEnv", "mpesaCallbackUrl",
  // M-Pesa payment details (shown in SMS)
  "mpesaPaybillNumber",
  "mpesaAllowedIps",
  // Alert recipients
  "alertPhone",
  "alertSlackWebhook",
  "alertEmail",
  // Role-based nav permissions (stored as JSON)
  "rolePermissions",
  // Audit log retention
  "auditLogRetentionDays",
] as const;

type SettingsKey = (typeof SETTINGS_KEYS)[number];

async function loadSettings(): Promise<Record<string, string | null>> {
  const rows = await db.select().from(settingsTable);
  const result: Record<string, string | null> = {};
  for (const key of SETTINGS_KEYS) {
    result[key] = null;
  }
  for (const row of rows) {
    result[row.key] = row.value ?? null;
  }
  return result;
}

router.post("/settings/test-email", requireRole("admin"), async (req, res) => {
  const toEmail = req.user!.email ?? "";
  const toName  = req.user!.name ?? "Admin";

  if (!toEmail) {
    res.status(400).json({ success: false, message: "No email address on your account" });
    return;
  }

  const result = await sendTestEmail(toEmail, toName);
  res.status(result.success ? 200 : 502).json(result);
});

router.get("/settings", requireRole("admin"), async (_req, res) => {
  const settings = await loadSettings();
  res.json(settings);
});

router.patch("/settings", requireRole("admin"), async (req, res) => {
  const body = req.body as Partial<Record<SettingsKey, string>>;

  for (const [key, value] of Object.entries(body)) {
    if (!SETTINGS_KEYS.includes(key as SettingsKey)) continue;
    const existing = await db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.key, key));
    if (existing.length > 0) {
      await db
        .update(settingsTable)
        .set({ value: value ?? null, updatedAt: new Date() })
        .where(eq(settingsTable.key, key));
    } else {
      await db.insert(settingsTable).values({ key, value: value ?? null });
    }
  }

  const updated = await loadSettings();
  res.json(updated);
});

export default router;
