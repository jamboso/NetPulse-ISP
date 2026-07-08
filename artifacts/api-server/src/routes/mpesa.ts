import { Router } from "express";
import rateLimit from "express-rate-limit";
import { db } from "@workspace/db";
import { paymentsTable, invoicesTable, customersTable, hotspotVouchersTable, hotspotPackagesTable, routersTable } from "@workspace/db";
import { eq, ilike } from "drizzle-orm";
import { getSettings } from "../lib/sms.js";
import { requireSafaricomIp } from "../middlewares/requireSafaricomIp.js";
import { requireMpesaWebhookSecret } from "../middlewares/requireMpesaWebhookSecret.js";

// ── Public router ─────────────────────────────────────────────────────────────
// These endpoints are called directly by Safaricom and must remain unauthenticated.
// IMPORTANT: do NOT use router.use() middleware here. This router is mounted
// without a path prefix, so any router.use() would run on *every* request in
// the app, not just M-Pesa callbacks. Apply requireSafaricomIp and
// requireMpesaWebhookSecret directly to each route handler instead.
export const mpesaPublicRouter = Router();

// ── Protected router ──────────────────────────────────────────────────────────
// These endpoints are called by staff and require a valid session.
export const mpesaProtectedRouter = Router();

// ── STK Push rate limiter ─────────────────────────────────────────────────────
// Caps each authenticated user to 10 STK Push requests per minute to prevent
// Daraja API quota exhaustion and accidental phone-prompt flooding.
const stkPushLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => (req.user as { id: string } | undefined)?.id ?? req.ip ?? "unknown",
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many STK Push requests. Please wait a moment before trying again." },
  skipFailedRequests: false,
  // The IP fallback is only reached for unauthenticated requests, which are
  // blocked upstream by requireAuth before this limiter runs. The IPv6
  // normalisation warning is a false positive here.
  validate: { keyGeneratorIpFallback: false },
});

// ── Register-URLs rate limiter ────────────────────────────────────────────────
// This is a rare one-time config action; 5 requests/minute is generous.
const registerUrlsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator: (req) => (req.user as { id: string } | undefined)?.id ?? req.ip ?? "unknown",
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many register-URLs requests. Please wait a moment before trying again." },
  skipFailedRequests: false,
  validate: { keyGeneratorIpFallback: false },
});

// ── Transactions rate limiter ─────────────────────────────────────────────────
// Polling-style read; 30 requests/minute per user is enough for normal use.
const transactionsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => (req.user as { id: string } | undefined)?.id ?? req.ip ?? "unknown",
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many transaction requests. Please wait a moment before trying again." },
  skipFailedRequests: false,
  validate: { keyGeneratorIpFallback: false },
});

/*
 * POST /api/mpesa/stk-push
 * Initiates a Safaricom Daraja STK Push (Lipa Na M-Pesa Online).
 * Body: { phone, amount, invoiceId, accountRef, description }
 * Requires auth — staff only.
 * Rate-limited: 10 requests / minute per authenticated user.
 */
mpesaProtectedRouter.post("/mpesa/stk-push", stkPushLimiter, async (req, res) => {
  const { phone, amount, invoiceId, accountRef, description } = req.body as {
    phone?: string;
    amount?: number;
    invoiceId?: number;
    accountRef?: string;
    description?: string;
  };

  if (!phone || !amount) {
    res.status(400).json({ error: "phone and amount are required" });
    return;
  }

  const consumerKey = process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
  const shortcode = process.env.MPESA_SHORTCODE;
  const passkey = process.env.MPESA_PASSKEY;
  const callbackUrl = process.env.MPESA_CALLBACK_URL;
  const environment = process.env.MPESA_ENV ?? "sandbox";

  if (!consumerKey || !consumerSecret || !shortcode || !passkey || !callbackUrl) {
    res.status(503).json({ error: "M-Pesa is not configured on this server" });
    return;
  }

  const baseUrl =
    environment === "production"
      ? "https://api.safaricom.co.ke"
      : "https://sandbox.safaricom.co.ke";

  try {
    const tokenRes = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64")}`,
      },
    });
    if (!tokenRes.ok) throw new Error("Failed to get M-Pesa access token");
    const { access_token } = (await tokenRes.json()) as { access_token: string };

    const timestamp = new Date()
      .toISOString()
      .replace(/[^0-9]/g, "")
      .slice(0, 14);
    const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");
    const sanitizedPhone = phone.replace(/^0/, "254").replace(/^\+/, "");

    const stkRes = await fetch(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: Math.ceil(amount),
        PartyA: sanitizedPhone,
        PartyB: shortcode,
        PhoneNumber: sanitizedPhone,
        CallBackURL: callbackUrl,
        AccountReference: accountRef ?? `INV-${invoiceId ?? "0"}`,
        TransactionDesc: description ?? "NetPulse ISP Payment",
      }),
    });

    const stkData = (await stkRes.json()) as Record<string, unknown>;

    if (!stkRes.ok || stkData["ResponseCode"] !== "0") {
      req.log.warn({ stkData }, "STK Push failed");
      res.status(502).json({ error: "STK Push request failed", detail: stkData });
      return;
    }

    res.json({
      success: true,
      checkoutRequestId: stkData["CheckoutRequestID"],
      merchantRequestId: stkData["MerchantRequestID"],
      message: "STK Push sent — await the M-Pesa prompt on your phone",
    });
  } catch (err) {
    req.log.error({ err }, "STK Push error");
    res.status(500).json({ error: "Failed to initiate M-Pesa payment" });
  }
});

