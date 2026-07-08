import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

const mockExecSync = vi.hoisted(() => vi.fn());

vi.mock("child_process", () => ({
  execSync: mockExecSync,
  spawn: vi.fn(() => {
    const child = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn((event: string, cb: (code: number | null) => void) => {
        if (event === "error") {
          cb(Object.assign(new Error("ENOENT: no such file"), { message: "ENOENT: no such file" }));
        }
      }),
      kill: vi.fn(),
    };
    return child;
  }),
}));

const { default: systemUpdateRouter } = await import("../routes/system-update.js");

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
  app.use(systemUpdateRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// GET /system/version
// ---------------------------------------------------------------------------

describe("GET /system/version", () => {
  it("returns version info with all expected fields", async () => {
    mockExecSync
      .mockReturnValueOnce("abc1234def5678901234567890123456789012345")
      .mockReturnValueOnce("main")
      .mockReturnValueOnce("feat: add dashboard route")
      .mockReturnValueOnce("2026-05-23 10:00:00 +0000")
      .mockReturnValueOnce("abc1234def5678901234567890123456789012345");

    const res = await request(buildApp()).get("/system/version");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("version", "1.0.0");
    expect(res.body).toHaveProperty("commit");
    expect(res.body).toHaveProperty("commitFull");
    expect(res.body).toHaveProperty("branch");
    expect(res.body).toHaveProperty("commitMessage");
    expect(res.body).toHaveProperty("updateAvailable");
    expect(res.body).toHaveProperty("isProduction");
  });

  it("returns unknown when git commands fail", async () => {
    mockExecSync.mockImplementation(() => { throw new Error("git not found"); });

    const res = await request(buildApp()).get("/system/version");

    expect(res.status).toBe(200);
    expect(res.body.commit).toBe("unknown");
  });

  it("detects update available when remote and local commits differ", async () => {
    mockExecSync
      .mockReturnValueOnce("localcommit1111111111111111111111111111111")
      .mockReturnValueOnce("main")
      .mockReturnValueOnce("some commit message")
      .mockReturnValueOnce("2026-01-01 00:00:00 +0000")
      .mockReturnValueOnce("remotecommit2222222222222222222222222222222");

    const res = await request(buildApp()).get("/system/version");

    expect(res.status).toBe(200);
    expect(res.body.updateAvailable).toBe(true);
  });

  it("detects no update when remote equals local commit", async () => {
    const commit = "samecommit11111111111111111111111111111111";
    mockExecSync
      .mockReturnValueOnce(commit)
      .mockReturnValueOnce("main")
      .mockReturnValueOnce("no changes")
      .mockReturnValueOnce("2026-01-01 00:00:00 +0000")
      .mockReturnValueOnce(commit);

    const res = await request(buildApp()).get("/system/version");

    expect(res.status).toBe(200);
    expect(res.body.updateAvailable).toBe(false);
  });

  it("returns null remoteCommit when remote is empty", async () => {
    mockExecSync
      .mockReturnValueOnce("localcommit1111111111111111111111111111111")
      .mockReturnValueOnce("main")
      .mockReturnValueOnce("some commit")
      .mockReturnValueOnce("2026-01-01 00:00:00 +0000")
      .mockReturnValueOnce("");

    const res = await request(buildApp()).get("/system/version");

    expect(res.status).toBe(200);
    expect(res.body.remoteCommit).toBeNull();
    expect(res.body.updateAvailable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// POST /system/update
// ---------------------------------------------------------------------------

describe("POST /system/update", () => {
  it("returns 403 for non-admin role", async () => {
    const res = await request(buildApp(billingUser)).post("/system/update");

    expect(res.status).toBe(403);
  });

  it("responds with event-stream content type for admin", async () => {
    const res = await request(buildApp()).post("/system/update");

    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
  });
});
