import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { db, companiesTable, companyRenewalsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { validateBody } from "../middlewares/validateBody";
import { requireSafaricomIp } from "../middlewares/requireSafaricomIp.js";
import { requireMpesaWebhookSecret } from "../middlewares/requireMpesaWebhookSecret.js";

// ── Company subscription billing ────────────────────────────────────────────
// Lets a company's own staff (any authenticated company user — not the
// platform owner, who has no companyId to bill) pay for their subscription
// renewal via M-Pesa STK Push or Stripe Checkout. A confirmed payment
// extends companies.accessUntil by the purchased number of months.
//
// mpesaBillingRouter is mounted under the protected (authenticated) chain.
// mpesaBillingCallbackRouter is mounted alongside the public M-Pesa callback
// router (Safaricom calls it directly, no session).
export const billingRouter = Router();
export const billingPublicRouter = Router();

const MONTHLY_PRICE_KES = Number(process.env["COMPANY_SUBSCRIPTION_PRICE_KES"] ?? 3000);

function extendAccess(current: { accessUntil: Date | null }, months: number): Date {
  const base = current.accessUntil && current.accessUntil.getTime() > Date.now() ? current.accessUntil : new Date();
  const extended = new Date(base);
  extended.setMonth(extended.getMonth() + months);
  return extended;
}

async function applyRenewal(renewalId: number): Promise<void> {
  const [renewal] = await db.select().from(companyRenewalsTable).where(eq(companyRenewalsTable.id, renewalId));
  if (!renewal || renewal.status === "completed") return;

  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, renewal.companyId));
  if (!company) return;

  const accessUntil = extendAccess(company, renewal.months);

  await db.update(companiesTable)
    .set({ accessUntil, accessStatus: "active", updatedAt: new Date() })
    .where(eq(companiesTable.id, company.id));

  await db.update(companyRenewalsTable)
    .set({ status: "completed", completedAt: new Date() })
    .where(eq(companyRenewalsTable.id, renewal.id));
}

const renewLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => (req.user as { id: string } | undefined)?.id ?? req.ip ?? "unknown",
  standardHeaders: "draft-8",
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
});

const renewSchema = z.object({
  phone: z.string().min(9),
  months: z.number().int().positive().max(24).optional().default(1),
});

/*
 * POST /api/billing/mpesa/renew
 * Initiates an STK Push for the caller's own company subscription renewal.
 * Requires an authenticated company user (companyId must be set — the
 * platform owner is not billed and cannot call this).
 */
billingRouter.post("/billing/mpesa/renew", renewLimiter, validateBody(renewSchema), async (req, res) => {
  const companyId = req.companyId;
  if (companyId == null) {
    res.status(400).json({ error: "Only company accounts can pay for a subscription renewal" });
    return;
  }

  const { phone, months } = req.body as z.infer<typeof renewSchema>;
  const amount = MONTHLY_PRICE_KES * months;

  const consumerKey = process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
  const shortcode = process.env.MPESA_SHORTCODE;
  const passkey = process.env.MPESA_PASSKEY;
  const callbackUrl = process.env.MPESA_BILLING_CALLBACK_URL ?? process.env.MPESA_CALLBACK_URL;
  const environment = process.env.MPESA_ENV ?? "sandbox";

  if (!consumerKey || !consumerSecret || !shortcode || !passkey || !callbackUrl) {
    res.status(503).json({ error: "M-Pesa is not configured on this server" });
    return;
  }

  const baseUrl = environment === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke";

  try {
    const tokenRes = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64")}` },
    });
    if (!tokenRes.ok) throw new Error("Failed to get M-Pesa access token");
    const { access_token } = (await tokenRes.json()) as { access_token: string };

    const timestamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
    const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");
    const sanitizedPhone = phone.replace(/^0/, "254").replace(/^\+/, "");

    const stkRes = await fetch(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
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
        AccountReference: `COMPANY-${companyId}`,
        TransactionDesc: "NetPulse subscription renewal",
      }),
    });

    const stkData = (await stkRes.json()) as Record<string, unknown>;
    if (!stkRes.ok || stkData["ResponseCode"] !== "0") {
      req.log.warn({ stkData }, "Company renewal STK Push failed");
      res.status(502).json({ error: "STK Push request failed", detail: stkData });
      return;
    }

    const checkoutRequestId = String(stkData["CheckoutRequestID"]);
    await db.insert(companyRenewalsTable).values({
      companyId,
      provider: "mpesa",
      externalRef: checkoutRequestId,
      months,
      amount: String(amount),
      status: "pending",
    });

    res.json({ success: true, checkoutRequestId, message: "STK Push sent — await the M-Pesa prompt on your phone" });
  } catch (err) {
    req.log.error({ err }, "Company renewal STK Push error");
    res.status(500).json({ error: "Failed to initiate M-Pesa payment" });
  }
});