/*
 * POST /api/mpesa/register-urls
 * Registers C2B confirmation and validation URLs with Safaricom Daraja.
 * Reads credentials from DB settings (saved via Settings page).
 * Body: { confirmationUrl, validationUrl, responseType? }
 * Requires auth — admin only.
 * Rate-limited: 5 requests / minute per authenticated user.
 */
mpesaProtectedRouter.post("/mpesa/register-urls", registerUrlsLimiter, async (req, res) => {
  const { confirmationUrl, validationUrl, responseType = "Completed" } = req.body as {
    confirmationUrl?: string;
    validationUrl?: string;
    responseType?: "Completed" | "Cancelled";
  };

  if (!confirmationUrl || !validationUrl) {
    res.status(400).json({ error: "confirmationUrl and validationUrl are required" });
    return;
  }

  const s = await getSettings();
  const consumerKey = s["mpesaConsumerKey"] || process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = s["mpesaConsumerSecret"] || process.env.MPESA_CONSUMER_SECRET;
  const shortcode = s["mpesaShortcode"] || process.env.MPESA_SHORTCODE;
  const environment = s["mpesaEnv"] || process.env.MPESA_ENV || "sandbox";

  if (!consumerKey || !consumerSecret || !shortcode) {
    res.status(503).json({ error: "M-Pesa credentials are not configured. Save your settings first." });
    return;
  }

  const baseUrl = environment === "live"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";

  try {
    const tokenRes = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64")}`,
      },
    });
    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      req.log.warn({ status: tokenRes.status, body }, "M-Pesa OAuth failed");
      res.status(502).json({ error: "Failed to get M-Pesa access token. Check your Consumer Key and Secret." });
      return;
    }
    const { access_token } = (await tokenRes.json()) as { access_token: string };

    const registerRes = await fetch(`${baseUrl}/mpesa/c2b/v1/registerurl`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ShortCode: shortcode,
        ResponseType: responseType,
        ConfirmationURL: confirmationUrl,
        ValidationURL: validationUrl,
      }),
    });

    const registerData = (await registerRes.json()) as Record<string, unknown>;

    if (!registerRes.ok) {
      req.log.warn({ registerData }, "M-Pesa RegisterURL failed");
      res.status(502).json({ error: "Safaricom rejected the registration", detail: registerData });
      return;
    }

    req.log.info({ shortcode, confirmationUrl, validationUrl }, "M-Pesa URLs registered");
    res.json({ success: true, detail: registerData });
  } catch (err) {
    req.log.error({ err }, "M-Pesa register-urls error");
    res.status(500).json({ error: "Failed to register URLs with Safaricom" });
  }
});

/*
 * GET /api/mpesa/status
 * Returns M-Pesa configuration status (no secrets exposed).
 * Requires auth — staff only.
 */
