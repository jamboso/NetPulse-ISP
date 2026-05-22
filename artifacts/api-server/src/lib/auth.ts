import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db, usersTable, sessionsTable, accountsTable, verificationsTable, settingsTable } from "@workspace/db";
import nodemailer from "nodemailer";

async function loadSmtpSettings(): Promise<Record<string, string>> {
  const rows = await db.select().from(settingsTable);
  const result: Record<string, string> = {};
  for (const row of rows) result[row.key] = row.value ?? "";
  return result;
}

export const auth = betterAuth({
  baseURL: process.env["BETTER_AUTH_URL"] ?? "http://localhost:5000",
  basePath: "/api/auth",
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user:         usersTable,
      session:      sessionsTable,
      account:      accountsTable,
      verification: verificationsTable,
    },
  }),
  emailAndPassword: {
    enabled: true,
    async sendResetPassword({ user, url }) {
      const s = await loadSmtpSettings();
      if (!s["smtpHost"] || !s["smtpUser"] || !s["smtpPass"]) return;
      const companyName = s["companyName"] ?? "NetPulse ISP";
      const transporter = nodemailer.createTransport({
        host: s["smtpHost"],
        port: Number(s["smtpPort"] ?? 587),
        secure: Number(s["smtpPort"] ?? 587) === 465,
        auth: { user: s["smtpUser"], pass: s["smtpPass"] },
      });
      await transporter.sendMail({
        from: s["smtpFrom"] ?? s["smtpUser"],
        to: user.email,
        subject: `${companyName} — Reset your password`,
        text: `Hi ${user.name ?? user.email},\n\nClick the link below to reset your password. This link expires in 1 hour.\n\n${url}\n\nIf you did not request this, please ignore this email.`,
        html: `<div style="font-family:sans-serif;max-width:480px">
          <h2 style="color:#1e40af">${companyName}</h2>
          <p>Hi ${user.name ?? user.email},</p>
          <p>Click the button below to reset your password. This link expires in <strong>1 hour</strong>.</p>
          <p style="margin:24px 0">
            <a href="${url}" style="background:#2563eb;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:600;display:inline-block">
              Reset Password
            </a>
          </p>
          <p style="color:#6b7280;font-size:13px">If you did not request a password reset, you can safely ignore this email.</p>
        </div>`,
      });
    },
  },
  user: {
    additionalFields: {
      role:   { type: "string",  defaultValue: "admin",  required: false },
      active: { type: "boolean", defaultValue: true,     required: false },
    },
  },
  session: {
    expiresIn:  60 * 60 * 24 * 30,
    updateAge:  60 * 60 * 24,
    cookieCache: {
      enabled: true,
      maxAge:  5 * 60,
    },
  },
  // Trust any origin — the app runs behind nginx/Replit proxy where the TLS
  // boundary is already enforced.  better-auth's origin check is redundant
  // here and causes false 403s on proxied/deployed domains.
  // "https://*" uses better-auth's built-in wildcard matching (matchesOriginPattern)
  // to accept any HTTPS origin; localhost variants cover local dev.
  trustedOrigins: ["https://*", "http://localhost:3000", "http://localhost:5000", "http://localhost:8080"],
  advanced: {
    // Disable the CSRF origin check entirely — sessions are proven by the
    // HTTP-only cookie; origin checking adds no security behind a proxy and
    // breaks every environment where the domain isn't known at build time.
    disableCSRFCheck: true,
  },
});

export type Session = typeof auth.$Infer.Session;
export type User    = typeof auth.$Infer.Session.user;
