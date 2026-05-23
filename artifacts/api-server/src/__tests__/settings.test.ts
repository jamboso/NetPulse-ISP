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
    "delete",
    "from",
    "values",
    "set",
    "where",
    "orderBy",
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
    settingsTable: {
      key: {},
      value: {},
      updatedAt: {},
    },
    eq: vi.fn(),
  };
});

const { default: settingsRouter } = await import("../routes/settings.js");

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
  app.use(settingsRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// GET /settings
// ---------------------------------------------------------------------------

describe("GET /settings", () => {
  it("returns all settings keys (admin)", async () => {
    mockExec.mockResolvedValueOnce([
      { key: "companyName", value: "ACME ISP" },
      { key: "currency", value: "KES" },
    ]);

    const res = await request(buildApp()).get("/settings");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("companyName", "ACME ISP");
    expect(res.body).toHaveProperty("currency", "KES");
  });

  it("returns null for settings keys not in the DB", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp()).get("/settings");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("companyName", null);
    expect(res.body).toHaveProperty("timezone", null);
  });

  it("returns 403 for non-admin role", async () => {
    const res = await request(buildApp(billingUser)).get("/settings");

    expect(res.status).toBe(403);
  });

  it("returns an object (not an array)", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp()).get("/settings");

    expect(res.status).toBe(200);
    expect(typeof res.body).toBe("object");
    expect(Array.isArray(res.body)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PATCH /settings
// ---------------------------------------------------------------------------

describe("PATCH /settings", () => {
  it("updates an existing setting and returns all settings (admin)", async () => {
    mockExec
      .mockResolvedValueOnce([{ key: "companyName", value: "Old Name" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ key: "companyName", value: "New ISP Name" }]);

    const res = await request(buildApp())
      .patch("/settings")
      .send({ companyName: "New ISP Name" });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("companyName", "New ISP Name");
  });

  it("inserts a setting that does not yet exist in the DB", async () => {
    mockExec
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ key: "timezone", value: "Africa/Nairobi" }]);

    const res = await request(buildApp())
      .patch("/settings")
      .send({ timezone: "Africa/Nairobi" });

    expect(res.status).toBe(200);
  });

  it("ignores unknown keys not in the SETTINGS_KEYS list", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp())
      .patch("/settings")
      .send({ unknownKey: "some value" });

    expect(res.status).toBe(200);
  });

  it("returns 403 for non-admin role", async () => {
    const res = await request(buildApp(billingUser))
      .patch("/settings")
      .send({ companyName: "Hacker ISP" });

    expect(res.status).toBe(403);
  });

  it("handles an empty patch body without error", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp())
      .patch("/settings")
      .send({});

    expect(res.status).toBe(200);
  });
});
