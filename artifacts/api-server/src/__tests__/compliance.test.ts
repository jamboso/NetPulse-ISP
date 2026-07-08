import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

const mockExec = vi.hoisted(() => vi.fn());

vi.mock("@workspace/db", () => {
  const chain: Record<string, unknown> = {};
  const chainMethods = [
    "select",
    "insert",
    "update",
    "from",
    "values",
    "set",
    "where",
    "orderBy",
    "leftJoin",
    "limit",
    "$dynamic",
  ];
  for (const m of chainMethods) {
    chain[m] = () => chain;
  }
  chain["returning"] = () => mockExec();
  chain["then"] = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    mockExec().then(resolve, reject);
  chain["catch"] = (reject: (e: unknown) => unknown) => mockExec().catch(reject);

  return {
    db: chain,
    sessionLogsTable: {
      id: {},
      customerId: {},
      subscriptionId: {},
      pppoeUsername: {},
      ipAddress: {},
      macAddress: {},
      sessionType: {},
      routerName: {},
      bytesIn: {},
      bytesOut: {},
      sessionStart: {},
      sessionEnd: {},
    },
    customersTable: { id: {}, name: {}, email: {} },
    subscriptionsTable: { id: {}, customerId: {}, planId: {} },
    plansTable: { id: {}, name: {} },
    eq: vi.fn(),
    and: vi.fn((...args: unknown[]) => args),
    gte: vi.fn(),
    lte: vi.fn(),
    desc: vi.fn(),
    isNull: vi.fn(),
  };
});

const { default: complianceRouter } = await import("../routes/compliance.js");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((_req: Request, _res: Response, next: NextFunction) => next());
  app.use(complianceRouter);
  return app;
}

const sampleCustomer = { id: 10, name: "Alice", email: "alice@example.com" };
const sampleLog = {
  id: 1,
  customerId: 10,
  subscriptionId: 5,
  ipAddress: "10.0.0.1",
  macAddress: "AA:BB:CC:DD:EE:FF",
  sessionType: "pppoe",
  bytesIn: 1000,
  bytesOut: 500,
  sessionStart: new Date().toISOString(),
  sessionEnd: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// GET /compliance/report
// ---------------------------------------------------------------------------

describe("GET /compliance/report", () => {
  it("returns 400 when customerId is missing", async () => {
    const res = await request(buildApp()).get("/compliance/report");

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 404 when customer does not exist", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp()).get("/compliance/report?customerId=999");

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });

  it("returns compliance report with customer and sessions", async () => {
    mockExec
      .mockResolvedValueOnce([sampleCustomer])
      .mockResolvedValueOnce([{ sub: { id: 5, customerId: 10 }, plan: { id: 1, name: "Basic" } }])
      .mockResolvedValueOnce([sampleLog]);

    const res = await request(buildApp()).get("/compliance/report?customerId=10");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("customer");
    expect(res.body).toHaveProperty("subscriptions");
    expect(res.body).toHaveProperty("sessions");
    expect(res.body).toHaveProperty("summary");
    expect(res.body).toHaveProperty("generatedAt");
  });

  it("computes byte totals in summary", async () => {
    const log1 = { ...sampleLog, bytesIn: 1000, bytesOut: 500 };
    const log2 = { ...sampleLog, id: 2, bytesIn: 2000, bytesOut: 1000 };
    mockExec
      .mockResolvedValueOnce([sampleCustomer])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([log1, log2]);

    const res = await request(buildApp()).get("/compliance/report?customerId=10");

    expect(res.status).toBe(200);
    expect(res.body.summary.totalBytesIn).toBe(3000);
    expect(res.body.summary.totalBytesOut).toBe(1500);
    expect(res.body.summary.totalBytes).toBe(4500);
    expect(res.body.summary.totalSessions).toBe(2);
  });

  it("accepts from and to date filters", async () => {
    mockExec
      .mockResolvedValueOnce([sampleCustomer])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const res = await request(buildApp()).get(
      "/compliance/report?customerId=10&from=2026-01-01&to=2026-01-31",
    );

    expect(res.status).toBe(200);
    expect(res.body.period).toHaveProperty("from");
    expect(res.body.period).toHaveProperty("to");
  });
});

// ---------------------------------------------------------------------------
// GET /compliance/sessions
// ---------------------------------------------------------------------------

describe("GET /compliance/sessions", () => {
  it("returns 400 when neither ip nor mac is provided", async () => {
    const res = await request(buildApp()).get("/compliance/sessions");

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("filters sessions by IP address", async () => {
    mockExec.mockResolvedValueOnce([
      { log: { ...sampleLog, ipAddress: "10.0.0.1" }, customer: sampleCustomer },
      { log: { ...sampleLog, id: 2, ipAddress: "10.0.0.2" }, customer: null },
    ]);

    const res = await request(buildApp()).get("/compliance/sessions?ip=10.0.0.1");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].ipAddress).toBe("10.0.0.1");
  });

  it("filters sessions by MAC address (normalizes separators)", async () => {
    mockExec.mockResolvedValueOnce([
      { log: { ...sampleLog, macAddress: "AA:BB:CC:DD:EE:FF" }, customer: sampleCustomer },
    ]);

    const res = await request(buildApp()).get("/compliance/sessions?mac=AABBCCDDEEFF");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it("returns empty array when no session matches the IP", async () => {
    mockExec.mockResolvedValueOnce([
      { log: { ...sampleLog, ipAddress: "192.168.1.99" }, customer: null },
    ]);

    const res = await request(buildApp()).get("/compliance/sessions?ip=10.0.0.1");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// POST /customers/:id/sessions/log
// ---------------------------------------------------------------------------

describe("POST /customers/:id/sessions/log", () => {
  it("returns 400 when sessions is not an array", async () => {
    const res = await request(buildApp())
      .post("/customers/10/sessions/log")
      .send({ sessions: "not an array" });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 201 with empty sessions array", async () => {
    const res = await request(buildApp())
      .post("/customers/10/sessions/log")
      .send({ sessions: [] });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("ok", true);
  });

  it("updates bytes for an online session that already has an open log", async () => {
    mockExec
      .mockResolvedValueOnce([{ id: 99 }])
      .mockResolvedValueOnce([]);

    const res = await request(buildApp())
      .post("/customers/10/sessions/log")
      .send({
        sessions: [{
          subscriptionId: 5,
          pppoeUsername: "alice",
          ipAddress: "10.0.0.1",
          macAddress: null,
          sessionType: "pppoe",
          routerName: "Router-1",
          bytesIn: 5000,
          bytesOut: 2000,
          online: true,
        }],
      });

    expect(res.status).toBe(201);
  });

  it("inserts a new session log when no open session exists", async () => {
    mockExec
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const res = await request(buildApp())
      .post("/customers/10/sessions/log")
      .send({
        sessions: [{
          subscriptionId: 5,
          pppoeUsername: "alice",
          ipAddress: "10.0.0.1",
          macAddress: null,
          sessionType: "pppoe",
          routerName: null,
          bytesIn: 1000,
          bytesOut: 500,
          online: true,
        }],
      });

    expect(res.status).toBe(201);
  });

  it("closes open session for an offline subscriber", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp())
      .post("/customers/10/sessions/log")
      .send({
        sessions: [{
          subscriptionId: 5,
          pppoeUsername: null,
          ipAddress: null,
          macAddress: null,
          sessionType: "pppoe",
          routerName: null,
          bytesIn: 0,
          bytesOut: 0,
          online: false,
        }],
      });

    expect(res.status).toBe(201);
  });
});
