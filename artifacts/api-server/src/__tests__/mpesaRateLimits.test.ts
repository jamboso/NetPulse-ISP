/**
 * Tests that the register-URLs (max 5 req/min) and transactions (max 30
 * req/min) per-user rate limiters correctly block excess requests with HTTP
 * 429 and return the expected error message.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { type Request, type Response, type NextFunction, type Router } from "express";
import request from "supertest";

// ── Mocks ─────────────────────────────────────────────────────────────────────
vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => []) })) })),
  },
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

// ── Register-URLs rate limiter ────────────────────────────────────────────────

describe("Register-URLs rate limiter", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.mock("@workspace/db", () => ({
      db: {
        select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => []) })) })),
      },
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

  it("allows the first 5 requests and blocks the 6th with 429", async () => {
    const { mpesaProtectedRouter } = await import("../routes/mpesa.js");
    const user: FakeUser = { id: "ru-user-a", email: "a@test.com", role: "admin" };
    const app = buildApp(user, mpesaProtectedRouter);

    // Requests 1-5: rate limiter passes them through.
    // The handler itself may return an error (missing M-Pesa config) — that is
    // expected; skipFailedRequests: false means they still count toward the limit.
    for (let i = 1; i <= 5; i++) {
      const res = await request(app).post("/mpesa/register-urls").send({});
      expect(res.status, `request ${i} should not be rate-limited`).not.toBe(429);
    }

    // Request 6: must be blocked by the rate limiter
    const res6 = await request(app).post("/mpesa/register-urls").send({});
    expect(res6.status).toBe(429);
    expect(res6.body).toHaveProperty("error");
  });

  it("returns the correct error message on a 429 response", async () => {
    const { mpesaProtectedRouter } = await import("../routes/mpesa.js");
    const user: FakeUser = { id: "ru-user-b", email: "b@test.com", role: "admin" };
    const app = buildApp(user, mpesaProtectedRouter);

    // Exhaust the 5-request budget
    for (let i = 0; i < 5; i++) {
      await request(app).post("/mpesa/register-urls").send({});
    }

    const res = await request(app).post("/mpesa/register-urls").send({});
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/too many register-urls requests/i);
  });

  it("does not penalise a different user when another has exhausted their quota", async () => {
    const { mpesaProtectedRouter } = await import("../routes/mpesa.js");

    const userC: FakeUser = { id: "ru-user-c", email: "c@test.com", role: "admin" };
    const userD: FakeUser = { id: "ru-user-d", email: "d@test.com", role: "admin" };

    // user-c exhausts their 5-request budget
    const appC = buildApp(userC, mpesaProtectedRouter);
    for (let i = 0; i < 5; i++) {
      await request(appC).post("/mpesa/register-urls").send({});
    }
    const blockedRes = await request(appC).post("/mpesa/register-urls").send({});
    expect(blockedRes.status).toBe(429);

    // user-d has not made any requests — their first request must not be 429
    const appD = buildApp(userD, mpesaProtectedRouter);
    const resD = await request(appD).post("/mpesa/register-urls").send({});
    expect(resD.status, "user-d should not be rate-limited").not.toBe(429);
  });
});

// ── Transactions rate limiter ─────────────────────────────────────────────────

describe("Transactions rate limiter", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.mock("@workspace/db", () => ({
      db: {
        select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => []) })) })),
      },
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

  it("allows the first 30 requests and blocks the 31st with 429", async () => {
    const { mpesaProtectedRouter } = await import("../routes/mpesa.js");
    const user: FakeUser = { id: "tx-user-a", email: "a@test.com", role: "admin" };
    const app = buildApp(user, mpesaProtectedRouter);

    // Requests 1-30: rate limiter passes them through.
    for (let i = 1; i <= 30; i++) {
      const res = await request(app).get("/mpesa/transactions");
      expect(res.status, `request ${i} should not be rate-limited`).not.toBe(429);
    }

    // Request 31: must be blocked by the rate limiter
    const res31 = await request(app).get("/mpesa/transactions");
    expect(res31.status).toBe(429);
    expect(res31.body).toHaveProperty("error");
  });

  it("returns the correct error message on a 429 response", async () => {
    const { mpesaProtectedRouter } = await import("../routes/mpesa.js");
    const user: FakeUser = { id: "tx-user-b", email: "b@test.com", role: "admin" };
    const app = buildApp(user, mpesaProtectedRouter);

    // Exhaust the 30-request budget
    for (let i = 0; i < 30; i++) {
      await request(app).get("/mpesa/transactions");
    }

    const res = await request(app).get("/mpesa/transactions");
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/too many transaction requests/i);
  });

  it("does not penalise a different user when another has exhausted their quota", async () => {
    const { mpesaProtectedRouter } = await import("../routes/mpesa.js");

    const userC: FakeUser = { id: "tx-user-c", email: "c@test.com", role: "admin" };
    const userD: FakeUser = { id: "tx-user-d", email: "d@test.com", role: "admin" };

    // user-c exhausts their 30-request budget
    const appC = buildApp(userC, mpesaProtectedRouter);
    for (let i = 0; i < 30; i++) {
      await request(appC).get("/mpesa/transactions");
    }
    const blockedRes = await request(appC).get("/mpesa/transactions");
    expect(blockedRes.status).toBe(429);

    // user-d has not made any requests — their first request must not be 429
    const appD = buildApp(userD, mpesaProtectedRouter);
    const resD = await request(appD).get("/mpesa/transactions");
    expect(resD.status, "user-d should not be rate-limited").not.toBe(429);
  });
});
