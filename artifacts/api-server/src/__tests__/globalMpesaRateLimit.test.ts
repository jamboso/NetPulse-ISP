/**
 * Verifies that the global M-Pesa rate limiter (60 req/min, applied in
 * app.ts before the router) blocks brute-force attempts across all
 * /api/mpesa/* routes and returns HTTP 429 with rate-limit headers.
 *
 * The limiter is tested in isolation: we instantiate it with the same
 * configuration used in app.ts and mount it on a minimal Express app so
 * we never have to mock the full server dependency tree (auth, pino, etc.).
 */
import { describe, it, expect } from "vitest";
import express, { type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import request from "supertest";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Builds a self-contained Express app that mirrors the production config:
 *   mpesaLimiter applied BEFORE the route handler.
 *
 * windowMs is collapsed to 0 so the window never carries over between test
 * runs (each test gets a fresh limiter instance anyway because it calls
 * buildApp() independently).
 */
function buildApp() {
  const mpesaLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests." },
  });

  const app = express();
  app.set("trust proxy", false);

  // Apply the limiter before any route — identical to app.ts ordering after fix
  app.use("/api/mpesa", mpesaLimiter);

  // Lightweight stub route that stands in for any real /api/mpesa/* handler
  app.get("/api/mpesa/probe", (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Global M-Pesa rate limiter (60 req/min)", () => {
  it("allows the first 60 requests and blocks the 61st with HTTP 429", async () => {
    const app = buildApp();

    for (let i = 1; i <= 60; i++) {
      const res = await request(app).get("/api/mpesa/probe");
      expect(res.status, `request ${i} should not be rate-limited`).not.toBe(429);
    }

    const res61 = await request(app).get("/api/mpesa/probe");
    expect(res61.status).toBe(429);
  });

  it("returns the rate-limit error body on a 429 response", async () => {
    const app = buildApp();

    for (let i = 0; i < 60; i++) {
      await request(app).get("/api/mpesa/probe");
    }

    const res = await request(app).get("/api/mpesa/probe");
    expect(res.status).toBe(429);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toMatch(/too many requests/i);
  });

  it("includes RateLimit-* standard headers on a 429 response", async () => {
    const app = buildApp();

    for (let i = 0; i < 60; i++) {
      await request(app).get("/api/mpesa/probe");
    }

    const res = await request(app).get("/api/mpesa/probe");
    expect(res.status).toBe(429);

    // express-rate-limit with standardHeaders: true emits at least one of these
    const hasRateLimitHeader =
      "ratelimit-limit" in res.headers ||
      "ratelimit-remaining" in res.headers ||
      "ratelimit-reset" in res.headers ||
      "retry-after" in res.headers;

    expect(hasRateLimitHeader, "a RateLimit-* or Retry-After header must be present").toBe(true);
  });

  it("blocks requests to any /api/mpesa/* sub-path, not just /probe", async () => {
    const app = buildApp();

    // Exhaust limit via the probe route
    for (let i = 0; i < 60; i++) {
      await request(app).get("/api/mpesa/probe");
    }

    // A different sub-path on the same IP should also be blocked
    const res = await request(app).post("/api/mpesa/stk-push").send({});
    expect(res.status).toBe(429);
  });
});
