import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

const mockExec = vi.hoisted(() => vi.fn());
const mockDelete = vi.hoisted(() => vi.fn());

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
  chain["delete"] = () => deleteChain;
  chain["then"] = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    mockExec().then(resolve, reject);
  chain["catch"] = (reject: (e: unknown) => unknown) => mockExec().catch(reject);

  const deleteChain: Record<string, unknown> = {};
  const deleteMethods = ["where"];
  for (const m of deleteMethods) {
    deleteChain[m] = () => deleteChain;
  }
  deleteChain["then"] = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    mockDelete().then(resolve, reject);
  deleteChain["catch"] = (reject: (e: unknown) => unknown) => mockDelete().catch(reject);

  return {
    db: chain,
    securityEventsTable: {
      id: {},
      createdAt: {},
      sourceIp: {},
      eventType: {},
      detail: {},
      callerIp: {},
      endpoint: {},
      method: {},
      reason: {},
    },
    desc: vi.fn(),
    gte: vi.fn(),
    lt: vi.fn(),
    sql: vi.fn(() => ({})),
  };
});

const { default: securityEventsRouter } = await import("../routes/security-events.js");

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

function buildApp(user: MockUser = adminUser) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { user: MockUser }).user = user;
    next();
  });
  app.use(securityEventsRouter);
  return app;
}

const sampleEvent = {
  id: 1,
  createdAt: new Date().toISOString(),
  callerIp: "1.2.3.4",
  endpoint: "/api/mpesa/callback",
  method: "POST",
  eventType: "blocked_callback",
  reason: "Not a Safaricom IP",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockDelete.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// GET /security-events
// ---------------------------------------------------------------------------

describe("GET /security-events", () => {
  it("returns paginated list of security events (admin)", async () => {
    mockExec.mockResolvedValueOnce([sampleEvent]);

    const res = await request(buildApp()).get("/security-events");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("data");
    expect(res.body).toHaveProperty("page", 1);
    expect(res.body).toHaveProperty("limit", 50);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("returns 403 for non-admin role", async () => {
    const res = await request(buildApp(billingUser)).get("/security-events");

    expect(res.status).toBe(403);
  });

  it("respects page and limit query params", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp()).get("/security-events?page=2&limit=10");

    expect(res.status).toBe(200);
    expect(res.body.page).toBe(2);
    expect(res.body.limit).toBe(10);
  });

  it("clamps limit to 200 max", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp()).get("/security-events?limit=9999");

    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(200);
  });

  it("returns empty data array when no events exist", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp()).get("/security-events");

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// GET /security-events/summary  (now runs TWO queries: 24h + total)
// ---------------------------------------------------------------------------

describe("GET /security-events/summary", () => {
  it("returns blocked count in last 24h and total (admin)", async () => {
    mockExec
      .mockResolvedValueOnce([{ count: 7 }])   // 24h query
      .mockResolvedValueOnce([{ count: 42 }]);  // total query

    const res = await request(buildApp()).get("/security-events/summary");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("blockedLast24h", 7);
    expect(res.body).toHaveProperty("threshold", 5);
    expect(res.body).toHaveProperty("totalCount", 42);
  });

  it("returns 403 for non-admin role", async () => {
    const res = await request(buildApp(billingUser)).get("/security-events/summary");

    expect(res.status).toBe(403);
  });

  it("returns 0 when no events in last 24h", async () => {
    mockExec
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([{ count: 0 }]);

    const res = await request(buildApp()).get("/security-events/summary");

    expect(res.status).toBe(200);
    expect(res.body.blockedLast24h).toBe(0);
    expect(res.body.totalCount).toBe(0);
  });

  it("falls back to 0 when count row is missing", async () => {
    mockExec
      .mockResolvedValueOnce([])   // 24h query returns no rows
      .mockResolvedValueOnce([]);  // total query returns no rows

    const res = await request(buildApp()).get("/security-events/summary");

    expect(res.status).toBe(200);
    expect(res.body.blockedLast24h).toBe(0);
    expect(res.body.totalCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// GET /security-events/export.csv
// ---------------------------------------------------------------------------

describe("GET /security-events/export.csv", () => {
  it("returns a CSV file with correct headers (admin)", async () => {
    mockExec.mockResolvedValueOnce([
      { ...sampleEvent, createdAt: new Date("2024-01-15T10:00:00Z") },
    ]);

    const res = await request(buildApp()).get("/security-events/export.csv");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(/attachment/);
    expect(res.text).toContain("id,eventType,callerIp,endpoint,method,reason,createdAt");
    expect(res.text).toContain("blocked_callback");
    expect(res.text).toContain("1.2.3.4");
  });

  it("returns 403 for non-admin role", async () => {
    const res = await request(buildApp(billingUser)).get("/security-events/export.csv");

    expect(res.status).toBe(403);
  });

  it("returns CSV with only header row when no events exist", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp()).get("/security-events/export.csv");

    expect(res.status).toBe(200);
    expect(res.text.trim()).toBe("id,eventType,callerIp,endpoint,method,reason,createdAt");
  });
});

// ---------------------------------------------------------------------------
// DELETE /security-events
// ---------------------------------------------------------------------------

describe("DELETE /security-events", () => {
  it("deletes all records when retentionDays=0 (admin)", async () => {
    mockExec.mockResolvedValueOnce([{ count: 5 }]); // count query before delete
    mockDelete.mockResolvedValueOnce(undefined);

    const res = await request(buildApp()).delete("/security-events");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("deletedCount", 5);
  });

  it("deletes records older than retention window", async () => {
    mockExec.mockResolvedValueOnce([{ count: 3 }]); // count of old records
    mockDelete.mockResolvedValueOnce(undefined);

    const res = await request(buildApp()).delete("/security-events?retentionDays=30");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("deletedCount", 3);
  });

  it("returns 400 for negative retentionDays", async () => {
    const res = await request(buildApp()).delete("/security-events?retentionDays=-1");

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 for non-integer retentionDays", async () => {
    const res = await request(buildApp()).delete("/security-events?retentionDays=abc");

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 403 for non-admin role", async () => {
    const res = await request(buildApp(billingUser)).delete("/security-events");

    expect(res.status).toBe(403);
  });

  it("returns 0 when no records match the criteria", async () => {
    mockExec.mockResolvedValueOnce([{ count: 0 }]);
    mockDelete.mockResolvedValueOnce(undefined);

    const res = await request(buildApp()).delete("/security-events");

    expect(res.status).toBe(200);
    expect(res.body.deletedCount).toBe(0);
  });
});
