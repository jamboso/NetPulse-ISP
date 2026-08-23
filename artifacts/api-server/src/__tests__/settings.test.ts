import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

const mockExec = vi.hoisted(() => vi.fn());
const mockValues = vi.hoisted(() => vi.fn());

vi.mock("@workspace/db", () => {
  const chain: Record<string, unknown> = {};
  const chainMethods = [
    "select",
    "insert",
    "update",
    "delete",
    "from",
    "set",
    "where",
    "orderBy",
    "$dynamic",
  ];
  for (const m of chainMethods) {
    chain[m] = () => chain;
  }
  chain["values"] = (value: unknown) => {
    mockValues(value);
    return chain;
  };
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

const ownerUser: MockUser = {
  id: "u1", email: "owner@test.com", name: "Owner", role: "owner",
  active: true, emailVerified: false, createdAt: new Date(), updatedAt: new Date(),
};

const restrictedRoles = ["admin", "billing", "support", "technician"] as const;

function buildUser(role: (typeof restrictedRoles)[number]): MockUser {
  return {
    id: `${role}-user`,
    email: `${role}@test.com`,
    name: role,
    role,
    active: true,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function buildApp(user: MockUser = ownerUser) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { user: MockUser }).user = user;
    next();
  });
  app.use("/api", settingsRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env["SESSION_SECRET"] = "settings-route-test-secret";
});

// ---------------------------------------------------------------------------
// GET /api/settings
// ---------------------------------------------------------------------------

describe("GET /api/settings", () => {
  it("returns all settings keys for the owner", async () => {
    mockExec.mockResolvedValueOnce([
      { key: "companyName", value: "ACME ISP" },
      { key: "currency", value: "KES" },
    ]);

    const res = await request(buildApp()).get("/api/settings");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("companyName", "ACME ISP");
    expect(res.body).toHaveProperty("currency", "KES");
  });

  it("returns null for settings keys not in the DB", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp()).get("/api/settings");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("companyName", null);
    expect(res.body).toHaveProperty("timezone", null);
  });

  it("redacts saved notification secrets and reports their configured state", async () => {
    mockExec.mockResolvedValueOnce([
      { key: "alertSlackWebhook", value: "https://hooks.slack.com/services/T000/B000/secret" },
      { key: "smtpPass", value: "smtp-app-password" },
      { key: "alertEmail", value: "ops@example.com" },
    ]);

    const res = await request(buildApp()).get("/api/settings");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      alertSlackWebhook: null,
      alertSlackWebhookConfigured: true,
      smtpPass: null,
      smtpPassConfigured: true,
      alertEmail: "ops@example.com",
    });
  });

  it.each(restrictedRoles)("returns 403 for the %s role", async (role) => {
    const res = await request(buildApp(buildUser(role))).get("/api/settings");
    expect(res.status).toBe(403);
  });

  it("returns an object (not an array)", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp()).get("/api/settings");

    expect(res.status).toBe(200);
    expect(typeof res.body).toBe("object");
    expect(Array.isArray(res.body)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/settings
// ---------------------------------------------------------------------------

describe("PATCH /api/settings", () => {
  it("updates an existing setting and returns all settings for the owner", async () => {
    mockExec
      .mockResolvedValueOnce([{ key: "companyName", value: "Old Name" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ key: "companyName", value: "New ISP Name" }]);

    const res = await request(buildApp())
      .patch("/api/settings")
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
      .patch("/api/settings")
      .send({ timezone: "Africa/Nairobi" });

    expect(res.status).toBe(200);
  });

  it("encrypts notification channel values before storing them", async () => {
    mockExec
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const res = await request(buildApp())
      .patch("/api/settings")
      .send({ alertSlackWebhook: "https://hooks.slack.com/services/T000/B000/secret" });

    expect(res.status).toBe(200);
    expect(mockValues).toHaveBeenCalledWith(expect.objectContaining({
      key: "alertSlackWebhook",
      value: expect.stringMatching(/^v1:[^:]+:[^:]+:[^:]+$/),
    }));
    expect(mockValues.mock.calls[0]![0].value).not.toContain("hooks.slack.com");
  });

  it("persists and retrieves both alert destinations", async () => {
    mockExec
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockImplementationOnce(() => Promise.resolve(
        mockValues.mock.calls.map(([setting]) => setting),
      ));

    const res = await request(buildApp())
      .patch("/api/settings")
      .send({
        alertSlackWebhook: "https://hooks.slack.com/services/T000/B000/secret",
        alertEmail: "ops@example.com",
      });

    expect(res.status).toBe(200);
    expect(mockValues).toHaveBeenCalledWith(expect.objectContaining({
      key: "alertSlackWebhook",
      value: expect.stringMatching(/^v1:[^:]+:[^:]+:[^:]+$/),
    }));
    expect(mockValues).toHaveBeenCalledWith(expect.objectContaining({
      key: "alertEmail",
      value: expect.stringMatching(/^v1:[^:]+:[^:]+:[^:]+$/),
    }));
    expect(res.body).toMatchObject({
      alertSlackWebhook: null,
      alertSlackWebhookConfigured: true,
      alertEmail: "ops@example.com",
    });
  });

  it("ignores unknown keys not in the SETTINGS_KEYS list", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp())
      .patch("/api/settings")
      .send({ unknownKey: "some value" });

    expect(res.status).toBe(200);
  });

  it.each(restrictedRoles)("returns 403 for the %s role", async (role) => {
    const res = await request(buildApp(buildUser(role)))
      .patch("/api/settings")
      .send({ companyName: "Hacker ISP" });

    expect(res.status).toBe(403);
  });

  it("handles an empty patch body without error", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp())
      .patch("/api/settings")
      .send({});

    expect(res.status).toBe(200);
  });
});