/*
 * POST /api/billing/mpesa/callback
 * Dedicated Safaricom callback for company subscription renewals (separate
 * from the customer-invoice callback in routes/mpesa.ts so the two payment
 * flows never share matching logic). Looks the payment up by
 * CheckoutRequestID against company_renewals — never by phone — so it can
 * never be mis-attributed to another tenant.
 */
billingPublicRouter.post("/billing/mpesa/callback", requireSafaricomIp, requireMpesaWebhookSecret, async (req, res) => {
  const body = req.body as {
    Body?: { stkCallback?: { ResultCode: number; CheckoutRequestID: string } };
  };
  const cb = body?.Body?.stkCallback;
  if (!cb || cb.ResultCode !== 0) {
    res.json({ ResultCode: 0, ResultDesc: "Accepted" });
    return;
  }

  try {
    const [renewal] = await db.select().from(companyRenewalsTable).where(eq(companyRenewalsTable.externalRef, cb.CheckoutRequestID));
    if (renewal) {
      await applyRenewal(renewal.id);
      req.log.info({ companyId: renewal.companyId, months: renewal.months }, "Company subscription renewed via M-Pesa");
    }
  } catch (err) {
    req.log.error({ err }, "Failed to apply company renewal from M-Pesa callback");
  }

  res.json({ ResultCode: 0, ResultDesc: "Accepted" });
});

/*
 * POST /api/billing/stripe/checkout
 * Creates a Stripe Checkout session for the caller's company subscription
 * renewal. Requires STRIPE_SECRET_KEY to be configured.
 */
billingRouter.post("/billing/stripe/checkout", validateBody(renewSchema.pick({ months: true }).partial()), async (req, res) => {
  const companyId = req.companyId;
  if (companyId == null) {
    res.status(400).json({ error: "Only company accounts can pay for a subscription renewal" });
    return;
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    res.status(503).json({ error: "Card payments are not configured on this server" });
    return;
  }

  const months = (req.body as { months?: number }).months ?? 1;
  const amount = MONTHLY_PRICE_KES * months;
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
  if (!domain) {
    res.status(500).json({ error: "Server is missing REPLIT_DOMAINS to build a return URL" });
    return;
  }

  try {
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeSecretKey);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "kes",
            unit_amount: Math.round(amount * 100),
            product_data: { name: `NetPulse subscription renewal (${months} month${months > 1 ? "s" : ""})` },
          },
          quantity: 1,
        },
      ],
      metadata: { companyId: String(companyId), months: String(months) },
      success_url: `https://${domain}/?billing=success`,
      cancel_url: `https://${domain}/?billing=cancelled`,
    });

    await db.insert(companyRenewalsTable).values({
      companyId,
      provider: "stripe",
      externalRef: session.id,
      months,
      amount: String(amount),
      status: "pending",
    });

    res.json({ url: session.url });
  } catch (err) {
    req.log.error({ err }, "Failed to create Stripe checkout session");
    res.status(500).json({ error: "Failed to start card payment" });
  }
});

/*
 * Stripe webhook handler. Mounted directly (not via billingPublicRouter) at
 * POST /api/billing/stripe/webhook in app.ts, using express.raw() BEFORE
 * express.json() so the signature can be verified against the raw body.
 */
export async function stripeWebhookHandler(req: Request, res: Response): Promise<void> {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripeSecretKey || !webhookSecret) {
    res.status(503).json({ error: "Card payments are not configured on this server" });
    return;
  }

  const signature = req.headers["stripe-signature"];
  if (!signature || typeof signature !== "string") {
    res.status(400).json({ error: "Missing stripe-signature header" });
    return;
  }

  try {
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeSecretKey);
    const event = stripe.webhooks.constructEvent(req.body as Buffer, signature, webhookSecret);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as { id: string };
      const [renewal] = await db.select().from(companyRenewalsTable).where(eq(companyRenewalsTable.externalRef, session.id));
      if (renewal) {
        await applyRenewal(renewal.id);
        req.log.info({ companyId: renewal.companyId, months: renewal.months }, "Company subscription renewed via Stripe");
      }
    }

    res.json({ received: true });
  } catch (err) {
    req.log.error({ err }, "Stripe webhook verification/processing failed");
    res.status(400).json({ error: "Webhook error" });
  }
}
