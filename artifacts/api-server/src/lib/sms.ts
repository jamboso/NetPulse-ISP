/**
 * Shared SMS sending utility — used by both the API routes and the scheduler.
 */

import { db } from "@workspace/db";
import { settingsTable, smsLogsTable } from "@workspace/db";

export async function getSettings(): Promise<Record<string, string>> {
  const rows = await db.select().from(settingsTable);
  const out: Record<string, string> = {};
  for (const row of rows) out[row.key] = row.value ?? "";
  return out;
}

export function normalisePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("254")) return digits;
  if (digits.length === 10 && digits.startsWith("0")) return "254" + digits.slice(1);
  if (digits.length === 9) return "254" + digits;
  return digits;
}

async function postForm(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
  json = false,
): Promise<{ ok: boolean; status: number; text: string }> {
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: json ? JSON.stringify(body) : new URLSearchParams(body as Record<string, string>).toString(),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

export async function sendSms(
  s: Record<string, string>,
  to: string,
  message: string,
): Promise<{ success: boolean; message: string; raw?: string }> {
  const provider = s.smsProvider || "";
  const phone    = normalisePhone(to);
  const sender   = s.smsSenderId || "NetPulse";

  try {
    if (provider === "africas_talking") {
      const base = s.smsEnvironment === "production"
        ? "https://api.africastalking.com"
        : "https://api.sandbox.africastalking.com";
      const r = await postForm(`${base}/version1/messaging`,
        { username: s.smsUsername || "sandbox", to: `+${phone}`, message, ...(s.smsUsername !== "sandbox" && { from: sender }) },
        { apiKey: s.smsApiKey, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" });
      const d = JSON.parse(r.text);
      const code = Number(d?.SMSMessageData?.Recipients?.[0]?.statusCode ?? 0);
      return [100, 101, 102].includes(code)
        ? { success: true,  message: d.SMSMessageData.Message, raw: r.text }
        : { success: false, message: d?.SMSMessageData?.Message ?? "AT error", raw: r.text };
    }
    if (provider === "movesms") {
      const r = await postForm("https://api.movesms.co.ke/v1/sms/sendsms",
        { apikey: s.smsApiKey, partnerID: s.smsPartnerId, message, shortcode: sender, mobile: phone },
        { "Content-Type": "application/x-www-form-urlencoded" });
      const d = JSON.parse(r.text); const f = d?.responses?.[0] ?? d;
      const code = Number(f["respose-code"] ?? f["response-code"] ?? 0);
      return code === 200 ? { success: true, message: `MoveSMS: ${f["response-description"] ?? "OK"}`, raw: r.text }
        : { success: false, message: `MoveSMS error (${code}): ${f["response-description"] ?? ""}`, raw: r.text };
    }
    if (provider === "zettatel") {
      const r = await postForm("https://portal.zettatel.com/SMSApi/send",
        { userid: s.smsUsername, password: s.smsApiKey, mobile: phone, msg: message, sid: sender, type: "0", output: "json" },
        { "Content-Type": "application/x-www-form-urlencoded" });
      const d = JSON.parse(r.text);
      return (d?.status?.toLowerCase() === "success" || d?.status === "1")
        ? { success: true,  message: `Zettatel: OK (${d?.id ?? "n/a"})`, raw: r.text }
        : { success: false, message: `Zettatel: ${d?.message ?? "error"}`, raw: r.text };
    }
    if (provider === "celcom_africa") {
      const r = await postForm("https://sms.celcomafrica.com/api/services/sendsms/",
        { apikey: s.smsApiKey, partnerID: s.smsPartnerId, message, shortcode: sender, mobile: phone },
        { "Content-Type": "application/x-www-form-urlencoded" });
      const d = JSON.parse(r.text); const f = d?.responses?.[0] ?? d;
      const code = Number(f["respose-code"] ?? f["response-code"] ?? 0);
      return code === 200 ? { success: true, message: `Celcom: OK`, raw: r.text }
        : { success: false, message: `Celcom error: ${f["response-description"] ?? ""}`, raw: r.text };
    }
    if (provider === "hostpinnacle") {
      const r = await postForm("https://sms.hostpinnacle.co.ke/v3/sms/alphanumeric",
        { partnerID: s.smsPartnerId, apikey: s.smsApiKey, pass_type: "plain", clientsmsid: Date.now().toString(), mobile: phone, message, shortcode: sender },
        { "Content-Type": "application/json", hpApiKey: s.smsApiKey }, true);
      const d = JSON.parse(r.text); const f = d?.responses?.[0] ?? d;
      return Number(f["respose-code"] ?? f["response-code"] ?? 0) === 200
        ? { success: true, message: "HostPinnacle: OK", raw: r.text }
        : { success: false, message: `HostPinnacle error: ${f["response-description"] ?? ""}`, raw: r.text };
    }
    if (provider === "mobilesasa") {
      const r = await postForm("https://api.mobilesasa.com/v1/send/message",
        { senderID: sender, message, phone },
        { Authorization: `Bearer ${s.smsApiKey}`, "Content-Type": "application/json", Accept: "application/json" }, true);
      const d = JSON.parse(r.text);
      return (d?.success === true || d?.status === 1)
        ? { success: true, message: `MobileSasa: ${d?.message ?? "OK"}`, raw: r.text }
        : { success: false, message: `MobileSasa: ${d?.message ?? "error"}`, raw: r.text };
    }
    if (provider === "onfonmedia") {
      const r = await postForm("https://api.onfonmedia.co.ke/v1/sms/SendBulkSMS",
        { SenderId: sender, MessageParameters: [{ Number: phone, Text: message }], ApiKey: s.smsApiKey, ClientId: s.smsClientId },
        { AccessKey: s.smsApiKey, "Content-Type": "application/json", Accept: "application/json" }, true);
      const d = JSON.parse(r.text);
      return Number(d?.ErrorCode) === 0
        ? { success: true, message: `OnfonMedia: ${d?.ErrorDescription ?? "OK"}`, raw: r.text }
        : { success: false, message: `OnfonMedia: ${d?.ErrorDescription ?? "error"}`, raw: r.text };
    }
    if (provider === "beem_africa") {
      const creds = Buffer.from(`${s.smsApiKey}:${s.smsApiSecret}`).toString("base64");
      const r = await postForm("https://apisms.beem.africa/v1/send",
        { source_addr: s.smsApiSecret || sender, schedule_time: "", encoding: 0, message, recipients: [{ recipient_id: 1, dest_addr: phone }] },
        { Authorization: `Basic ${creds}`, "Content-Type": "application/json" }, true);
      const d = JSON.parse(r.text);
      return (d?.successful === true || d?.code === 100)
        ? { success: true, message: `Beem: OK (${d?.request_id ?? "n/a"})`, raw: r.text }
        : { success: false, message: `Beem: ${d?.message ?? "error"}`, raw: r.text };
    }
    if (provider === "advanta_africa") {
      const r = await postForm("https://quicksms.advantasms.com/api/services/sendsms/",
        { apikey: s.smsApiKey, partnerID: s.smsPartnerId, message, shortcode: sender, mobile: phone },
        { "Content-Type": "application/x-www-form-urlencoded" });
      const d = JSON.parse(r.text); const f = d?.responses?.[0] ?? d;
      const code = Number(f["respose-code"] ?? f["response-code"] ?? 0);
      return code === 200 ? { success: true, message: `Advanta: OK`, raw: r.text }
        : { success: false, message: `Advanta error: ${f["response-description"] ?? ""}`, raw: r.text };
    }
    return { success: false, message: `Unknown provider: "${provider}". Configure SMS settings first.` };
  } catch (err: unknown) {
    return { success: false, message: `SMS error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Replace template variables with real values */
export function renderTemplate(
  template: string,
  vars: {
    name: string;
    username: string;
    plan: string;
    amount: string;
    paybill: string;
    account: string;
    daysLeft: number;
    expiryDate: string;
    phone: string;
  },
): string {
  return template
    .replace(/\{name\}/gi,         vars.name)
    .replace(/\{username\}/gi,     vars.username)
    .replace(/\{account\}/gi,      vars.account)
    .replace(/\{plan\}/gi,         vars.plan)
    .replace(/\{amount\}/gi,       vars.amount)
    .replace(/\{paybill\}/gi,      vars.paybill)
    .replace(/\{days_left\}/gi,    String(vars.daysLeft))
    .replace(/\{expiry_date\}/gi,  vars.expiryDate)
    .replace(/\{phone\}/gi,        vars.phone);
}

/** Log an SMS send attempt to the DB */
export async function logSms(entry: {
  customerId: number | null;
  subscriptionId?: number | null;
  phone: string;
  message: string;
  templateId?: number | null;
  triggerType: string;
  status: "sent" | "failed";
  error?: string | null;
}): Promise<void> {
  await db.insert(smsLogsTable).values({
    customerId:     entry.customerId,
    subscriptionId: entry.subscriptionId ?? null,
    phone:          entry.phone,
    message:        entry.message,
    templateId:     entry.templateId ?? null,
    triggerType:    entry.triggerType,
    status:         entry.status,
    error:          entry.error ?? null,
  });
}
