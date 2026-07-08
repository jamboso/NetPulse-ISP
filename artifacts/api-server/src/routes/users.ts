import { Router } from "express";
import { db, usersTable, sessionsTable } from "@workspace/db";
import { eq, ilike, or, max } from "drizzle-orm";
import { z } from "zod/v4";
import { requireRole } from "../middlewares/requireRole";
import { validateBody } from "../middlewares/validateBody";
import { auth } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import { getSettings, sendSms, normalisePhone } from "../lib/sms.js";
import { sendStaffWelcomeEmail, buildWelcomeEmailHtml, buildWelcomeEmailText, type WelcomeEmailOptions } from "../lib/mailer.js";

const VALID_ROLES = ["admin", "billing", "support", "technician"] as const;

const createUserSchema = z.object({
  name:           z.string().min(1),
  email:          z.string().email(),
  password:       z.string().min(8),
  role:           z.enum(VALID_ROLES),
  notifyMethod:   z.enum(["none", "sms", "email", "both"]).optional().default("none"),
  notifyPhone:    z.string().optional(),
});

const updateUserSchema = z.object({
  role:   z.enum(VALID_ROLES).optional(),
  active: z.boolean().optional(),
});

const router = Router();

router.get("/users", requireRole("admin"), async (req, res) => {
  const { search } = req.query as Record<string, string>;

  const lastActiveSub = db
    .select({
      userId: sessionsTable.userId,
      lastActiveAt: max(sessionsTable.createdAt).as("last_active_at"),
    })
    .from(sessionsTable)
    .groupBy(sessionsTable.userId)
    .as("last_active");

  let query = db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      name: usersTable.name,
      role: usersTable.role,
      active: usersTable.active,
      createdAt: usersTable.createdAt,
      lastActiveAt: lastActiveSub.lastActiveAt,
    })
    .from(usersTable)
    .leftJoin(lastActiveSub, eq(lastActiveSub.userId, usersTable.id))
    .$dynamic();

  if (search) {
    query = query.where(
      or(
        ilike(usersTable.name, `%${search}%`),
        ilike(usersTable.email, `%${search}%`),
      ),
    );
  }

  const data = await query.orderBy(usersTable.createdAt);
  res.json({ data });
});

router.post("/users", requireRole("admin"), validateBody(createUserSchema), async (req, res) => {
  const { name, email, password, role, notifyMethod = "none", notifyPhone } = req.body as z.infer<typeof createUserSchema>;

  const existing = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (existing.length > 0) {
    res.status(400).json({ error: "A user with that email already exists" });
    return;
  }

  const signUpResult = await auth.api.signUpEmail({
    body: { name, email, password },
  });

  if (!signUpResult?.user) {
    res.status(500).json({ error: "Failed to create user" });
    return;
  }

  const [updated] = await db
    .update(usersTable)
    .set({ role, updatedAt: new Date() })
    .where(eq(usersTable.id, signUpResult.user.id))
    .returning({
      id: usersTable.id,
      email: usersTable.email,
      name: usersTable.name,
      role: usersTable.role,
      active: usersTable.active,
      createdAt: usersTable.createdAt,
    });

  void writeAuditLog({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: "create",
    entityType: "user",
    entityId: null,
    diff: { after: { id: updated?.id, email, name, role } },
  });

  // ── Always send a welcome email (skips silently when SMTP is not configured) ─
  const appUrl = process.env["REPLIT_DOMAINS"]
    ? `https://${process.env["REPLIT_DOMAINS"].split(",")[0]}`
    : (process.env["BETTER_AUTH_URL"] ?? "");

  void sendStaffWelcomeEmail({ name, email, password, role, appUrl }).then((result) => {
    if (result.success) req.log.info({ email }, "Staff welcome email sent");
    else req.log.warn({ email }, `Staff welcome email skipped: ${result.message}`);
  });

  // ── Optional SMS / additional notification ────────────────────────────────
  const roleLabels: Record<string, string> = {
    admin:      "Admin (full access)",
    billing:    "Billing (invoices/payments)",
    support:    "Support (customers/tickets)",
    technician: "Technician (network/equipment)",
  };
  const welcomeMsg = `Welcome to NetPulse ISP!\nYour staff account has been created.\nEmail: ${email}\nPassword: ${password}\nRole: ${roleLabels[role] ?? role}\nPlease log in and change your password.`;

  if (notifyMethod === "sms" || notifyMethod === "both") {
    const phone = notifyPhone?.trim();
    if (phone) {
      void (async () => {
        try {
          const s = await getSettings();
          const result = await sendSms(s, normalisePhone(phone), welcomeMsg);
          if (!result.success) req.log.warn({ phone }, `Staff invite SMS failed: ${result.message}`);
          else req.log.info({ phone }, "Staff invite SMS sent");
        } catch (err) {
          req.log.error({ err }, "Staff invite SMS error");
        }
      })();
    }
  }

  res.status(201).json(updated);
});