mpesaProtectedRouter.get("/mpesa/status", async (req, res) => {
  try {
    const s = await getSettings();
    const consumerKey = s["mpesaConsumerKey"] || process.env.MPESA_CONSUMER_KEY;
    const consumerSecret = s["mpesaConsumerSecret"] || process.env.MPESA_CONSUMER_SECRET;
    const shortcode = s["mpesaShortcode"] || process.env.MPESA_SHORTCODE;
    const passkey = s["mpesaPasskey"] || process.env.MPESA_PASSKEY;
    const callbackUrl = s["mpesaCallbackUrl"] || process.env.MPESA_CALLBACK_URL;
    const environment = s["mpesaEnv"] || process.env.MPESA_ENV || "sandbox";
    const webhookSecret = s["mpesaWebhookSecret"] || process.env.MPESA_WEBHOOK_SECRET;

    res.json({
      configured: !!(consumerKey && consumerSecret && shortcode && passkey && callbackUrl),
      environment,
      shortcode: shortcode ?? null,
      webhookSecretConfigured: !!webhookSecret,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to read M-Pesa status");
    res.json({
      configured: !!(
        process.env.MPESA_CONSUMER_KEY &&
        process.env.MPESA_CONSUMER_SECRET &&
        process.env.MPESA_SHORTCODE &&
        process.env.MPESA_PASSKEY &&
        process.env.MPESA_CALLBACK_URL
      ),
      environment: process.env.MPESA_ENV ?? "sandbox",
      shortcode: process.env.MPESA_SHORTCODE ?? null,
      webhookSecretConfigured: !!process.env.MPESA_WEBHOOK_SECRET,
    });
  }
});

/*
 * POST /api/mpesa/callback
 * Receives Safaricom STK Push result callback.
 * Public — Safaricom calls this directly, no session available.
 */
mpesaPublicRouter.post("/mpesa/callback", requireSafaricomIp, requireMpesaWebhookSecret, async (req, res) => {
  const body = req.body as {
    Body?: {
      stkCallback?: {
        ResultCode: number;
        ResultDesc: string;
        MerchantRequestID: string;
        CheckoutRequestID: string;
        CallbackMetadata?: {
          Item: Array<{ Name: string; Value?: string | number }>;
        };
      };
    };
  };

  const cb = body?.Body?.stkCallback;
  if (!cb) {
    res.json({ ResultCode: 0, ResultDesc: "Accepted" });
    return;
  }

  if (cb.ResultCode !== 0) {
    req.log.warn({ cb }, "M-Pesa STK callback: payment failed or cancelled");
    res.json({ ResultCode: 0, ResultDesc: "Accepted" });
    return;
  }

  const meta = cb.CallbackMetadata?.Item ?? [];
  const get = (name: string) => meta.find((i) => i.Name === name)?.Value;

  const mpesaRef = String(get("MpesaReceiptNumber") ?? "");
  const amount = Number(get("Amount") ?? 0);
  const phone = String(get("PhoneNumber") ?? "");

  if (!mpesaRef) {
    res.json({ ResultCode: 0, ResultDesc: "Accepted" });
    return;
  }

  try {
    // ── Check if this is a hotspot voucher payment ─────────────────────────
    const [pendingVoucher] = await db
      .select()
      .from(hotspotVouchersTable)
      .where(eq(hotspotVouchersTable.checkoutRequestId, cb.CheckoutRequestID))
      .limit(1);

    if (pendingVoucher) {
      // Provision hotspot access
      const [pkg] = pendingVoucher.packageId
        ? await db.select().from(hotspotPackagesTable).where(eq(hotspotPackagesTable.id, pendingVoucher.packageId))
        : [null];
      const [r] = await db.select().from(routersTable).where(eq(routersTable.id, pendingVoucher.routerId));

      const expiresAt = new Date(Date.now() + ((pkg?.durationMinutes ?? 60) * 60 * 1000));
      const profileName = pkg ? `hs-${
        (pkg.downloadSpeedKbps ?? 0) >= 10240 ? "10mbps" :
        (pkg.downloadSpeedKbps ?? 0) >= 5120 ? "5mbps" :
        (pkg.downloadSpeedKbps ?? 0) >= 2048 ? "2mbps" : "1mbps"
      }` : "hs-1mbps";

      // Create hotspot user on RouterOS
      if (r) {
        try {
          const scheme = r.apiSsl ? "https" : "http";
          const creds = Buffer.from(`${r.username}:${r.password}`).toString("base64");
          const timeLimitSeconds = (pkg?.durationMinutes ?? 60) * 60;

          // Create hotspot user (MAC-based auto-login if MAC known)
          await fetch(`${scheme}://${r.ipAddress}/rest/ip/hotspot/user`, {
            method: "PUT",
            headers: {
              Authorization: `Basic ${creds}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              name: pendingVoucher.username,
              password: pendingVoucher.password,
              profile: profileName,
              "limit-uptime": `${timeLimitSeconds}s`,
              ...(pkg?.dataLimitMb ? { "limit-bytes-total": String(pkg.dataLimitMb * 1024 * 1024) } : {}),
              ...(pendingVoucher.macAddress ? { "mac-address": pendingVoucher.macAddress } : {}),
              comment: `Voucher #${pendingVoucher.id} | Phone: ${pendingVoucher.phone} | Ref: ${mpesaRef}`,
            }),
          });
          req.log.info({ voucherId: pendingVoucher.id, routerId: r.id }, "Hotspot user created on RouterOS");
        } catch (e) {
          req.log.error({ e }, "Failed to create RouterOS hotspot user");
        }
      }

      // Update voucher status
      await db.update(hotspotVouchersTable).set({
        status: "active",
        mpesaRef,
        amountPaid: String(amount),
        activatedAt: new Date(),
        expiresAt,
      }).where(eq(hotspotVouchersTable.id, pendingVoucher.id));

      req.log.info({ mpesaRef, voucherId: pendingVoucher.id }, "Hotspot voucher activated");
      res.json({ ResultCode: 0, ResultDesc: "Accepted" });
      return;
    }

    // ── Standard ISP subscriber payment ───────────────────────────────────
    const [customer] = await db
      .select()
      .from(customersTable)
      .where(ilike(customersTable.phone, `%${phone.slice(-9)}`))
      .limit(1);

    const [payment] = await db
      .insert(paymentsTable)
      .values({
        customerId: customer?.id ?? null,
        invoiceId: null,
        amount: String(amount),
        method: "mpesa",
        status: "completed",
        reference: mpesaRef,
        notes: `M-Pesa callback. Phone: ${phone}`,
      })
      .returning();

    if (customer?.id) {
      const [pendingInvoice] = await db
        .select()
        .from(invoicesTable)
        .where(eq(invoicesTable.customerId, customer.id))
        .limit(1);

      if (pendingInvoice) {
        await db
          .update(paymentsTable)
          .set({ invoiceId: pendingInvoice.id })
          .where(eq(paymentsTable.id, payment!.id));
        await db
          .update(invoicesTable)
          .set({ status: "paid", paidAt: new Date().toISOString() })
          .where(eq(invoicesTable.id, pendingInvoice.id));
      }
    }

    req.log.info({ mpesaRef, amount, phone }, "M-Pesa payment recorded");
  } catch (err) {
    req.log.error({ err }, "Failed to record M-Pesa payment");
  }

  res.json({ ResultCode: 0, ResultDesc: "Accepted" });
});

/*
 * POST /api/mpesa/c2b/validation
 * C2B validation URL — Safaricom calls this to validate before processing.
 * Public — Safaricom calls this directly.
 */
mpesaPublicRouter.post("/mpesa/c2b/validation", requireSafaricomIp, requireMpesaWebhookSecret, (_req, res) => {
  res.json({ ResultCode: "0", ResultDesc: "Accepted" });
});

/*
 * POST /api/mpesa/c2b/confirmation
 * C2B confirmation URL — Safaricom confirms a successful payment.
 * Public — Safaricom calls this directly.
 */
mpesaPublicRouter.post("/mpesa/c2b/confirmation", requireSafaricomIp, requireMpesaWebhookSecret, async (req, res) => {
  const body = req.body as {
    TransID?: string;
    TransAmount?: string;
    MSISDN?: string;
    BillRefNumber?: string;
    FirstName?: string;
  };

  const mpesaRef = body.TransID ?? "";
  const amount = Number(body.TransAmount ?? 0);
  const phone = body.MSISDN ?? "";
  const billRef = body.BillRefNumber ?? "";

  try {
    const [customer] = await db
      .select()
      .from(customersTable)
      .where(ilike(customersTable.phone, `%${phone.slice(-9)}`))
      .limit(1);

    await db.insert(paymentsTable).values({
      customerId: customer?.id ?? null,
      invoiceId: null,
      amount: String(amount),
      method: "mpesa",
      status: "completed",
      reference: mpesaRef,
      notes: `C2B payment. Phone: ${phone}, BillRef: ${billRef}`,
    });

    req.log.info({ mpesaRef, amount, phone, billRef }, "M-Pesa C2B payment recorded");
  } catch (err) {
    req.log.error({ err }, "Failed to record M-Pesa C2B payment");
  }

  res.json({ ResultCode: "0", ResultDesc: "Accepted" });
});

/*
 * GET /api/mpesa/transactions
 * Returns all M-Pesa payments ordered newest-first, with customer name joins.
 * Requires auth — staff only.
 * Rate-limited: 30 requests / minute per authenticated user.
 */
mpesaProtectedRouter.get("/mpesa/transactions", transactionsLimiter, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query["limit"] ?? 200), 500);
    const rows = await db
      .select({
        id: paymentsTable.id,
        amount: paymentsTable.amount,
        status: paymentsTable.status,
        reference: paymentsTable.reference,
        notes: paymentsTable.notes,
        createdAt: paymentsTable.createdAt,
        invoiceId: paymentsTable.invoiceId,
        customerId: paymentsTable.customerId,
        customerName: customersTable.name,
        customerPhone: customersTable.phone,
      })
      .from(paymentsTable)
      .leftJoin(customersTable, eq(paymentsTable.customerId, customersTable.id))
      .where(eq(paymentsTable.method, "mpesa"))
      .orderBy(paymentsTable.createdAt)
      .limit(limit);

    // Return newest first
    res.json({ data: rows.reverse(), total: rows.length });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M-Pesa transactions");
    res.status(500).json({ error: "Failed to fetch transactions" });
  }
});
