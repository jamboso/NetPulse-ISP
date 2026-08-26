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
    "limit",
    "offset",
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
    customersTable: { id: {}, name: {}, createdAt: {} },
    subscriptionsTable: { id: {}, status: {} },
    invoicesTable: { id: {}, status: {}, amount: {} },
    ticketsTable: { id: {}, status: {} },
    equipmentTable: { id: {} },
    ipPoolsTable: { id: {} },
    paymentsTable: { id: {} },
    sql: vi.fn(() => ({})),
    eq: vi.fn(),
  };
});

const { default: dashboardRouter } = await import("../routes/dashboard.js");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((_req: Request, _res: Response, next: NextFunction) => next());
  app.use(dashboardRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// GET /dashboard/summary
// ---------------------------------------------------------------------------

describe("GET /dashboard/summary", () => {
  function setupSummaryCounts({
    customers = 10,
    activeSubs = 7,
    overdueInvs = 2,
    revenue = 5000,
    openTickets = 3,
    equipment = 15,
    ipPools = 4,
    newCustomers = 1,
  } = {}) {
    mockExec
      .mockResolvedValueOnce([{ count: String(customers) }])
      .mockResolvedValueOnce([{ count: String(activeSubs) }])
      .mockResolvedValueOnce([{ count: String(overdueInvs) }])
      .mockResolvedValueOnce([{ total: String(revenue) }])
      .mockResolvedValueOnce([{ count: String(openTickets) }])
      .mockResolvedValueOnce([{ count: String(equipment) }])
      .mockResolvedValueOnce([{ count: String(ipPools) }])
      .mockResolvedValueOnce([{ count: String(newCustomers) }]);
  }

  it("returns summary KPIs with all expected fields", async () => {
    setupSummaryCounts();

    const res = await request(buildApp()).get("/dashboard/summary");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("totalCustomers", 10);
    expect(res.body).toHaveProperty("activeSubscriptions", 7);
    expect(res.body).toHaveProperty("overdueInvoices", 2);
    expect(res.body).toHaveProperty("monthlyRevenue", 5000);
    expect(res.body).toHaveProperty("openTickets", 3);
    expect(res.body).toHaveProperty("totalEquipment", 15);
    expect(res.body).toHaveProperty("totalIpPools", 4);
    expect(res.body).toHaveProperty("newCustomersThisMonth", 1);
  });

  it("coerces count strings to numbers", async () => {
    setupSummaryCounts({ customers: 42 });

    const res = await request(buildApp()).get("/dashboard/summary");

    expect(res.status).toBe(200);
    expect(typeof res.body.totalCustomers).toBe("number");
    expect(res.body.totalCustomers).toBe(42);
  });

  it("falls back to 0 when count rows are missing", async () => {
    mockExec
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const res = await request(buildApp()).get("/dashboard/summary");

    expect(res.status).toBe(200);
    expect(res.body.totalCustomers).toBe(0);
    expect(res.body.activeSubscriptions).toBe(0);
    expect(res.body.monthlyRevenue).toBe(0);
  });

  it("sets Cache-Control header", async () => {
    setupSummaryCounts();

    const res = await request(buildApp()).get("/dashboard/summary");

    expect(res.headers["cache-control"]).toBe("private, no-store");
  });

  it("returns exactly 8 top-level KPI keys", async () => {
    setupSummaryCounts();

    const res = await request(buildApp()).get("/dashboard/summary");

    const keys = Object.keys(res.body);
    expect(keys).toHaveLength(8);
    expect(keys).toEqual(
      expect.arrayContaining([
        "totalCustomers",
        "activeSubscriptions",
        "overdueInvoices",
        "monthlyRevenue",
        "openTickets",
        "totalEquipment",
        "totalIpPools",
        "newCustomersThisMonth",
      ])
    );
  });

  it("handles fractional revenue correctly", async () => {
    setupSummaryCounts({ revenue: 1234.56 });

    const res = await request(buildApp()).get("/dashboard/summary");

    expect(res.status).toBe(200);
    expect(res.body.monthlyRevenue).toBe(1234.56);
  });

  it("returns all zeros when the database has no data at all", async () => {
    mockExec
      .mockResolvedValueOnce([{ count: "0" }])
      .mockResolvedValueOnce([{ count: "0" }])
      .mockResolvedValueOnce([{ count: "0" }])
      .mockResolvedValueOnce([{ total: "0" }])
      .mockResolvedValueOnce([{ count: "0" }])
      .mockResolvedValueOnce([{ count: "0" }])
      .mockResolvedValueOnce([{ count: "0" }])
      .mockResolvedValueOnce([{ count: "0" }]);

    const res = await request(buildApp()).get("/dashboard/summary");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      totalCustomers: 0,
      activeSubscriptions: 0,
      overdueInvoices: 0,
      monthlyRevenue: 0,
      openTickets: 0,
      totalEquipment: 0,
      totalIpPools: 0,
      newCustomersThisMonth: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// GET /dashboard/revenue
// ---------------------------------------------------------------------------

describe("GET /dashboard/revenue", () => {
  it("returns revenue data array", async () => {
    mockExec.mockResolvedValueOnce({
      rows: [
        { month: "Jan 2026", revenue: "1000", invoice_count: "5" },
        { month: "Feb 2026", revenue: "1500", invoice_count: "8" },
      ],
    });

    const res = await request(buildApp()).get("/dashboard/revenue");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toHaveProperty("month");
    expect(res.body[0]).toHaveProperty("revenue");
    expect(res.body[0]).toHaveProperty("invoiceCount");
  });

  it("coerces revenue and invoiceCount to numbers", async () => {
    mockExec.mockResolvedValueOnce({
      rows: [{ month: "Jan 2026", revenue: "9999.99", invoice_count: "12" }],
    });

    const res = await request(buildApp()).get("/dashboard/revenue");

    expect(res.status).toBe(200);
    expect(typeof res.body[0].revenue).toBe("number");
    expect(typeof res.body[0].invoiceCount).toBe("number");
    expect(res.body[0].revenue).toBe(9999.99);
    expect(res.body[0].invoiceCount).toBe(12);
  });

  it("returns empty array when no revenue rows exist", async () => {
    mockExec.mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get("/dashboard/revenue");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("sets Cache-Control header", async () => {
    mockExec.mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get("/dashboard/revenue");

    expect(res.headers["cache-control"]).toBe("private, no-store");
  });
});

// ---------------------------------------------------------------------------
// GET /dashboard/activity
// ---------------------------------------------------------------------------

describe("GET /dashboard/activity", () => {
  const sampleRows = [
    { id: 1, type: "customer_created", description: "New customer added: Alice", ts: new Date().toISOString(), entity_id: 1, entity_type: "customer" },
    { id: 2, type: "ticket_opened", description: "Ticket: No internet", ts: new Date().toISOString(), entity_id: 5, entity_type: "ticket" },
  ];

  it("returns activity feed with expected fields", async () => {
    mockExec.mockResolvedValueOnce({ rows: sampleRows });

    const res = await request(buildApp()).get("/dashboard/activity");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0]).toHaveProperty("id");
    expect(res.body[0]).toHaveProperty("type");
    expect(res.body[0]).toHaveProperty("description");
    expect(res.body[0]).toHaveProperty("timestamp");
    expect(res.body[0]).toHaveProperty("entityId");
    expect(res.body[0]).toHaveProperty("entityType");
  });

  it("re-indexes ids starting from 1", async () => {
    mockExec.mockResolvedValueOnce({ rows: sampleRows });

    const res = await request(buildApp()).get("/dashboard/activity");

    expect(res.body[0].id).toBe(1);
    expect(res.body[1].id).toBe(2);
  });

  it("returns empty array when no activity exists", async () => {
    mockExec.mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get("/dashboard/activity");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("sets Cache-Control header", async () => {
    mockExec.mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get("/dashboard/activity");

    expect(res.headers["cache-control"]).toBe("private, no-store");
  });
});

// ---------------------------------------------------------------------------
// GET /dashboard/subscription-breakdown
// ---------------------------------------------------------------------------

describe("GET /dashboard/subscription-breakdown", () => {
  it("returns subscription status counts", async () => {
    mockExec.mockResolvedValueOnce({
      rows: [
        { status: "active", count: "12" },
        { status: "suspended", count: "3" },
        { status: "cancelled", count: "1" },
      ],
    });

    const res = await request(buildApp()).get("/dashboard/subscription-breakdown");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(3);
    expect(res.body[0]).toHaveProperty("status", "active");
    expect(res.body[0]).toHaveProperty("count", 12);
  });

  it("coerces count to number", async () => {
    mockExec.mockResolvedValueOnce({
      rows: [{ status: "active", count: "99" }],
    });

    const res = await request(buildApp()).get("/dashboard/subscription-breakdown");

    expect(typeof res.body[0].count).toBe("number");
    expect(res.body[0].count).toBe(99);
  });

  it("returns empty array when no subscriptions exist", async () => {
    mockExec.mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get("/dashboard/subscription-breakdown");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("sets Cache-Control header", async () => {
    mockExec.mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get("/dashboard/subscription-breakdown");

    expect(res.headers["cache-control"]).toBe("private, no-store");
  });
});
