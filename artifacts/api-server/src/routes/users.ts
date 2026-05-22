import { Router } from "express";
import { db, usersTable, sessionsTable } from "@workspace/db";
import { eq, ilike, or, max } from "drizzle-orm";
import { z } from "zod/v4";
import { requireRole } from "../middlewares/requireRole";
import { validateBody } from "../middlewares/validateBody";
import { auth } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import { getSettings, sendSms, normalisePhone } from "../lib/sms.js";
import nodemailer from "nodemailer";

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

  // ── Send welcome notification ──────────────────────────────────────────────
  const roleLabels: Record<string, string> = {
    admin: "Admin (full access)",
    billing: "Billing (invoices/payments)",
    support: "Support (customers/tickets)",
    technician: "Technician (network/equipment)",
  };
  const welcomeMsg = `Welcome to NetPulse ISP!\nYour staff account has been created.\nEmail: ${email}\nPassword: ${password}\nRole: ${roleLabels[role] ?? role}\nPlease log in and change your password.`;

  if (notifyMethod === "sms" || notifyMethod === "both") {
    const phone = notifyPhone?.trim();
    if (phone) {
      try {
        const s = await getSettings();
        const result = await sendSms(s, normalisePhone(phone), welcomeMsg);
        if (!result.success) req.log.warn({ phone }, `Staff invite SMS failed: ${result.message}`);
        else req.log.info({ phone }, "Staff invite SMS sent");
      } catch (err) {
        req.log.error({ err }, "Staff invite SMS error");
      }
    }
  }

  if (notifyMethod === "email" || notifyMethod === "both") {
    try {
      const s = await getSettings();
      if (s["smtpHost"] && s["smtpUser"] && s["smtpPass"]) {
        const transporter = nodemailer.createTransport({
          host: s["smtpHost"],
          port: Number(s["smtpPort"] ?? 587),
          secure: Number(s["smtpPort"] ?? 587) === 465,
          auth: { user: s["smtpUser"], pass: s["smtpPass"] },
        });
        const companyName = s["companyName"] ?? "NetPulse ISP";
        await transporter.sendMail({
          from: s["smtpFrom"] ?? s["smtpUser"],
          to: email,
          subject: `Welcome to ${companyName} — Your Staff Account`,
          text: welcomeMsg,
          html: `<div style="font-family:sans-serif;max-width:480px">
            <h2 style="color:#1e40af">Welcome to ${companyName}!</h2>
            <p>Your staff account has been created. Here are your login details:</p>
            <table style="border-collapse:collapse;width:100%">
              <tr><td style="padding:6px 0;color:#6b7280">Email</td><td style="padding:6px 0;font-weight:600">${email}</td></tr>
              <tr><td style="padding:6px 0;color:#6b7280">Password</td><td style="padding:6px 0;font-family:monospace;background:#f1f5f9;padding:4px 8px;border-radius:4px">${password}</td></tr>
              <tr><td style="padding:6px 0;color:#6b7280">Role</td><td style="padding:6px 0;font-weight:600">${roleLabels[role] ?? role}</td></tr>
            </table>
            <p style="color:#dc2626;margin-top:16px">Please log in and change your password immediately.</p>
          </div>`,
        });
        req.log.info({ email }, "Staff invite email sent");
      } else {
        req.log.warn("Staff invite email skipped — SMTP not configured in settings");
      }
    } catch (err) {
      req.log.error({ err }, "Staff invite email error");
    }
  }

  res.status(201).json(updated);
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
