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
  chain["then"] = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    mockExec().then(resolve, reject);
  chain["catch"] = (reject: (e: unknown) => unknown) => mockExec().catch(reject);

  return {
    db: chain,
    securityEventsTable: {
      id: {},
      createdAt: {},
      sourceIp: {},
      eventType: {},
      detail: {},
    },
    desc: vi.fn(),
    gte: vi.fn(),
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
  sourceIp: "1.2.3.4",
  eventType: "blocked_callback",
  detail: "Not a Safaricom IP",
};

beforeEach(() => {
  vi.clearAllMocks();
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
// GET /security-events/summary
// ---------------------------------------------------------------------------

describe("GET /security-events/summary", () => {
  it("returns blocked count in last 24h (admin)", async () => {
    mockExec.mockResolvedValueOnce([{ count: 7 }]);

    const res = await request(buildApp()).get("/security-events/summary");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("blockedLast24h", 7);
    expect(res.body).toHaveProperty("threshold", 5);
  });

  it("returns 403 for non-admin role", async () => {
    const res = await request(buildApp(billingUser)).get("/security-events/summary");

    expect(res.status).toBe(403);
  });

  it("returns 0 when no events in last 24h", async () => {
    mockExec.mockResolvedValueOnce([{ count: 0 }]);

    const res = await request(buildApp()).get("/security-events/summary");

    expect(res.status).toBe(200);
    expect(res.body.blockedLast24h).toBe(0);
  });

  it("falls back to 0 when count row is missing", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp()).get("/security-events/summary");

    expect(res.status).toBe(200);
    expect(res.body.blockedLast24h).toBe(0);
  });
});
