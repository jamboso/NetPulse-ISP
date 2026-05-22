import type { Request, Response, NextFunction } from "express";

/**
 * Express middleware that validates an M-Pesa webhook shared secret.
 *
 * When `MPESA_WEBHOOK_SECRET` is set in the environment, every inbound
 * M-Pesa callback must include the header `X-Mpesa-Webhook-Secret` whose
 * value matches the env var exactly.  Requests that are missing the header
 * or supply the wrong value are rejected with 403.
 *
 * When `MPESA_WEBHOOK_SECRET` is NOT set the check is skipped entirely, so
 * existing deployments that rely solely on IP allowlisting keep working
 * without any configuration change.
 *
 * This provides defence-in-depth alongside `requireSafaricomIp`: operators
 * in sandbox environments (where Safaricom uses unpredictable IPs) can set
 * `MPESA_ALLOWED_IPS=*` and rely on this secret instead.
 */
export function requireMpesaWebhookSecret(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const expected = process.env["MPESA_WEBHOOK_SECRET"];

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
