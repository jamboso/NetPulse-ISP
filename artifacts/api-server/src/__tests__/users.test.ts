import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

const mockExec = vi.hoisted(() => vi.fn());
const mockSignUp = vi.hoisted(() => vi.fn());
const mockGetSettings = vi.hoisted(() => vi.fn());
const mockSendMail = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const mockCreateTransport = vi.hoisted(() => vi.fn().mockReturnValue({ sendMail: mockSendMail }));

vi.mock("nodemailer", () => ({
  createTransport: mockCreateTransport,
  default: { createTransport: mockCreateTransport },
}));

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
    "limit",
    "offset",
    "leftJoin",
    "groupBy",
    "as",
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
    usersTable: {
      id: {},
      email: {},
      name: {},
      role: {},
      active: {},
      createdAt: {},
      updatedAt: {},
    },
    sessionsTable: {
      userId: {},
      createdAt: {},
    },
    eq: vi.fn(),
    ilike: vi.fn(),
    or: vi.fn(),
    max: vi.fn(() => ({})),
  };
});

vi.mock("../lib/audit.js", () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock("../lib/auth.js", () => ({
  auth: {
    api: {
      signUpEmail: mockSignUp,
    },
  },
}));

vi.mock("../lib/sms.js", () => ({
  getSettings: mockGetSettings,
  sendSms: vi.fn(),
  normalisePhone: vi.fn((p: string) => p),
}));

vi.mock("../middlewares/companyScope", () => ({
  resolveCompanyScope: (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.companyId = 1;
    next();
  },
}));

const mockSendStaffWelcomeEmail = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ success: false, message: "SMTP not configured" }),
);

vi.mock("../lib/mailer.js", () => ({
  sendStaffWelcomeEmail: mockSendStaffWelcomeEmail,
  buildWelcomeEmailHtml: vi.fn().mockReturnValue("<html/>"),
  buildWelcomeEmailSubject: vi.fn().mockReturnValue("Welcome to Acme ISP"),
  buildWelcomeEmailText: vi.fn().mockReturnValue("text"),
}));

const { default: usersRouter } = await import("../routes/users.js");

type MockUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
  emailVerified: boolean;
  image?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const adminUser: MockUser = {
    id: "u1",
    email: "admin@test.com",
    name: "Admin",
    role: "admin",
    active: true,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

function buildApp(user: MockUser | null = adminUser) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (user) {
      (req as Request & { user: MockUser }).user = user;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    next();
  });
  app.use(usersRouter);
  return app;
}

const sampleUser = {
  id: "u99",
  email: "newstaff@example.com",
  name: "New Staff",
  role: "support",
  active: true,
  createdAt: new Date().toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /users", () => {
  it("returns a list of users (admin)", async () => {
    mockExec.mockResolvedValueOnce([sampleUser]);

    const res = await request(buildApp()).get("/users");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("data");
  });

  it("returns 403 for non-admin role", async () => {
    const res = await request(
      buildApp({
        id: "u2",
        email: "support@test.com",
        name: "Support",
        role: "support",
        active: true,
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ).get("/users");

    expect(res.status).toBe(403);
  });
});

describe("welcome email preview", () => {
  it("returns the generated HTML preview and reports configured SMTP for admins", async () => {
    mockGetSettings.mockResolvedValue({
      smtpHost: "smtp.example.com",
      smtpUser: "mailer@example.com",
      smtpPass: "secret",
      companyName: "Acme ISP",
    });

    const res = await request(buildApp()).get("/users/welcome-email-preview");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ html: "<html/>", smtpConfigured: true });
    expect(res.body.html).toMatch(/^<html/);
  });

  it("passes saved template values into the HTML preview", async () => {
    mockGetSettings.mockResolvedValue({
      companyName: "Acme ISP",
      emailGreeting: "Hello {name}",
      emailFooter: "The {company} Team",
    });

    const res = await request(buildApp()).get("/users/welcome-email-preview");

    expect(res.status).toBe(200);
    expect(res.body.html).toBe("<html/>");
    expect(vi.mocked((await import("../lib/mailer.js")).buildWelcomeEmailHtml)).toHaveBeenCalledWith(
      expect.objectContaining({
        emailGreeting: "Hello {name}",
        emailFooter: "The {company} Team",
      }),
    );
  });

  it("reports SMTP as unconfigured when any required setting is missing", async () => {
    mockGetSettings.mockResolvedValue({
      smtpHost: "smtp.example.com",
      smtpUser: "mailer@example.com",
    });

    const res = await request(buildApp()).get("/users/welcome-email-preview");

    expect(res.status).toBe(200);
    expect(res.body.smtpConfigured).toBe(false);
    expect(res.body.html).toMatch(/^<html/);
  });

  it("rejects unauthenticated preview requests", async () => {
    const res = await request(buildApp(null)).get("/users/welcome-email-preview");

    expect(res.status).toBe(401);
  });

  it("rejects preview requests from non-admin staff", async () => {
    const res = await request(buildApp({ ...adminUser, role: "support" }))
      .get("/users/welcome-email-preview");

    expect(res.status).toBe(403);
  });
});

