import { Router, type IRouter } from "express";
import { randomBytes } from "crypto";
import { z } from "zod/v4";
import { db, usersTable, accountsTable, verificationsTable } from "@workspace/db";
import { eq, and, gt } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { validateBody } from "../middlewares/validateBody";
import { auth } from "../lib/auth";
import { getSettings, sendSms, normalisePhone } from "../lib/sms.js";
import { syncStaffUserRadius } from "../lib/radiusSync.js";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const OTP_TTL_MS = 10 * 60 * 1000;
const smsIdentifier = (userId: string) => `sms-reset:${userId}`;

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "••••";
  return `••••${digits.slice(-4)}`;
}

function generateOtp(): string {
  // 6-digit numeric code, zero-padded
  const n = randomBytes(4).readUInt32BE(0) % 1_000_000;
  return n.toString().padStart(6, "0");
}

const methodsSchema = z.object({
  email: z.string().email(),
});

router.post("/password-reset/methods", validateBody(methodsSchema), async (req, res) => {
  const { email } = req.body as z.infer<typeof methodsSchema>;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));

  // Never reveal whether the account exists — always return the same shape.
  if (!user) {
    res.json({ hasEmail: true, hasSms: false, maskedPhone: null });
    return;
  }

  const hasSms = !!user.phone;
  res.json({
    hasEmail: true,
    hasSms,
    maskedPhone: hasSms ? maskPhone(user.phone!) : null,
  });
});

const requestSchema = z.object({
  email:  z.string().email(),
  method: z.enum(["email", "sms"]),
});

router.post("/password-reset/request", validateBody(requestSchema), async (req, res) => {
  const { email, method } = req.body as z.infer<typeof requestSchema>;
  const genericMessage = "If an account matching that information exists, a reset code or link has been sent.";

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));

  if (!user) {
    res.json({ success: true, message: genericMessage });
    return;
  }

  if (method === "email") {
    try {
      await auth.api.requestPasswordReset({
        body: { email, redirectTo: "/reset-password" },
      });
    } catch (err) {
      req.log.error({ err, email }, "password-reset: forgetPassword failed");
    }
    res.json({ success: true, message: genericMessage });
    return;
  }

  // method === "sms"
  if (!user.phone) {
    res.json({ success: true, message: genericMessage });
    return;
  }

  try {
    // Clear any prior outstanding codes for this user before issuing a new one.
    await db.delete(verificationsTable).where(eq(verificationsTable.identifier, smsIdentifier(user.id)));

    const code = generateOtp();
    await db.insert(verificationsTable).values({
      id:         randomBytes(16).toString("hex"),
      identifier: smsIdentifier(user.id),
      value:      code,
      expiresAt:  new Date(Date.now() + OTP_TTL_MS),
    });

    const settings = await getSettings();
    const smsResult = await sendSms(
      settings,
      normalisePhone(user.phone),
      `Your NetPulse password reset code is ${code}. It expires in 10 minutes. If you did not request this, ignore this message.`,
    );
    if (!smsResult.success) {
      req.log.warn({ email, message: smsResult.message }, "password-reset: SMS send failed");
    }
  } catch (err) {
    req.log.error({ err, email }, "password-reset: failed to issue SMS code");
  }

  res.json({ success: true, message: genericMessage });
});

const verifySchema = z.object({
  email:       z.string().email(),
  code:        z.string().min(4).max(12),
  newPassword: z.string().min(8),
});

router.post("/password-reset/verify-sms", validateBody(verifySchema), async (req, res) => {
  const { email, code, newPassword } = req.body as z.infer<typeof verifySchema>;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (!user) {
    res.status(400).json({ error: "Invalid or expired code." });
    return;
  }

  const [verification] = await db
    .select()
    .from(verificationsTable)
    .where(and(
      eq(verificationsTable.identifier, smsIdentifier(user.id)),
      eq(verificationsTable.value, code),
      gt(verificationsTable.expiresAt, new Date()),
    ));

  if (!verification) {
    res.status(400).json({ error: "Invalid or expired code." });
    return;
  }

  try {
    const hashedPassword = await hashPassword(newPassword);

    const [account] = await db
      .select()
      .from(accountsTable)
      .where(and(eq(accountsTable.userId, user.id), eq(accountsTable.providerId, "credential")));

    if (!account) {
      res.status(400).json({ error: "This account does not support password login." });
      return;
    }

    await db.update(accountsTable)
      .set({ password: hashedPassword, updatedAt: new Date() })
      .where(eq(accountsTable.id, account.id));

    // Single-use: remove the code once consumed.
    await db.delete(verificationsTable).where(eq(verificationsTable.id, verification.id));

    void syncStaffUserRadius(user.email, newPassword).catch((err) =>
      logger.warn({ err, email: user.email }, "password-reset: failed to sync staff RADIUS login"),
    );

    res.json({ success: true, message: "Password reset successfully. You can now sign in." });
  } catch (err) {
    req.log.error({ err, email }, "password-reset: failed to apply new password");
    res.status(500).json({ error: "Failed to reset password. Please try again." });
  }
});

export default router;
