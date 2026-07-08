/**
 * Route-level integration tests for M-Pesa public callback security.
 *
 * These tests mount the full mpesaPublicRouter (which stacks both
 * requireSafaricomIp and requireMpesaWebhookSecret on every public endpoint)
 * and confirm that the correct middleware wiring is in place. They catch
 * regressions such as a refactor accidentally dropping one of the guards.
 *
 * Scenarios covered:
 *   1. Valid Safaricom IP + correct secret          → 200
 *   2. Valid Safaricom IP + wrong secret            → 403
 *   3. Disallowed IP + correct secret               → 403
 *   4. Both checks disabled (MPESA_ALLOWED_IPS=*,
 *      no secret configured)                        → 200
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ── Top-level mocks ────────────────────────────────────────────────────────────
// Provide a minimal DB stub that satisfies requireSafaricomIp's settings lookup.
// The select chain returns an empty array (no DB-level override), so the
// middleware falls through to MPESA_ALLOWED_IPS / default Safaricom CIDRs.
vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([]),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn().mockResolvedValue([]),
    })),
  },
  pool: {},
  settingsTable: {},
  securityEventsTable: {},
  paymentsTable: {},
  invoicesTable: {},
  customersTable: {},
  hotspotVouchersTable: {},
  hotspotPackagesTable: {},
  routersTable: {},
  eq: vi.fn(),
  ilike: vi.fn(),
}));

// requireMpesaWebhookSecret calls getSettings() to check for a DB-level secret.
// Returning an empty object means the middleware falls through to MPESA_WEBHOOK_SECRET.
vi.mock("../lib/sms.js", () => ({
  getSettings: vi.fn().mockResolvedValue({}),
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Attach a minimal pino-compatible logger stub to every request. */
function attachLogger(app: Express) {
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { log: Record<string, unknown> }).log = {
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    next();
  });
}

/**
 * Build a minimal Express app that mounts the real mpesaPublicRouter.
 * The caller IP is pinned to `overrideIp` so tests are deterministic.
 */
async function buildApp(overrideIp: string): Promise<Express> {
  const { mpesaPublicRouter } = await import("../routes/mpesa.js");

  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());

  // Pin req.ip regardless of the supertest loopback address
  app.use((_req: Request, _res: Response, next: NextFunction) => {
    Object.defineProperty(_req, "ip", { get: () => overrideIp, configurable: true });
    next();
  });

  attachLogger(app);
  app.use(mpesaPublicRouter);

  return app;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("mpesaPublicRouter — callback security (IP + secret stacked)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env["MPESA_ALLOWED_IPS"];
    delete process.env["MPESA_WEBHOOK_SECRET"];
    vi.resetModules();
    // Re-apply mocks after resetModules so dynamic imports still get stubs
    vi.mock("@workspace/db", () => ({
      db: {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn().mockResolvedValue([]),
          })),
        })),
        insert: vi.fn(() => ({
          values: vi.fn().mockResolvedValue([]),
        })),
      },
      pool: {},
      settingsTable: {},
      securityEventsTable: {},
      paymentsTable: {},
      invoicesTable: {},
      customersTable: {},
      hotspotVouchersTable: {},
      hotspotPackagesTable: {},
      routersTable: {},
      eq: vi.fn(),
      ilike: vi.fn(),
    }));
    vi.mock("../lib/sms.js", () => ({
      getSettings: vi.fn().mockResolvedValue({}),
    }));
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.resetModules();
  });

  it("allows a request with a valid Safaricom IP and the correct secret", async () => {
    process.env["MPESA_WEBHOOK_SECRET"] = "test-secret";
    vi.resetModules();
    vi.mock("@workspace/db", () => ({
      db: {
        select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) })),
        insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue([]) })),
      },
      pool: {},
      settingsTable: {},
      securityEventsTable: {},
      paymentsTable: {},
      invoicesTable: {},
      customersTable: {},
      hotspotVouchersTable: {},
      hotspotPackagesTable: {},
      routersTable: {},
      eq: vi.fn(),
      ilike: vi.fn(),
    }));
    vi.mock("../lib/sms.js", () => ({
      getSettings: vi.fn().mockResolvedValue({}),
    }));

    // 196.201.214.1 is inside Safaricom's published 196.201.214.0/24 range
    const app = await buildApp("196.201.214.1");
    const res = await request(app)
      .post("/mpesa/c2b/validation")
      .set("x-mpesa-webhook-secret", "test-secret")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ResultCode: "0" });
  });

  it("rejects a request from a valid Safaricom IP when the webhook secret is wrong", async () => {
    process.env["MPESA_WEBHOOK_SECRET"] = "correct-secret";
    vi.resetModules();
    vi.mock("@workspace/db", () => ({
      db: {
        select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) })),
        insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue([]) })),
      },
      pool: {},
      settingsTable: {},
      securityEventsTable: {},
      paymentsTable: {},
      invoicesTable: {},
      customersTable: {},
      hotspotVouchersTable: {},
      hotspotPackagesTable: {},
      routersTable: {},
      eq: vi.fn(),
      ilike: vi.fn(),
    }));
    vi.mock("../lib/sms.js", () => ({
      getSettings: vi.fn().mockResolvedValue({}),
    }));

    const app = await buildApp("196.201.214.1");
    const res = await request(app)
      .post("/mpesa/c2b/validation")
      .set("x-mpesa-webhook-secret", "wrong-secret")
      .send({});

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty("error");
  });

  it("rejects a request from a disallowed IP even when the webhook secret is correct", async () => {
    process.env["MPESA_WEBHOOK_SECRET"] = "correct-secret";
    vi.resetModules();
    vi.mock("@workspace/db", () => ({
      db: {
        select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) })),
        insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue([]) })),
      },
      pool: {},
      settingsTable: {},
      securityEventsTable: {},
      paymentsTable: {},
      invoicesTable: {},
      customersTable: {},
      hotspotVouchersTable: {},
      hotspotPackagesTable: {},
      routersTable: {},
      eq: vi.fn(),
      ilike: vi.fn(),
    }));
    vi.mock("../lib/sms.js", () => ({
      getSettings: vi.fn().mockResolvedValue({}),
    }));

    // 1.2.3.4 is not in any Safaricom CIDR range
    const app = await buildApp("1.2.3.4");
    const res = await request(app)
      .post("/mpesa/c2b/validation")
      .set("x-mpesa-webhook-secret", "correct-secret")
      .send({});

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty("error");
  });

  it("allows a request when both checks are disabled (MPESA_ALLOWED_IPS=* and no secret)", async () => {
    process.env["MPESA_ALLOWED_IPS"] = "*";
    // MPESA_WEBHOOK_SECRET is intentionally not set
    vi.resetModules();
    vi.mock("@workspace/db", () => ({
      db: {
        select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) })),
        insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue([]) })),
      },
      pool: {},
      settingsTable: {},
      securityEventsTable: {},
      paymentsTable: {},
      invoicesTable: {},
      customersTable: {},
      hotspotVouchersTable: {},
      hotspotPackagesTable: {},
      routersTable: {},
      eq: vi.fn(),
      ilike: vi.fn(),
    }));
    vi.mock("../lib/sms.js", () => ({
      getSettings: vi.fn().mockResolvedValue({}),
    }));

    // Any IP is accepted when MPESA_ALLOWED_IPS=*
    const app = await buildApp("192.168.99.99");
    const res = await request(app)
      .post("/mpesa/c2b/validation")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ResultCode: "0" });
  });
});
