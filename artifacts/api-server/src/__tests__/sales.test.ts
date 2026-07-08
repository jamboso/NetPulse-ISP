import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

const mockExec = vi.hoisted(() => vi.fn());

vi.mock("@workspace/db", () => {
  const chain: Record<string, unknown> = {};
  const chainMethods = [
    "select",
    "from",
    "where",
    "orderBy",
    "leftJoin",
    "groupBy",
    "$dynamic",
  ];
  for (const m of chainMethods) {
    chain[m] = () => chain;
  }
  chain["execute"] = () => mockExec();
  chain["then"] = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    mockExec().then(resolve, reject);
  chain["catch"] = (reject: (e: unknown) => unknown) => mockExec().catch(reject);

  return {
    db: chain,
    paymentsTable: { id: {}, status: {}, amount: {}, createdAt: {} },
    subscriptionsTable: { id: {}, status: {}, planId: {}, createdAt: {} },
    customersTable: { id: {} },
    plansTable: { id: {}, name: {}, price: {}, billingCycle: {}, isActive: {} },
    auditLogsTable: { id: {} },
    eq: vi.fn(),
    gte: vi.fn(),
    and: vi.fn((...args: unknown[]) => args),
    desc: vi.fn(),
    sql: vi.fn(() => ({})),
  };
});

const { default: salesRouter } = await import("../routes/sales.js");

type MockUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const adminUser: MockUser = {
  id: "u1", email: "admin@test.com", name: "Admin", role: "admin",
  active: true, emailVerified: false, createdAt: new Date(), updatedAt: new Date(),
};

const billingUser: MockUser = {
  id: "u2", email: "billing@test.com", name: "Billing", role: "billing",
  active: true, emailVerified: false, createdAt: new Date(), updatedAt: new Date(),
};

const technicianUser: MockUser = {
  id: "u3", email: "tech@test.com", name: "Tech", role: "technician",
  active: true, emailVerified: false, createdAt: new Date(), updatedAt: new Date(),
};

