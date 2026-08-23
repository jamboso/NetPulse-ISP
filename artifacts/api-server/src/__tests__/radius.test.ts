import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

const mockExec = vi.hoisted(() => vi.fn());
const mockSyncAll = vi.hoisted(() => vi.fn());
const mockGetRouter = vi.hoisted(() => vi.fn());
const mockGetRadiusConfig = vi.hoisted(() => vi.fn());
const mockUpsertRos = vi.hoisted(() => vi.fn());
const mockRosReq = vi.hoisted(() => vi.fn());

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
    usersTable: { id: {}, email: {} },
    sessionsTable: { id: {} },
    accountsTable: { id: {} },
    verificationsTable: { id: {} },
    settingsTable: { key: {}, value: {} },
    radcheckTable: { id: {}, username: {}, attribute: {}, value: {} },
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
    customersTable: { id: {}, companyId: {} },
    eq: vi.fn(),
    inArray: vi.fn(),
    desc: vi.fn(),
  };
});

const mockSignInEmail = vi.hoisted(() => vi.fn());
const mockSyncStaffUserRadius = vi.hoisted(() => vi.fn());

vi.mock("../lib/radiusSync.js", () => ({
  syncAllSubscriptions: mockSyncAll,
  syncStaffUserRadius: mockSyncStaffUserRadius,
}));

vi.mock("../lib/auth.js", () => ({
  auth: {
    api: {
      signInEmail: mockSignInEmail,
    },
  },
}));

vi.mock("../routes/pppoe.js", () => ({
  getRouter: mockGetRouter,
  getRadiusConfig: mockGetRadiusConfig,
  upsertRos: mockUpsertRos,
  rosReq: mockRosReq,
}));

vi.mock("../middlewares/companyScope.js", () => ({
  resolveCompanyScope: (_req: Request, _res: Response, next: NextFunction) => next(),
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
    (req as any).user = user;
    (req as any).log = { info: vi.fn(), error: vi.fn() };
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
    mockExec
      .mockResolvedValueOnce([{ id: 10 }])
      .mockResolvedValueOnce([{ id: 5, pppoeUsername: null }]);

    const res = await request(buildApp()).get("/customers/10/radius-sessions");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns an empty array when customer has no subscriptions at all", async () => {
    mockExec
      .mockResolvedValueOnce([{ id: 10 }])
      .mockResolvedValueOnce([]);

    const res = await request(buildApp()).get("/customers/10/radius-sessions");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns session data when subscriptions with usernames exist", async () => {
    const now = new Date();
    mockExec
      .mockResolvedValueOnce([{ id: 10 }])
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
      .mockResolvedValueOnce([{ id: 10 }])
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

describe("POST /routers/:id/ros/radius/admin-login", () => {
  it("denies non-admin users before changing RouterOS login configuration", async () => {
    const res = await request(buildApp(billingUser)).post("/routers/7/ros/radius/admin-login");

    expect(res.status).toBe(403);
    expect(mockGetRouter).not.toHaveBeenCalled();
  });

  it("requires RADIUS settings before configuring RouterOS admin authentication", async () => {
    mockGetRouter.mockResolvedValueOnce({ id: 7 });
    mockGetRadiusConfig.mockResolvedValueOnce(null);

    const res = await request(buildApp()).post("/routers/7/ros/radius/admin-login");

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("RADIUS is not configured");
    expect(mockUpsertRos).not.toHaveBeenCalled();
  });

  it("configures the login RADIUS service and enables RouterOS AAA", async () => {
    mockGetRouter.mockResolvedValueOnce({
      id: 7, ipAddress: "192.0.2.7", apiSsl: false, username: "admin", password: "pass",
    });
    mockGetRadiusConfig.mockResolvedValueOnce({
      server: "radius.example.test", secret: "shared-secret", authPort: 1812, acctPort: 1813,
    });
    mockUpsertRos.mockResolvedValueOnce(null);
    mockRosReq.mockResolvedValueOnce(null);

    const res = await request(buildApp()).post("/routers/7/ros/radius/admin-login");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockUpsertRos).toHaveBeenCalledWith(
      "192.0.2.7", false, "admin", "pass", "/radius",
      { address: "radius.example.test", service: "login" },
      expect.objectContaining({ secret: "shared-secret" }),
    );
    expect(mockRosReq).toHaveBeenCalledWith(
      "192.0.2.7", false, "admin", "pass", "PATCH", "/user/aaa", { "use-radius": "yes" },
    );
  });
});

describe("POST /radius/staff-login/sync", () => {
  it("rejects missing passwords without authenticating the staff user", async () => {
    const res = await request(buildApp()).post("/radius/staff-login/sync").send({});

    expect(res.status).toBe(400);
    expect(mockSignInEmail).not.toHaveBeenCalled();
  });

  it("reconfirms the password before syncing the current staff account", async () => {
    mockSignInEmail.mockResolvedValueOnce({ user: { id: "u1" } });

    const res = await request(buildApp())
      .post("/radius/staff-login/sync")
      .send({ password: "correct-horse" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(mockSyncStaffUserRadius).toHaveBeenCalledWith("admin@test.com", "correct-horse");
  });

  it("does not sync credentials when password reconfirmation fails", async () => {
    mockSignInEmail.mockResolvedValueOnce(null);

    const res = await request(buildApp())
      .post("/radius/staff-login/sync")
      .send({ password: "wrong" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Incorrect password");
    expect(mockSyncStaffUserRadius).not.toHaveBeenCalled();
  });
});
