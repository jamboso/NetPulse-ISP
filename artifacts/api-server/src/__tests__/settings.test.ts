import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

const mockExec = vi.hoisted(() => vi.fn());
const mockValues = vi.hoisted(() => vi.fn());
const mockSendAuditLogExport = vi.hoisted(() => vi.fn());

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

vi.mock("../lib/auditExportScheduler", () => ({
  AUDIT_EXPORT_ENTITY_TYPES: [
    "customer", "invoice", "payment", "subscription", "user", "equipment",
    "ip_pool", "company", "company_mpesa_config", "olt", "onu",
    "olt_service_profile", "olt_provisioning_job", "tr069_acs_config",
    "tr069_device", "tr069_command",
  ],
  AUDIT_EXPORT_WINDOW_DAYS: ["all", "7", "30", "90"],
  AuditExportConfigurationError: class AuditExportConfigurationError extends Error {},
  sendAuditLogExport: mockSendAuditLogExport,
}));

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
    expect(res.body).toHaveProperty("emailSubject", null);
    expect(res.body).toHaveProperty("emailGreeting", null);
    expect(res.body).toHaveProperty("emailFooter", null);
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
// POST /api/settings/export-csv-now
// ---------------------------------------------------------------------------

describe("POST /api/settings/export-csv-now", () => {
  it("sends an export immediately and returns its sent timestamp", async () => {
    mockSendAuditLogExport.mockResolvedValueOnce({
      lastSentAt: "2026-08-23T10:00:00.000Z",
    });

    const res = await request(buildApp(buildUser("admin"))).post("/api/settings/export-csv-now");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ lastSentAt: "2026-08-23T10:00:00.000Z" });
    expect(mockSendAuditLogExport).toHaveBeenCalledWith("manual");
  });

  it.each(["billing", "support", "technician"] as const)(
    "keeps manual exports restricted for the %s role",
    async (role) => {
      const res = await request(buildApp(buildUser(role))).post("/api/settings/export-csv-now");

      expect(res.status).toBe(403);
      expect(mockSendAuditLogExport).not.toHaveBeenCalled();
    },
  );
});

// ---------------------------------------------------------------------------
// GET/PATCH /api/settings/welcome-email-template
// ---------------------------------------------------------------------------

describe("welcome email template settings", () => {
  it("lets an admin read only the welcome email template values", async () => {
    mockExec.mockResolvedValueOnce([
      { key: "companyName", value: "ACME ISP" },
      { key: "emailSubject", value: "Welcome to {company}" },
      { key: "emailGreeting", value: "Hello {name}" },
      { key: "emailFooter", value: "The {company} Team" },
    ]);

    const res = await request(buildApp(buildUser("admin")))
      .get("/api/settings/welcome-email-template");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      emailSubject: "Welcome to {company}",
      emailGreeting: "Hello {name}",
      emailFooter: "The {company} Team",
    });
  });

  it("lets an admin save only the welcome email template values", async () => {
    mockExec
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { key: "emailSubject", value: "Welcome to {company}" },
        { key: "emailGreeting", value: "Hello {name}" },
        { key: "emailFooter", value: "The {company} Team" },
      ]);

    const res = await request(buildApp(buildUser("admin")))
      .patch("/api/settings/welcome-email-template")
      .send({
        emailSubject: "Welcome to {company}",
        emailGreeting: "Hello {name}",
        emailFooter: "The {company} Team",
      });

    expect(res.status).toBe(200);
    expect(mockValues).toHaveBeenCalledWith(expect.objectContaining({ key: "emailSubject" }));
    expect(mockValues).toHaveBeenCalledWith(expect.objectContaining({ key: "emailGreeting" }));
    expect(mockValues).toHaveBeenCalledWith(expect.objectContaining({ key: "emailFooter" }));
  });

  it.each(["billing", "support", "technician"] as const)(
    "keeps the template endpoint restricted for the %s role",
    async (role) => {
      const getResponse = await request(buildApp(buildUser(role)))
        .get("/api/settings/welcome-email-template");
      const patchResponse = await request(buildApp(buildUser(role)))
        .patch("/api/settings/welcome-email-template")
        .send({ emailSubject: "Not allowed" });

      expect(getResponse.status).toBe(403);
      expect(patchResponse.status).toBe(403);
    },
  );
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

  it("persists welcome email template settings", async () => {
    mockExec
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { key: "emailSubject", value: "Welcome to {company}" },
        { key: "emailGreeting", value: "Hello {name}" },
        { key: "emailFooter", value: "The {company} Team" },
      ]);

    const res = await request(buildApp())
      .patch("/api/settings")
      .send({
        emailSubject: "Welcome to {company}",
        emailGreeting: "Hello {name}",
        emailFooter: "The {company} Team",
      });

    expect(res.status).toBe(200);
    expect(mockValues).toHaveBeenCalledWith(expect.objectContaining({
      key: "emailSubject",
      value: "Welcome to {company}",
    }));
    expect(mockValues).toHaveBeenCalledWith(expect.objectContaining({
      key: "emailGreeting",
      value: "Hello {name}",
    }));
    expect(mockValues).toHaveBeenCalledWith(expect.objectContaining({
      key: "emailFooter",
      value: "The {company} Team",
    }));
    expect(res.body).toMatchObject({
      emailSubject: "Welcome to {company}",
      emailGreeting: "Hello {name}",
      emailFooter: "The {company} Team",
    });
  });

  it("accepts and persists all scheduled audit export settings and filters", async () => {
    mockExec
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { key: "exportScheduleEnabled", value: "1" },
        { key: "exportScheduleFrequency", value: "daily" },
        { key: "exportScheduleEmail", value: "compliance@example.com" },
        { key: "exportScheduleEntityType", value: "payment" },
        { key: "exportScheduleWindowDays", value: "30" },
      ]);

    const res = await request(buildApp())
      .patch("/api/settings")
      .send({
        exportScheduleEnabled: "1",
        exportScheduleFrequency: "daily",
        exportScheduleEmail: "compliance@example.com",
        exportScheduleEntityType: "payment",
        exportScheduleWindowDays: "30",
      });

    expect(res.status).toBe(200);
    expect(mockValues).toHaveBeenCalledWith(expect.objectContaining({
      key: "exportScheduleEnabled",
      value: "1",
    }));
    expect(mockValues).toHaveBeenCalledWith(expect.objectContaining({
      key: "exportScheduleFrequency",
      value: "daily",
    }));
    expect(mockValues).toHaveBeenCalledWith(expect.objectContaining({
      key: "exportScheduleEmail",
      value: "compliance@example.com",
    }));
    expect(mockValues).toHaveBeenCalledWith(expect.objectContaining({
      key: "exportScheduleEntityType",
      value: "payment",
    }));
    expect(mockValues).toHaveBeenCalledWith(expect.objectContaining({
      key: "exportScheduleWindowDays",
      value: "30",
    }));
    expect(res.body).toMatchObject({
      exportScheduleEnabled: "1",
      exportScheduleFrequency: "daily",
      exportScheduleEmail: "compliance@example.com",
      exportScheduleEntityType: "payment",
      exportScheduleWindowDays: "30",
    });
  });

  it("rejects invalid scheduled audit export filters", async () => {
    const res = await request(buildApp())
      .patch("/api/settings")
      .send({
        exportScheduleEntityType: "not-a-real-entity",
        exportScheduleWindowDays: "365",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/entity type/i);
    expect(mockValues).not.toHaveBeenCalled();
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