function buildApp(user: MockUser = adminUser) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const r = req as unknown as { user: MockUser; log: { error: () => void } };
    r.user = user;
    r.log = { error: vi.fn() };
    next();
  });
  app.use(salesRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// GET /sales/summary
// ---------------------------------------------------------------------------

describe("GET /sales/summary", () => {
  function setupSummaryCounts() {
    mockExec
      .mockResolvedValueOnce([{ total: "5000" }])
      .mockResolvedValueOnce([{ total: "4000" }])
      .mockResolvedValueOnce([{ count: "3" }])
      .mockResolvedValueOnce([{ count: "2" }])
      .mockResolvedValueOnce([{ count: "50" }])
      .mockResolvedValueOnce([{ count: "120" }])
      .mockResolvedValueOnce([{ total: "99000" }]);
  }

  it("returns sales KPIs (admin)", async () => {
    setupSummaryCounts();

    const res = await request(buildApp()).get("/sales/summary");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("revenueThisMonth", 5000);
    expect(res.body).toHaveProperty("revenueLastMonth", 4000);
    expect(res.body).toHaveProperty("newSubsThisMonth", 3);
    expect(res.body).toHaveProperty("activeSubs", 50);
    expect(res.body).toHaveProperty("totalCustomers", 120);
    expect(res.body).toHaveProperty("allTimeRevenue", 99000);
  });

  it("returns sales KPIs (billing role)", async () => {
    setupSummaryCounts();

    const res = await request(buildApp(billingUser)).get("/sales/summary");

    expect(res.status).toBe(200);
  });

  it("returns 403 for technician role", async () => {
    const res = await request(buildApp(technicianUser)).get("/sales/summary");

    expect(res.status).toBe(403);
  });

  it("falls back to 0 when rows are missing", async () => {
    mockExec
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const res = await request(buildApp()).get("/sales/summary");

    expect(res.status).toBe(200);
    expect(res.body.revenueThisMonth).toBe(0);
    expect(res.body.allTimeRevenue).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// GET /sales/trends
// ---------------------------------------------------------------------------

describe("GET /sales/trends", () => {
  it("returns 30-day trend data (default period)", async () => {
    mockExec.mockResolvedValueOnce({
      rows: [
        { day: "2026-05-01", revenue: "1000", new_subs: "2" },
        { day: "2026-05-02", revenue: "500", new_subs: "1" },
      ],
    });

    const res = await request(buildApp()).get("/sales/trends");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("period", "30d");
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0]).toHaveProperty("date");
    expect(res.body.data[0]).toHaveProperty("revenue");
    expect(res.body.data[0]).toHaveProperty("newSubs");
  });

  it("returns 90-day trend data", async () => {
    mockExec.mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get("/sales/trends?period=90d");

    expect(res.status).toBe(200);
    expect(res.body.period).toBe("90d");
  });

  it("returns 12-month trend data", async () => {
    mockExec.mockResolvedValueOnce({
      rows: [{ month: "2026-01", revenue: "8000", new_subs: "10" }],
    });

    const res = await request(buildApp()).get("/sales/trends?period=12m");

    expect(res.status).toBe(200);
    expect(res.body.period).toBe("12m");
    expect(res.body.data[0].date).toBe("2026-01");
    expect(res.body.data[0].revenue).toBe(8000);
    expect(res.body.data[0].newSubs).toBe(10);
  });

  it("returns 403 for technician role", async () => {
    const res = await request(buildApp(technicianUser)).get("/sales/trends");

    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// GET /sales/by-plan
// ---------------------------------------------------------------------------

describe("GET /sales/by-plan", () => {
  it("returns revenue breakdown by plan (admin)", async () => {
    mockExec.mockResolvedValueOnce([
      { planId: 1, planName: "Basic", price: "500", billingCycle: "monthly", subsCount: "20", activeSubs: "18" },
      { planId: 2, planName: "Pro", price: "1000", billingCycle: "monthly", subsCount: "10", activeSubs: "9" },
    ]);

    const res = await request(buildApp()).get("/sales/by-plan");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("data");
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0]).toHaveProperty("planName", "Basic");
    expect(res.body.data[0]).toHaveProperty("mrr", 9000);
  });

  it("returns 403 for technician role", async () => {
    const res = await request(buildApp(technicianUser)).get("/sales/by-plan");

    expect(res.status).toBe(403);
  });

  it("computes MRR as price × activeSubs", async () => {
    mockExec.mockResolvedValueOnce([
      { planId: 1, planName: "Enterprise", price: "5000", billingCycle: "monthly", subsCount: "5", activeSubs: "4" },
    ]);

    const res = await request(buildApp()).get("/sales/by-plan");

    expect(res.status).toBe(200);
    expect(res.body.data[0].mrr).toBe(20000);
  });
});

// ---------------------------------------------------------------------------
// GET /sales/staff-activity
// ---------------------------------------------------------------------------

describe("GET /sales/staff-activity", () => {
  it("returns staff activity grouped by email (admin)", async () => {
    mockExec.mockResolvedValueOnce({
      rows: [
        { user_email: "alice@test.com", entity_type: "customer", action: "create", count: "5" },
        { user_email: "alice@test.com", entity_type: "subscription", action: "create", count: "3" },
        { user_email: "bob@test.com", entity_type: "payment", action: "create", count: "10" },
      ],
    });

    const res = await request(buildApp()).get("/sales/staff-activity");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("days", 30);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0]).toHaveProperty("email");
    expect(res.body.data[0]).toHaveProperty("customers");
    expect(res.body.data[0]).toHaveProperty("subscriptions");
    expect(res.body.data[0]).toHaveProperty("payments");
    expect(res.body.data[0]).toHaveProperty("total");
  });

  it("accumulates counts correctly per entity type", async () => {
    mockExec.mockResolvedValueOnce({
      rows: [
        { user_email: "alice@test.com", entity_type: "customer", action: "create", count: "5" },
        { user_email: "alice@test.com", entity_type: "subscription", action: "create", count: "3" },
        { user_email: "alice@test.com", entity_type: "payment", action: "create", count: "7" },
      ],
    });

    const res = await request(buildApp()).get("/sales/staff-activity");

    expect(res.status).toBe(200);
    const alice = res.body.data.find((d: { email: string }) => d.email === "alice@test.com");
    expect(alice).toBeDefined();
    expect(alice.customers).toBe(5);
    expect(alice.subscriptions).toBe(3);
    expect(alice.payments).toBe(7);
    expect(alice.total).toBe(15);
  });

  it("accepts a custom days param", async () => {
    mockExec.mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get("/sales/staff-activity?days=90");

    expect(res.status).toBe(200);
    expect(res.body.days).toBe(90);
  });

  it("clamps days to 365 max", async () => {
    mockExec.mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get("/sales/staff-activity?days=9999");

    expect(res.status).toBe(200);
    expect(res.body.days).toBe(365);
  });

  it("returns 403 for technician role", async () => {
    const res = await request(buildApp(technicianUser)).get("/sales/staff-activity");

    expect(res.status).toBe(403);
  });
});
