/**
 * Email sending utility — uses SMTP settings stored in the settings table.
 */

import nodemailer from "nodemailer";
import { getSettings } from "./sms.js";

export interface WelcomeEmailOptions {
  name: string;
  email: string;
  password: string;
  role: string;
  appUrl: string;
  companyName?: string;
}

const ROLE_LABELS: Record<string, string> = {
  admin:      "Admin (full access)",
  billing:    "Billing (invoices/payments)",
  support:    "Support (customers/tickets)",
  technician: "Technician (network/equipment)",
};

/**
 * Sends a welcome email to a newly created staff member.
 * Silently skips (returns false) when SMTP is not configured.
 * Never throws — all errors are caught and returned as { success: false }.
 */
export async function sendStaffWelcomeEmail(
  opts: WelcomeEmailOptions,
): Promise<{ success: boolean; message: string }> {
  try {
    const s = await getSettings();

    if (!s["smtpHost"] || !s["smtpUser"] || !s["smtpPass"]) {
      return { success: false, message: "SMTP not configured — email skipped" };
    }

    const company  = opts.companyName ?? s["companyName"] ?? "NetPulse ISP";
    const roleLabel = ROLE_LABELS[opts.role] ?? opts.role;
    const from     = s["smtpFrom"] ?? s["smtpUser"];
    const port     = Number(s["smtpPort"] ?? 587);

    const transporter = nodemailer.createTransport({
      host:   s["smtpHost"],
      port,
      secure: port === 465,
      auth:   { user: s["smtpUser"], pass: s["smtpPass"] },
    });

    const textBody = [
      `Welcome to ${company}!`,
      "",
      `Hi ${opts.name},`,
      "",
      "Your staff account has been created. Here are your login details:",
      "",
      `  Email:    ${opts.email}`,
      `  Password: ${opts.password}`,
      `  Role:     ${roleLabel}`,
      "",
      `Sign in at: ${opts.appUrl}`,
      "",
      "Please log in and change your password immediately.",
      "",
      `— The ${company} Team`,
    ].join("\n");

    const htmlBody = `
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111827">
  <h2 style="color:#1e40af;margin-bottom:4px">Welcome to ${company}!</h2>
  <p style="color:#6b7280;margin-top:0">Your staff account is ready.</p>

  <p>Hi <strong>${opts.name}</strong>,</p>
  <p>An administrator has created a staff account for you. Use the credentials below to sign in:</p>

  <table style="border-collapse:collapse;width:100%;margin:16px 0">
    <tr>
      <td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;color:#6b7280;width:110px">Email</td>
      <td style="padding:8px 12px;border:1px solid #e2e8f0;font-weight:600">${opts.email}</td>
    </tr>
    <tr>
      <td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;color:#6b7280">Password</td>
      <td style="padding:8px 12px;border:1px solid #e2e8f0;font-family:monospace;background:#f1f5f9;letter-spacing:0.05em">${opts.password}</td>
    </tr>
    <tr>
      <td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;color:#6b7280">Role</td>
      <td style="padding:8px 12px;border:1px solid #e2e8f0">${roleLabel}</td>
    </tr>
  </table>

  <a href="${opts.appUrl}"
     style="display:inline-block;padding:10px 20px;background:#1e40af;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">
    Sign In Now
  </a>

  <p style="color:#dc2626;margin-top:20px;font-size:0.9em">
    ⚠️ Please change your password immediately after signing in.
  </p>

  <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" />
  <p style="font-size:0.8em;color:#9ca3af">— The ${company} Team</p>
</div>`;

    await transporter.sendMail({
      from,
      to:      opts.email,
      subject: `Welcome to ${company} — Your Staff Account`,
      text:    textBody,
      html:    htmlBody,
    });

    return { success: true, message: "Welcome email sent" };
  } catch (err: unknown) {
    return {
      success: false,
      message: `Email error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
