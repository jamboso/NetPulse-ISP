import { Router } from "express";
import { db } from "@workspace/db";
import { settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

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

router.get("/settings", async (_req, res) => {
  const settings = await loadSettings();
  res.json(settings);
});

router.patch("/settings", async (req, res) => {
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