describe("POST /users/welcome-email-preview/send", () => {
  it("returns 400 without attempting delivery when SMTP is not configured", async () => {
    mockGetSettings.mockResolvedValue({
      smtpHost: "smtp.example.com",
      smtpUser: "mailer@example.com",
    });

    const res = await request(buildApp()).post("/users/welcome-email-preview/send");

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/SMTP is not configured/i);
    expect(mockCreateTransport).not.toHaveBeenCalled();
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("sends a test welcome email to the logged-in admin", async () => {
    mockGetSettings.mockResolvedValue({
      smtpHost: "smtp.example.com",
      smtpUser: "mailer@example.com",
      smtpPass: "secret",
      smtpFrom: "noreply@example.com",
      companyName: "Acme ISP",
    });

    const res = await request(buildApp()).post("/users/welcome-email-preview/send");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      message: "Test email sent to admin@test.com",
    });
    expect(mockSendMail).toHaveBeenCalledOnce();
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "admin@test.com",
        subject: expect.stringMatching(/^\[Test\]/),
      }),
    );
  });

  it("rejects unauthenticated test-send requests", async () => {
    const res = await request(buildApp(null)).post("/users/welcome-email-preview/send");

    expect(res.status).toBe(401);
  });

  it("rejects test-send requests from non-admin staff", async () => {
    const res = await request(buildApp({ ...adminUser, role: "billing" }))
      .post("/users/welcome-email-preview/send");

    expect(res.status).toBe(403);
  });
});

describe("POST /users", () => {
  it("creates a user and returns 201 (admin)", async () => {
    mockExec
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([sampleUser]);
    mockSignUp.mockResolvedValueOnce({ user: { id: "u99" } });

    const res = await request(buildApp())
      .post("/users")
      .send({ name: "New Staff", email: "newstaff@example.com", password: "securepass", role: "support" });

    expect(res.status).toBe(201);
  });

  it("calls sendStaffWelcomeEmail with the correct name, email, role, and appUrl", async () => {
    mockExec
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([sampleUser]);
    mockSignUp.mockResolvedValueOnce({ user: { id: "u99" } });

    await request(buildApp())
      .post("/users")
      .send({ name: "New Staff", email: "newstaff@example.com", password: "securepass", role: "support" });

    expect(mockSendStaffWelcomeEmail).toHaveBeenCalledOnce();
    expect(mockSendStaffWelcomeEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "New Staff",
        email: "newstaff@example.com",
        password: "securepass",
        role: "support",
        appUrl: expect.any(String),
      }),
    );
  });

  it("returns 201 and does not throw when SMTP is not configured (sendStaffWelcomeEmail returns success:false)", async () => {
    mockSendStaffWelcomeEmail.mockResolvedValueOnce({ success: false, message: "SMTP not configured — email skipped" });
    mockExec
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([sampleUser]);
    mockSignUp.mockResolvedValueOnce({ user: { id: "u99" } });

    const res = await request(buildApp())
      .post("/users")
      .send({ name: "New Staff", email: "newstaff@example.com", password: "securepass", role: "support" });

    expect(res.status).toBe(201);
    expect(mockSendStaffWelcomeEmail).toHaveBeenCalledOnce();
  });

  it("returns 403 for non-admin role", async () => {
    const res = await request(
      buildApp({
        id: "u2",
        email: "billing@test.com",
        name: "Billing",
        role: "billing",
        active: true,
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    )
      .post("/users")
      .send({ name: "New Staff", email: "newstaff@example.com", password: "securepass", role: "support" });

    expect(res.status).toBe(403);
  });
});

