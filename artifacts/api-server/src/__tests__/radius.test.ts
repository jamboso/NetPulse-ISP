import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

const mockExec = vi.hoisted(() => vi.fn());
const mockSyncAll = vi.hoisted(() => vi.fn());

vi.mock("@workspace/db", () => {
  const chain: Record<string, unknown> = {};
  const chainMethods = [
    "select",
    "from",
    "where",
    "orderBy",
    "limit",
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
    subscriptionsTable: { id: {}, customerId: {}, pppoeUsername: {} },
    radacctTable: {
      radacctid: {},
      username: {},
      nasipaddress: {},
      acctsessionid: {},
      acctstarttime: {},
      acctstoptime: {},
      acctupdatetime: {},
      acctsessiontime: {},
      acctinputoctets: {},
      acctoutputoctets: {},
      framedipaddress: {},
      callingstationid: {},
      calledstationid: {},
      acctterminatecause: {},
    },
    eq: vi.fn(),
    inArray: vi.fn(),
    desc: vi.fn(),
  };
});

vi.mock("../lib/radiusSync.js", () => ({
  syncAllSubscriptions: mockSyncAll,
}));

const { default: radiusRouter } = await import("../routes/radius.js");

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
    (req as unknown as { user: MockUser; log: { info: () => void } }).user = user;
    (req as unknown as { user: MockUser; log: { info: () => void } }).log = { info: vi.fn() };
    next();
  });
  app.use(radiusRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// GET /customers/:id/radius-sessions
// ---------------------------------------------------------------------------

describe("GET /customers/:id/radius-sessions", () => {
  it("returns an empty array when customer has no subscriptions with usernames", async () => {
    mockExec.mockResolvedValueOnce([{ id: 5, pppoeUsername: null }]);

    const res = await request(buildApp()).get("/customers/10/radius-sessions");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns an empty array when customer has no subscriptions at all", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp()).get("/customers/10/radius-sessions");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns session data when subscriptions with usernames exist", async () => {
    const now = new Date();
    mockExec
      .mockResolvedValueOnce([{ id: 5, pppoeUsername: "alice.ngugi" }])
      .mockResolvedValueOnce([{
        radacctid: 1,
        username: "alice.ngugi",
        nasipaddress: "10.0.0.1",
        acctsessionid: "sess123",
        acctstarttime: now,
        acctstoptime: null,
        acctupdatetime: now,
        acctsessiontime: 3600,
        acctinputoctets: 1024,
        acctoutputoctets: 512,
        framedipaddress: "192.168.1.10",
        callingstationid: "AA:BB:CC:DD:EE:FF",
        calledstationid: null,
        acctterminatecause: null,
      }]);

    const res = await request(buildApp()).get("/customers/10/radius-sessions");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toHaveProperty("username", "alice.ngugi");
    expect(res.body[0]).toHaveProperty("active", true);
    expect(res.body[0]).toHaveProperty("bytesIn", 1024);
    expect(res.body[0]).toHaveProperty("bytesOut", 512);
  });

  it("marks session as inactive when acctstoptime is set", async () => {
    const now = new Date();
    mockExec
      .mockResolvedValueOnce([{ id: 5, pppoeUsername: "bob" }])
      .mockResolvedValueOnce([{
        radacctid: 2,
        username: "bob",
        nasipaddress: "10.0.0.1",
        acctsessionid: "sess456",
        acctstarttime: now,
        acctstoptime: now,
        acctupdatetime: now,
        acctsessiontime: 1800,
        acctinputoctets: 0,
        acctoutputoctets: 0,
        framedipaddress: null,
        callingstationid: null,
        calledstationid: null,
        acctterminatecause: "User-Request",
      }]);

    const res = await request(buildApp()).get("/customers/10/radius-sessions");

    expect(res.status).toBe(200);
    expect(res.body[0].active).toBe(false);
    expect(res.body[0].terminateCause).toBe("User-Request");
  });
});

// ---------------------------------------------------------------------------
// POST /admin/radius/sync
// ---------------------------------------------------------------------------

describe("POST /admin/radius/sync", () => {
  it("triggers RADIUS sync and returns result (admin)", async () => {
    mockSyncAll.mockResolvedValueOnce({ synced: 5, errors: 0 });

    const res = await request(buildApp()).post("/admin/radius/sync");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("ok", true);
    expect(res.body).toHaveProperty("synced", 5);
    expect(mockSyncAll).toHaveBeenCalledOnce();
  });

  it("returns 403 for non-admin role", async () => {
    const res = await request(buildApp(billingUser)).post("/admin/radius/sync");

    expect(res.status).toBe(403);
    expect(mockSyncAll).not.toHaveBeenCalled();
  });
});
