import { Router } from "express";
import { db } from "@workspace/db";
import { settingsTable } from "@workspace/db";

const router = Router();

async function getSettings(): Promise<Record<string, string>> {
  const rows = await db.select().from(settingsTable);
  const out: Record<string, string> = {};
  for (const row of rows) out[row.key] = row.value ?? "";
  return out;
}

function normalisePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("254")) return digits;
  if (digits.length === 10 && digits.startsWith("0")) return "254" + digits.slice(1);
  if (digits.length === 9) return "254" + digits;
  return digits;
}

async function sendViaCurl(
  method: "GET" | "POST",
  url: string,
  body: Record<string, unknown> | null,
  headers: Record<string, string>,
  jsonBody = false
): Promise<{ ok: boolean; status: number; text: string }> {
  const fetchHeaders: Record<string, string> = headers;
  const init: RequestInit = {
    method,
    headers: fetchHeaders,
  };
  if (method === "POST" && body) {
    if (jsonBody) {
      init.body = JSON.stringify(body);
    } else {
      init.body = new URLSearchParams(body as Record<string, string>).toString();
    }
  }
  const res = await fetch(url, init);
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

async function sendSms(
  s: Record<string, string>,
  to: string,
  message: string
): Promise<{ success: boolean; message: string; raw?: string }> {
  const provider = s.smsProvider || "";
  const phone    = normalisePhone(to);
  const sender   = s.smsSenderId || "NetPulse";

  try {
    if (provider === "africas_talking") {
      const baseUrl = s.smsEnvironment === "production"
        ? "https://api.africastalking.com"
        : "https://api.sandbox.africastalking.com";
      const res = await sendViaCurl(
        "POST",
        `${baseUrl}/version1/messaging`,
        { username: s.smsUsername || "sandbox", to: `+${phone}`, message, from: s.smsUsername === "sandbox" ? undefined : sender },
        { apiKey: s.smsApiKey, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }
      );
      const data = JSON.parse(res.text);
      const code = data?.SMSMessageData?.Recipients?.[0]?.statusCode;
      if ([100, 101, 102].includes(Number(code))) {
        return { success: true, message: data.SMSMessageData.Message, raw: res.text };
      }
      return { success: false, message: data?.SMSMessageData?.Message ?? "AT error", raw: res.text };
    }

    if (provider === "movesms") {
      const res = await sendViaCurl(
        "POST",
        "https://api.movesms.co.ke/v1/sms/sendsms",
        { apikey: s.smsApiKey, partnerID: s.smsPartnerId, message, shortcode: sender, mobile: phone },
        { "Content-Type": "application/x-www-form-urlencoded" }
      );
      const data = JSON.parse(res.text);
      const first = data?.responses?.[0] ?? data;
      const code = Number(first["respose-code"] ?? first["response-code"] ?? 0);
      return code === 200
        ? { success: true, message: `MoveSMS: ${first["response-description"] ?? "OK"}`, raw: res.text }
        : { success: false, message: `MoveSMS error (${code}): ${first["response-description"] ?? ""}`, raw: res.text };
    }

    if (provider === "zettatel") {
      const res = await sendViaCurl(
        "POST",
        "https://portal.zettatel.com/SMSApi/send",
        { userid: s.smsUsername, password: s.smsApiKey, mobile: phone, msg: message, sid: sender, type: "0", output: "json" },
        { "Content-Type": "application/x-www-form-urlencoded" }
      );
      const data = JSON.parse(res.text);
      return (data?.status?.toLowerCase() === "success" || data?.status === "1")
        ? { success: true, message: `Zettatel: OK (ID: ${data?.id ?? "n/a"})`, raw: res.text }
        : { success: false, message: `Zettatel: ${data?.message ?? "error"}`, raw: res.text };
    }

    if (provider === "celcom_africa") {
      const res = await sendViaCurl(
        "POST",
        "https://sms.celcomafrica.com/api/services/sendsms/",
        { apikey: s.smsApiKey, partnerID: s.smsPartnerId, message, shortcode: sender, mobile: phone },
        { "Content-Type": "application/x-www-form-urlencoded" }
      );
      const data = JSON.parse(res.text);
      const first = data?.responses?.[0] ?? data;
      const code = Number(first["respose-code"] ?? first["response-code"] ?? 0);
      return code === 200
        ? { success: true, message: `Celcom: ${first["response-description"] ?? "OK"}`, raw: res.text }
        : { success: false, message: `Celcom error: ${first["response-description"] ?? ""}`, raw: res.text };
    }

    if (provider === "hostpinnacle") {
      const res = await sendViaCurl(
        "POST",
        "https://sms.hostpinnacle.co.ke/v3/sms/alphanumeric",
        { partnerID: s.smsPartnerId, apikey: s.smsApiKey, pass_type: "plain", clientsmsid: Date.now().toString(), mobile: phone, message, shortcode: sender },
        { "Content-Type": "application/json", hpApiKey: s.smsApiKey },
        true
      );
      const data = JSON.parse(res.text);
      const first = data?.responses?.[0] ?? data;
      const code = Number(first["respose-code"] ?? first["response-code"] ?? 0);
      return code === 200
        ? { success: true, message: `HostPinnacle: OK`, raw: res.text }
        : { success: false, message: `HostPinnacle error: ${first["response-description"] ?? ""}`, raw: res.text };
    }

    if (provider === "mobilesasa") {
      const res = await sendViaCurl(
        "POST",
        "https://api.mobilesasa.com/v1/send/message",
        { senderID: sender, message, phone },
        { Authorization: `Bearer ${s.smsApiKey}`, "Content-Type": "application/json", Accept: "application/json" },
        true
      );
      const data = JSON.parse(res.text);
      return (data?.success === true || data?.status === 1)
        ? { success: true, message: `MobileSasa: ${data?.message ?? "OK"}`, raw: res.text }
        : { success: false, message: `MobileSasa: ${data?.message ?? "error"}`, raw: res.text };
    }

    if (provider === "onfonmedia") {
      const res = await sendViaCurl(
        "POST",
        "https://api.onfonmedia.co.ke/v1/sms/SendBulkSMS",
        { SenderId: sender, MessageParameters: [{ Number: phone, Text: message }], ApiKey: s.smsApiKey, ClientId: s.smsClientId },
        { AccessKey: s.smsApiKey, "Content-Type": "application/json", Accept: "application/json" },
        true
      );
      const data = JSON.parse(res.text);
      return Number(data?.ErrorCode) === 0
        ? { success: true, message: `OnfonMedia: ${data?.ErrorDescription ?? "OK"}`, raw: res.text }
        : { success: false, message: `OnfonMedia: ${data?.ErrorDescription ?? "error"}`, raw: res.text };
    }

    if (provider === "beem_africa") {
      const creds = Buffer.from(`${s.smsApiKey}:${s.smsApiSecret}`).toString("base64");
      const res = await sendViaCurl(
        "POST",
        "https://apisms.beem.africa/v1/send",
        { source_addr: s.smsApiSecret || sender, schedule_time: "", encoding: 0, message, recipients: [{ recipient_id: 1, dest_addr: phone }] },
        { Authorization: `Basic ${creds}`, "Content-Type": "application/json" },
        true
      );
      const data = JSON.parse(res.text);
      return (data?.successful === true || data?.code === 100)
        ? { success: true, message: `Beem: OK (${data?.request_id ?? "n/a"})`, raw: res.text }
        : { success: false, message: `Beem: ${data?.message ?? "error"}`, raw: res.text };
    }

    if (provider === "advanta_africa") {
      const res = await sendViaCurl(
        "POST",
        "https://quicksms.advantasms.com/api/services/sendsms/",
        { apikey: s.smsApiKey, partnerID: s.smsPartnerId, message, shortcode: sender, mobile: phone },
        { "Content-Type": "application/x-www-form-urlencoded" }
      );
      const data = JSON.parse(res.text);
      const first = data?.responses?.[0] ?? data;
      const code = Number(first["respose-code"] ?? first["response-code"] ?? 0);
      return code === 200
        ? { success: true, message: `Advanta: ${first["response-description"] ?? "OK"}`, raw: res.text }
        : { success: false, message: `Advanta error: ${first["response-description"] ?? ""}`, raw: res.text };
    }

    return { success: false, message: `Unknown provider: "${provider}". Select one from SMS settings.` };

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: `SMS send error: ${msg}` };
  }
}

// POST /api/sms/test  { to, message? }
router.post("/sms/test", async (req, res) => {
  const { to, message } = req.body as { to?: string; message?: string };
  if (!to) {
    res.status(400).json({ success: false, message: "Phone number is required." });
    return;
  }
  const s = await getSettings();
  if (!s.smsProvider) {
    res.status(400).json({ success: false, message: "No SMS provider configured. Go to Settings → SMS." });
    return;
  }
  const result = await sendSms(
    s,
    to,
    message ?? "Test message from NetPulse ISP Manager. Your SMS gateway is working!"
  );
  res.status(result.success ? 200 : 502).json(result);
});

export default router;
