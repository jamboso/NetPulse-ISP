import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

const mockExec = vi.hoisted(() => vi.fn());
const mockSignUp = vi.hoisted(() => vi.fn());

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
  getSettings: vi.fn(),
  sendSms: vi.fn(),
  normalisePhone: vi.fn((p: string) => p),
}));

vi.mock("../lib/mailer.js", () => ({
  sendStaffWelcomeEmail: vi.fn().mockResolvedValue({ success: false, message: "SMTP not configured" }),
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

function buildApp(
  user: MockUser = {
    id: "u1",
    email: "admin@test.com",
    name: "Admin",
    role: "admin",
    active: true,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { user: MockUser }).user = user;
    (req as Request & { log: Record<string, unknown> }).log = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
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
