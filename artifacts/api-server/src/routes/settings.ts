import { Router } from "express";
import { db } from "@workspace/db";
import { settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { requireRole } from "../middlewares/requireRole";
import { validateBody } from "../middlewares/validateBody";
import { resolveCompanyScope } from "../middlewares/companyScope";
import { sendTestEmail } from "../lib/mailer";
import { getCompanyMpesaConfigRow, upsertCompanyMpesaConfig } from "../lib/mpesaConfig";

const DEFAULT_SAFARICOM_CIDRS = [
  "196.201.214.0/24",
  "196.201.216.0/24",
  "196.201.213.0/24",
  "196.201.212.0/24",
  "196.201.211.0/24",
  "196.201.210.0/24",
  "196.201.209.0/24",
  "196.201.208.0/24",
];

type AllowlistSource = "db" | "env" | "default";

async function resolveEffectiveAllowlist(): Promise<{ source: AllowlistSource; cidrs: string[] }> {
  try {
    const rows = await db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.key, "mpesaAllowedIps"));
    const dbValue = rows[0]?.value?.trim();
    if (dbValue && dbValue.length > 0) {
      const cidrs = dbValue === "*" ? ["*"] : dbValue.split(",").map((s) => s.trim()).filter(Boolean);
      return { source: "db", cidrs };
    }
  } catch {
    // fall through
  }

  const envValue = process.env["MPESA_ALLOWED_IPS"];
  if (envValue) {
    const cidrs = envValue === "*" ? ["*"] : envValue.split(",").map((s) => s.trim()).filter(Boolean);
    return { source: "env", cidrs };
  }

  return { source: "default", cidrs: DEFAULT_SAFARICOM_CIDRS };
}

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
  "mpesaWebhookSecret",
  // Alert recipients
  "alertPhone",
  "alertSlackWebhook",
  "alertEmail",
  // Role-based nav permissions (stored as JSON)
  "rolePermissions",
  // Audit log retention
  "auditLogRetentionDays",
  // Scheduled CSV export
  "exportScheduleEnabled",
  "exportScheduleFrequency",
  "exportScheduleEmail",
  "exportScheduleLastSentAt",
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

router.get("/settings/mpesa-ip-allowlist", requireRole("owner"), async (_req, res) => {
  const result = await resolveEffectiveAllowlist();
  res.json(result);
});

router.post("/settings/test-email", requireRole("owner"), async (req, res) => {
  const toEmail = req.user!.email ?? "";
  const toName  = req.user!.name ?? "Admin";

  if (!toEmail) {
    res.status(400).json({ success: false, message: "No email address on your account" });
    return;
  }

  const result = await sendTestEmail(toEmail, toName);
  res.status(result.success ? 200 : 502).json(result);
});

router.get("/settings", requireRole("owner"), async (_req, res) => {
  const settings = await loadSettings();
  res.json(settings);
});

router.patch("/settings", requireRole("owner"), async (req, res) => {
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

const companyMpesaSchema = z.object({
  consumerKey: z.string().optional().nullable(),
  consumerSecret: z.string().optional().nullable(),
  shortcode: z.string().optional().nullable(),
  passkey: z.string().optional().nullable(),
  paybillNumber: z.string().optional().nullable(),
  env: z.enum(["sandbox", "production"]).optional(),
  callbackUrl: z.string().optional().nullable(),
  allowedIps: z.string().optional().nullable(),
  webhookSecret: z.string().optional().nullable(),
});

// Company-scoped M-Pesa credentials, for the ISP's own Settings > M-Pesa tab.
// Distinct from the owner-only /companies/:id/mpesa (platform tenant admin).
// The platform owner (companyId 1) keeps using this same endpoint, which
// resolveCompanyScope leaves unscoped (req.companyId === null) for them —
// so we fall back to company 1 explicitly for that case.
router.get(
  "/settings/mpesa",
  requireRole("admin", "owner"),
  resolveCompanyScope,
  async (req, res) => {
    const companyId = req.companyId ?? 1;
    const config = await getCompanyMpesaConfigRow(companyId);
    res.json(config ?? { companyId, env: "sandbox" });
  },
);

router.patch(
  "/settings/mpesa",
  requireRole("admin", "owner"),
  resolveCompanyScope,
  validateBody(companyMpesaSchema),
  async (req, res) => {
    const companyId = req.companyId ?? 1;
    const body = req.body as z.infer<typeof companyMpesaSchema>;
    const updated = await upsertCompanyMpesaConfig(companyId, body);
    res.json(updated);
  },
);

export default router;
