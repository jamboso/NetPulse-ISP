import { Router } from "express";
import { db } from "@workspace/db";
import { paymentsTable, invoicesTable, customersTable } from "@workspace/db";
import { eq, ilike } from "drizzle-orm";

const router = Router();

/*
 * POST /api/mpesa/stk-push
 * Initiates a Safaricom Daraja STK Push (Lipa Na M-Pesa Online).
 * Body: { phone, amount, invoiceId, accountRef, description }
 */
router.post("/mpesa/stk-push", async (req, res) => {
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
 * POST /api/mpesa/callback
 * Receives Safaricom STK Push result callback.
 * This endpoint must be publicly reachable (no auth guard).
 */
router.post("/mpesa/callback", async (req, res) => {
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
 */
router.post("/mpesa/c2b/validation", (_req, res) => {
  res.json({ ResultCode: "0", ResultDesc: "Accepted" });
});

/*
 * POST /api/mpesa/c2b/confirmation
 * C2B confirmation URL — Safaricom confirms a successful payment.
 */
router.post("/mpesa/c2b/confirmation", async (req, res) => {
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
 * GET /api/mpesa/status
 * Returns M-Pesa configuration status (no secrets exposed).
 */
router.get("/mpesa/status", (_req, res) => {
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
  });
});

export default router;
