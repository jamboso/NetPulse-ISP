/**
 * Public hotspot portal API — NO AUTH required.
 * Called by the captive portal page to list packages, initiate payment,
 * and check voucher status.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import {
  hotspotPackagesTable, hotspotVouchersTable, routersTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router = Router();

// ── GET /api/hotspot/:routerId/packages ───────────────────────────────────────
router.get("/hotspot/:routerId/packages", async (req, res) => {
  const routerId = parseInt(req.params.routerId!);
  const pkgs = await db
    .select()
    .from(hotspotPackagesTable)
    .where(
      and(
        eq(hotspotPackagesTable.routerId, routerId),
        eq(hotspotPackagesTable.isActive, true)
      )
    )
    .orderBy(hotspotPackagesTable.sortOrder, hotspotPackagesTable.id);
  res.json(pkgs);
});

// ── GET /api/hotspot/:routerId/info ───────────────────────────────────────────
router.get("/hotspot/:routerId/info", async (req, res) => {
  const [r] = await db
    .select({ id: routersTable.id, name: routersTable.name, location: routersTable.location })
    .from(routersTable)
    .where(eq(routersTable.id, parseInt(req.params.routerId!)));
  if (!r) { res.status(404).json({ error: "Not found" }); return; }
  res.json(r);
});

// ── POST /api/hotspot/:routerId/pay ───────────────────────────────────────────
// Body: { packageId, phone, mac?, ip? }
router.post("/hotspot/:routerId/pay", async (req, res) => {
  const routerId = parseInt(req.params.routerId!);
  const { packageId, phone, mac, ip: clientIp } = req.body as {
    packageId: number; phone: string; mac?: string; ip?: string;
  };

  if (!packageId || !phone) {
    res.status(400).json({ error: "packageId and phone required" }); return;
  }

  const [pkg] = await db
    .select()
    .from(hotspotPackagesTable)
    .where(and(eq(hotspotPackagesTable.id, packageId), eq(hotspotPackagesTable.routerId, routerId)));
  if (!pkg) { res.status(404).json({ error: "Package not found" }); return; }

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, routerId));
  if (!r) { res.status(404).json({ error: "Router not found" }); return; }

  // Generate credentials
  const username = `hs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const password = Math.random().toString(36).slice(2, 10);

  // Create pending voucher
  const [voucher] = await db.insert(hotspotVouchersTable).values({
    routerId, packageId,
    username, password,
    phone: phone.replace(/^\+/, ""),
    macAddress: mac ?? null,
    ipAddress: clientIp ?? null,
    status: "pending",
  }).returning();

  // Initiate M-Pesa STK Push
  const consumerKey = process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
  const shortcode = process.env.MPESA_SHORTCODE;
  const passkey = process.env.MPESA_PASSKEY;
  const callbackUrl = process.env.MPESA_HOTSPOT_CALLBACK_URL ?? process.env.MPESA_CALLBACK_URL;
  const environment = process.env.MPESA_ENV ?? "sandbox";

  if (!consumerKey || !consumerSecret || !shortcode || !passkey || !callbackUrl) {
    res.status(503).json({
      error: "M-Pesa not configured",
      voucher: { id: voucher!.id, username, password },
    });
    return;
  }

  const baseUrl = environment === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";

  try {
    const tokenRes = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64")}` },
    });
    if (!tokenRes.ok) throw new Error("Failed to get M-Pesa token");
    const { access_token } = (await tokenRes.json()) as { access_token: string };

    const timestamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
    const pw = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");
    const sanitizedPhone = phone.replace(/^0/, "254").replace(/^\+/, "");

    const stkRes = await fetch(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        BusinessShortCode: shortcode,
        Password: pw,
        Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: Math.ceil(Number(pkg.price)),
        PartyA: sanitizedPhone,
        PartyB: shortcode,
        PhoneNumber: sanitizedPhone,
        CallBackURL: callbackUrl,
        AccountReference: `HS-${voucher!.id}`,
        TransactionDesc: `Hotspot: ${pkg.name} — ${r.name}`,
      }),
    });

    const stkData = (await stkRes.json()) as Record<string, unknown>;

    if (!stkRes.ok || stkData["ResponseCode"] !== "0") {
      await db.update(hotspotVouchersTable)
        .set({ status: "failed" })
        .where(eq(hotspotVouchersTable.id, voucher!.id));
      res.status(502).json({ error: "STK Push failed", detail: stkData });
      return;
    }

    const checkoutRequestId = String(stkData["CheckoutRequestID"] ?? "");
    await db.update(hotspotVouchersTable)
      .set({ checkoutRequestId })
      .where(eq(hotspotVouchersTable.id, voucher!.id));

    res.json({
      success: true,
      voucherId: voucher!.id,
      checkoutRequestId,
      message: "Check your phone for M-Pesa prompt",
      amount: pkg.price,
      currency: pkg.currency,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Payment initiation failed" });
  }
});

// ── GET /api/hotspot/:routerId/voucher/:voucherId ─────────────────────────────
router.get("/hotspot/:routerId/voucher/:voucherId", async (req, res) => {
  const [v] = await db
    .select()
    .from(hotspotVouchersTable)
    .where(
      and(
        eq(hotspotVouchersTable.id, parseInt(req.params.voucherId!)),
        eq(hotspotVouchersTable.routerId, parseInt(req.params.routerId!))
      )
    );
  if (!v) { res.status(404).json({ error: "Voucher not found" }); return; }
  res.json({
    id: v.id,
    status: v.status,
    username: v.status === "active" ? v.username : undefined,
    password: v.status === "active" ? v.password : undefined,
    expiresAt: v.expiresAt,
    activatedAt: v.activatedAt,
  });
});

export default router;
