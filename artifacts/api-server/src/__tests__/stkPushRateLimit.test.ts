/**
 * Tests that the STK Push per-user rate limiter (max 10 req/min) correctly
 * blocks excess requests with HTTP 429 and does not penalise other users.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { type Request, type Response, type NextFunction, type Router } from "express";
import request from "supertest";

// ── Mocks ────────────────────────────────────────────────────────────────────
// Stub out the DB entirely — the STK Push handler never reaches DB calls
// because MPESA env vars are intentionally absent (returns 503 before any DB
// interaction). The rate limiter fires BEFORE the handler, so the 429 test
// does not require M-Pesa credentials.
vi.mock("@workspace/db", () => ({
  db: {},
  pool: {},
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

// ── Helpers ───────────────────────────────────────────────────────────────────

type FakeUser = { id: string; email: string; role: string };

/** Pino-compatible logger stub attached to req.log */
function attachLogger(app: ReturnType<typeof express>) {
  app.use((req: Request, _res: Response, next: NextFunction) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).log = {
      warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn(),
      fatal: vi.fn(), trace: vi.fn(), silent: vi.fn(),
      level: "info", msgPrefix: "",
    };
    next();
  });
}

/**
 * Builds a minimal Express app that injects `user` onto req and mounts the
 * provided mpesaProtectedRouter.
 */
function buildApp(user: FakeUser, router: Router) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).user = user;
    next();
  });
  attachLogger(app);
  app.use(router);
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("STK Push rate limiter", () => {
  beforeEach(() => {
    // Fresh module registry → fresh rate limiter state for each test
    vi.resetModules();
    vi.mock("@workspace/db", () => ({
      db: {},
      pool: {},
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

  it("allows the first 10 requests and blocks the 11th with 429", async () => {
    const { mpesaProtectedRouter } = await import("../routes/mpesa.js");
    const userA: FakeUser = { id: "user-a", email: "a@test.com", role: "admin" };
    const app = buildApp(userA, mpesaProtectedRouter);

    // Requests 1-10: rate limiter passes them through.
    // The handler itself returns 503 (M-Pesa unconfigured) — that's fine;
    // skipFailedRequests: false means these still count toward the limit.
    for (let i = 1; i <= 10; i++) {
      const res = await request(app)
        .post("/mpesa/stk-push")
        .send({ phone: "254700000000", amount: 100 });
      expect(res.status, `request ${i} should not be rate-limited`).not.toBe(429);
    }

    // Request 11: must be blocked by the rate limiter
    const res11 = await request(app)
      .post("/mpesa/stk-push")
      .send({ phone: "254700000000", amount: 100 });
    expect(res11.status).toBe(429);
    expect(res11.body).toHaveProperty("error");
  });

  it("returns the rate-limit error message on a 429 response", async () => {
    const { mpesaProtectedRouter } = await import("../routes/mpesa.js");
    const userB: FakeUser = { id: "user-b", email: "b@test.com", role: "admin" };
    const app = buildApp(userB, mpesaProtectedRouter);

    // Exhaust the 10-request budget
    for (let i = 0; i < 10; i++) {
      await request(app)
        .post("/mpesa/stk-push")
        .send({ phone: "254700000000", amount: 100 });
    }

    const res = await request(app)
      .post("/mpesa/stk-push")
      .send({ phone: "254700000000", amount: 100 });

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/too many stk push/i);
  });

  it("does not penalise a different user when another has exhausted their quota", async () => {
    const { mpesaProtectedRouter } = await import("../routes/mpesa.js");

    const userC: FakeUser = { id: "user-c", email: "c@test.com", role: "admin" };
    const userD: FakeUser = { id: "user-d", email: "d@test.com", role: "admin" };

    // user-c exhausts their 10-request budget
    const appC = buildApp(userC, mpesaProtectedRouter);
    for (let i = 0; i < 10; i++) {
      await request(appC)
        .post("/mpesa/stk-push")
        .send({ phone: "254700000000", amount: 100 });
    }
    const blockedRes = await request(appC)
      .post("/mpesa/stk-push")
      .send({ phone: "254700000000", amount: 100 });
    expect(blockedRes.status).toBe(429);

    // user-d has not made any requests — their first request must not be 429
    const appD = buildApp(userD, mpesaProtectedRouter);
    const resD = await request(appD)
      .post("/mpesa/stk-push")
      .send({ phone: "254700000000", amount: 100 });
    expect(resD.status, "user-d should not be rate-limited").not.toBe(429);
  });
});