describe("POST /users — validation", () => {
  it("returns 400 when name is missing", async () => {
    const res = await request(buildApp())
      .post("/users")
      .send({ email: "staff@example.com", password: "securepass", role: "support" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when email is missing", async () => {
    const res = await request(buildApp())
      .post("/users")
      .send({ name: "Staff", password: "securepass", role: "support" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when email format is invalid", async () => {
    const res = await request(buildApp())
      .post("/users")
      .send({ name: "Staff", email: "not-an-email", password: "securepass", role: "support" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when password is missing", async () => {
    const res = await request(buildApp())
      .post("/users")
      .send({ name: "Staff", email: "staff@example.com", role: "support" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when password is shorter than 8 characters", async () => {
    const res = await request(buildApp())
      .post("/users")
      .send({ name: "Staff", email: "staff@example.com", password: "short", role: "support" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when role is missing", async () => {
    const res = await request(buildApp())
      .post("/users")
      .send({ name: "Staff", email: "staff@example.com", password: "securepass" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when role is an invalid enum value", async () => {
    const res = await request(buildApp())
      .post("/users")
      .send({ name: "Staff", email: "staff@example.com", password: "securepass", role: "superadmin" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when notifyMethod is an invalid enum value", async () => {
    const res = await request(buildApp())
      .post("/users")
      .send({ name: "Staff", email: "staff@example.com", password: "securepass", role: "support", notifyMethod: "telegram" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });
});

describe("PATCH /users/:id", () => {
  it("updates a user and returns 200 (admin)", async () => {
    const updated = { ...sampleUser, role: "billing" };
    mockExec
      .mockResolvedValueOnce([sampleUser])
      .mockResolvedValueOnce([updated]);

    const res = await request(buildApp())
      .patch("/users/u99")
      .send({ role: "billing" });

    expect(res.status).toBe(200);
    expect(res.body.role).toBe("billing");
  });

  it("returns 404 when user does not exist", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp())
      .patch("/users/nonexistent")
      .send({ role: "billing" });

    expect(res.status).toBe(404);
  });

  it("returns 400 when trying to modify own account", async () => {
    const res = await request(buildApp())
      .patch("/users/u1")
      .send({ role: "billing" });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 403 for non-admin role", async () => {
    const res = await request(
      buildApp({
        id: "u2",
        email: "support@test.com",
        name: "Support",
        role: "support",
        active: true,
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    )
      .patch("/users/u99")
      .send({ role: "billing" });

    expect(res.status).toBe(403);
  });
});

describe("GET /users — lastActiveAt field", () => {
  it("returns lastActiveAt when the user has a recent session", async () => {
    const recentDate = new Date().toISOString();
    const userWithSession = { ...sampleUser, lastActiveAt: recentDate };
    mockExec.mockResolvedValueOnce([userWithSession]);

    const res = await request(buildApp()).get("/users");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toHaveProperty("lastActiveAt", recentDate);
  });

  it("returns lastActiveAt as null when the user has no sessions", async () => {
    const userNoSession = { ...sampleUser, lastActiveAt: null };
    mockExec.mockResolvedValueOnce([userNoSession]);

    const res = await request(buildApp()).get("/users");

    expect(res.status).toBe(200);
    expect(res.body.data[0].lastActiveAt).toBeNull();
  });

  it("returns lastActiveAt for multiple users with mixed session data", async () => {
    const recentDate = new Date().toISOString();
    const users = [
      { ...sampleUser, id: "u1", lastActiveAt: recentDate },
      { ...sampleUser, id: "u2", email: "other@example.com", lastActiveAt: null },
    ];
    mockExec.mockResolvedValueOnce(users);

    const res = await request(buildApp()).get("/users");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].lastActiveAt).toBe(recentDate);
    expect(res.body.data[1].lastActiveAt).toBeNull();
  });

  it("returns lastActiveAt for old sessions (reflects the stored timestamp)", async () => {
    const oldDate = new Date(Date.now() - 40 * 86_400_000).toISOString();
    const userOldSession = { ...sampleUser, lastActiveAt: oldDate };
    mockExec.mockResolvedValueOnce([userOldSession]);

    const res = await request(buildApp()).get("/users");

    expect(res.status).toBe(200);
    expect(res.body.data[0]).toHaveProperty("lastActiveAt", oldDate);
  });
});

describe("PATCH /users/:id — validation", () => {
  it("returns 400 when role is an invalid enum value", async () => {
    const res = await request(buildApp())
      .patch("/users/u99")
      .send({ role: "superadmin" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when active is not a boolean", async () => {
    const res = await request(buildApp())
      .patch("/users/u99")
      .send({ active: "yes" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });
});
