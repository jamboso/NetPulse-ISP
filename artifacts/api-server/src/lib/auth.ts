import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db, usersTable, sessionsTable, accountsTable, verificationsTable } from "@workspace/db";
import nodemailer from "nodemailer";
import { syncStaffUserRadius } from "./radiusSync";
import { logger } from "./logger";
import { impersonatePlugin } from "./impersonatePlugin";
import { getSettings } from "./sms.js";
import {
  findPasswordLockoutUser,
  getPasswordLockoutMaxAttempts,
  isInvalidPasswordError,
  isInvalidSignInError,
  isPasswordLocked,
  isSuccessfulPasswordResponse,
  recordFailedPasswordAttempt,
  resetPasswordLockout,
  TOO_MANY_PASSWORD_ATTEMPTS_MESSAGE,
} from "./passwordChangeLockout";

type AuthSession = { user: { id: string } };
let getSessionForPasswordChange: ((headers: Headers) => Promise<AuthSession | null>) | undefined;

function tooManyPasswordAttemptsResponse() {
  return {
    response: Response.json(
      {
        code: "TOO_MANY_PASSWORD_ATTEMPTS",
        message: TOO_MANY_PASSWORD_ATTEMPTS_MESSAGE,
      },
      { status: 429 },
    ),
  };
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
      const s = await getSettings();
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
      role:      { type: "string",  defaultValue: "admin",  required: false },
      active:    { type: "boolean", defaultValue: true,     required: false },
      phone:     { type: "string",  required: false },
      companyId: { type: "number",  required: false },
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
  plugins: [impersonatePlugin()],
  hooks: {
    // Enforce the durable account lock before Better Auth verifies a password,
    // whether it is a regular sign-in or a self-service password change.
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/sign-in/email") {
        const email = (ctx.body as { email?: string } | undefined)?.email;
        if (!email) return;
        const user = await findPasswordLockoutUser(email);
        if (user && await isPasswordLocked(user.id)) {
          throw APIError.fromStatus("TOO_MANY_REQUESTS", {
            message: TOO_MANY_PASSWORD_ATTEMPTS_MESSAGE,
          });
        }
        return;
      }

      if (ctx.path !== "/change-password") return;

      const session = await getSessionForPasswordChange?.(ctx.headers ?? new Headers());
      if (session && await isPasswordLocked(session.user.id)) {
        throw APIError.fromStatus("TOO_MANY_REQUESTS", {
          message: TOO_MANY_PASSWORD_ATTEMPTS_MESSAGE,
        });
      }
    }),
    // Mirror plaintext staff/admin passwords into FreeRADIUS's radcheck table
    // whenever they pass through the app, so RouterOS RADIUS admin-login
    // (Winbox/SSH/web/API — see routes/radius.ts) works with the same
    // credentials. better-auth only hashes irreversibly, so this is the only
    // point where the plaintext is available; existing accounts that never
    // sign up/change password again must use the self-service sync endpoint
    // (POST /api/radius/staff-login/sync) instead.
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/sign-in/email") {
        const email = (ctx.body as { email?: string } | undefined)?.email;
        if (!email) return undefined;
        const user = await findPasswordLockoutUser(email);
        if (!user) return undefined;

        if (isInvalidSignInError(ctx.context.returned)) {
          const attempts = await recordFailedPasswordAttempt(
            user.id,
            getPasswordLockoutMaxAttempts(),
          );
          return attempts !== null && attempts >= getPasswordLockoutMaxAttempts()
            ? tooManyPasswordAttemptsResponse()
            : undefined;
        }

        if (isSuccessfulPasswordResponse(ctx.context.returned)) {
          await resetPasswordLockout(user.id);
        }
        return undefined;
      }

      if (ctx.path !== "/change-password") {
        try {
          if (ctx.path === "/sign-up/email") {
            const email = (ctx.body as { email?: string } | undefined)?.email;
            const password = (ctx.body as { password?: string } | undefined)?.password;
            if (email && password) await syncStaffUserRadius(email, password);
          }
        } catch (err) {
          logger.error({ err, path: ctx.path }, "auth hook: failed to sync staff RADIUS login");
        }
        return undefined;
      }

      const session = ctx.context.session;
      const userId = session?.user.id;
      if (!userId || !session) return undefined;

      if (isInvalidPasswordError(ctx.context.returned)) {
        const attempts = await recordFailedPasswordAttempt(
          userId,
          getPasswordLockoutMaxAttempts(),
        );
        if (attempts !== null && attempts >= getPasswordLockoutMaxAttempts()) {
          // Better Auth retains the endpoint's original 400 status when an
          // after hook replaces an APIError. Return a concrete Response so
          // the threshold attempt itself is an HTTP 429 as well.
          return tooManyPasswordAttemptsResponse();
        }
        return undefined;
      }

      // Only a completed password change clears the counter and updates the
      // router's credential. Failed requests must never update either.
      if (!isSuccessfulPasswordResponse(ctx.context.returned)) return undefined;

      await resetPasswordLockout(userId);
      try {
        const email = session.user.email;
        const newPassword = (ctx.body as { newPassword?: string } | undefined)?.newPassword;
        if (email && newPassword) await syncStaffUserRadius(email, newPassword);
      } catch (err) {
        logger.error({ err, path: ctx.path }, "auth hook: failed to sync staff RADIUS login");
      }
      return undefined;
    }),
  },
});

getSessionForPasswordChange = async (headers) =>
  (await auth.api.getSession({ headers })) as AuthSession | null;

export type Session = typeof auth.$Infer.Session;
export type User    = typeof auth.$Infer.Session.user;
