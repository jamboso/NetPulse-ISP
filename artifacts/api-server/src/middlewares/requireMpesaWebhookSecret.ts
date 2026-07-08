import type { Request, Response, NextFunction } from "express";
import { getSettings } from "../lib/sms.js";

/**
 * Express middleware that validates an M-Pesa webhook shared secret.
 *
 * The expected secret is resolved in priority order:
 *   1. DB settings table (`mpesaWebhookSecret` key) — editable via the Settings page
 *   2. `MPESA_WEBHOOK_SECRET` environment variable — legacy / fallback
 *
 * When neither source supplies a value the check is skipped entirely, so
 * existing deployments that rely solely on IP allowlisting keep working
 * without any configuration change.
 *
 * When a value is present, every inbound M-Pesa callback must include the
 * header `X-Mpesa-Webhook-Secret` whose value matches exactly.  Requests
 * that are missing the header or supply the wrong value are rejected with 403.
 *
 * This provides defence-in-depth alongside `requireSafaricomIp`: operators
 * in sandbox environments (where Safaricom uses unpredictable IPs) can set
 * `MPESA_ALLOWED_IPS=*` and rely on this secret instead.
 */
export async function requireMpesaWebhookSecret(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  let expected: string | undefined;

  try {
    const s = await getSettings();
    expected = s["mpesaWebhookSecret"] || process.env["MPESA_WEBHOOK_SECRET"];
  } catch {
    expected = process.env["MPESA_WEBHOOK_SECRET"];
  }

  if (!expected) {
    next();
    return;
  }

  const provided = req.headers["x-mpesa-webhook-secret"];

  if (!provided || provided !== expected) {
    req.log.warn(
      { hasHeader: !!provided },
      "M-Pesa callback rejected: invalid or missing webhook secret"
    );
    res.status(403).json({ error: "Forbidden: invalid webhook secret" });
    return;
  }

  next();
}