// ── Welcome email preview & test-send ────────────────────────────────────────

const SAMPLE_PREVIEW: WelcomeEmailOptions = {
  name:     "Jane Doe",
  email:    "jane@example.com",
  password: "Temp@1234",
  role:     "support",
  appUrl:   "",
};

const ROLE_LABELS_LOCAL: Record<string, string> = {
  admin:      "Admin (full access)",
  billing:    "Billing (invoices/payments)",
  support:    "Support (customers/tickets)",
  technician: "Technician (network/equipment)",
};

router.get("/users/welcome-email-preview", requireRole("admin"), async (req, res) => {
  const s = await getSettings();
  const smtpConfigured = !!(s["smtpHost"] && s["smtpUser"] && s["smtpPass"]);
  const company  = s["companyName"] ?? "NetPulse ISP";
  const appUrl   = process.env["REPLIT_DOMAINS"]
    ? `https://${process.env["REPLIT_DOMAINS"].split(",")[0]}`
    : (process.env["BETTER_AUTH_URL"] ?? "https://your-app.example.com");

  const opts = { ...SAMPLE_PREVIEW, appUrl, companyName: company };
  const roleLabel = ROLE_LABELS_LOCAL[opts.role] ?? opts.role;
  const html = buildWelcomeEmailHtml({ ...opts, company, roleLabel });

  res.json({ html, smtpConfigured });
});

router.post("/users/welcome-email-preview/send", requireRole("admin"), async (req, res) => {
  const user = req.user!;
  const s = await getSettings();

  if (!s["smtpHost"] || !s["smtpUser"] || !s["smtpPass"]) {
    res.status(400).json({ error: "SMTP is not configured. Please add SMTP settings in Settings." });
    return;
  }

  const appUrl = process.env["REPLIT_DOMAINS"]
    ? `https://${process.env["REPLIT_DOMAINS"].split(",")[0]}`
    : (process.env["BETTER_AUTH_URL"] ?? "");

  const company   = s["companyName"] ?? "NetPulse ISP";
  const roleLabel = ROLE_LABELS_LOCAL[user.role ?? "admin"] ?? (user.role ?? "admin");
  const from      = s["smtpFrom"] ?? s["smtpUser"];
  const port      = Number(s["smtpPort"] ?? 587);

  const opts: WelcomeEmailOptions = {
    name:        user.name,
    email:       user.email,
    password:    "(your current password)",
    role:        user.role ?? "admin",
    appUrl,
    companyName: company,
  };

  try {
    const { createTransport } = await import("nodemailer");
    const transporter = createTransport({
      host:   s["smtpHost"],
      port,
      secure: port === 465,
      auth:   { user: s["smtpUser"], pass: s["smtpPass"] },
    });

    await transporter.sendMail({
      from,
      to:      user.email,
      subject: `[Test] Welcome to ${company} — Your Staff Account`,
      text:    buildWelcomeEmailText({ ...opts, company, roleLabel }),
      html:    buildWelcomeEmailHtml({ ...opts, company, roleLabel }),
    });

    req.log.info({ email: user.email }, "Test welcome email sent");
    res.json({ success: true, message: `Test email sent to ${user.email}` });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    req.log.warn({ err }, "Test welcome email failed");
    res.status(500).json({ error: `Failed to send test email: ${message}` });
  }
});

router.patch("/users/:id", requireRole("admin"), validateBody(updateUserSchema), async (req, res) => {
  const { id } = req.params as { id: string };
  const { role, active } = req.body as z.infer<typeof updateUserSchema>;

  if (id === req.user!.id) {
    res.status(400).json({ error: "You cannot modify your own account through this endpoint" });
    return;
  }

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const updates: Partial<typeof usersTable.$inferInsert> = { updatedAt: new Date() };
  if (role !== undefined) updates.role = role;
  if (active !== undefined) updates.active = active;

  const [updated] = await db
    .update(usersTable)
    .set(updates)
    .where(eq(usersTable.id, id))
    .returning({
      id: usersTable.id,
      email: usersTable.email,
      name: usersTable.name,
      role: usersTable.role,
      active: usersTable.active,
      createdAt: usersTable.createdAt,
    });

  void writeAuditLog({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: "update",
    entityType: "user",
    entityId: null,
    diff: { before: existing, after: updated },
  });

  res.json(updated);
});

export default router;
