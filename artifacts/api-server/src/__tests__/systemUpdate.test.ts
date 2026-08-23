import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express, { type NextFunction, type Request } from "express";
import request from "supertest";

const mockExecFileSync = vi.hoisted(() => vi.fn());
const mockSpawn = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());

vi.mock("child_process", () => ({
  execFileSync: mockExecFileSync,
  spawn: mockSpawn,
}));
vi.mock("fs", () => ({
  readFileSync: mockReadFileSync,
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

const ownerUser: MockUser = {
  id: "owner-1", email: "owner@test.com", name: "Owner", role: "owner",
  active: true, emailVerified: false, createdAt: new Date(), updatedAt: new Date(),
};
const adminUser: MockUser = { ...ownerUser, id: "admin-1", role: "admin" };

function buildApp(user: MockUser = ownerUser) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res, next: NextFunction) => {
    (req as Request & { user: MockUser }).user = user;
    next();
  });
  app.use(systemUpdateRouter);
  return app;
}

function mockGit(localCommit = "localcommit1111111111111111111111111111111", remoteCommit = localCommit) {
  mockExecFileSync.mockImplementation((_command: string, args: string[]) => {
    const joined = args.join(" ");
    if (joined === "rev-parse HEAD") return localCommit;
    if (joined === "branch --show-current") return "main";
    if (joined === "config --get branch.main.remote") return "origin";
    if (joined === "remote get-url origin") return "https://github.example/netpulse.git";
    if (joined.startsWith("fetch --quiet origin")) return "";
    if (joined === "rev-parse origin/main") return remoteCommit;
    if (joined === "log -1 --format=%s") return "Safe updater";
    if (joined === "log -1 --format=%ai") return "2026-08-23 10:00:00 +0000";
    throw new Error(`Unexpected git command: ${joined}`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockReadFileSync.mockImplementation(() => {
    throw new Error("status file does not exist");
  });
  process.env.NODE_ENV = "production";
  delete process.env.NETPULSE_UPDATE_REMOTE;
  delete process.env.NETPULSE_UPDATE_BRANCH;
  mockSpawn.mockImplementation(() => {
    const child = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn((event: string, callback: (code: number | null) => void) => {
        if (event === "close") setImmediate(() => callback(0));
      }),
      kill: vi.fn(),
      unref: vi.fn(),
    };
    return child;
  });
});

afterEach(() => {
  delete process.env.NODE_ENV;
  delete process.env.NETPULSE_UPDATE_REMOTE;
  delete process.env.NETPULSE_UPDATE_BRANCH;
});

describe("GET /system/version", () => {
  it("reports the fetched GitHub release without exposing the server path", async () => {
    const local = "localcommit1111111111111111111111111111111";
    const remote = "remotecommit2222222222222222222222222222222";
    mockGit(local, remote);

    const response = await request(buildApp()).get("/system/version");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      commit: "localco",
      remoteCommit: "remotec",
      remoteCommitFull: remote,
      branch: "main",
      remote: "origin",
      updateAvailable: true,
      retryAvailable: false,
      isProduction: true,
    });
    expect(response.body.deployment).toBeNull();
    expect(response.body).not.toHaveProperty("appDir");
  });

  it("denies production release metadata to tenant admins", async () => {
    mockGit();
    const response = await request(buildApp(adminUser)).get("/system/version");
    expect(response.status).toBe(403);
  });
});

describe("POST /system/update", () => {
  it("denies tenant admins", async () => {
    const response = await request(buildApp(adminUser))
      .post("/system/update")
      .send({ targetCommit: "remote" });
    expect(response.status).toBe(403);
  });

  it("requires the checked release commit before starting an update", async () => {
    mockGit("localcommit1111111111111111111111111111111", "remotecommit2222222222222222222222222222222");

    const response = await request(buildApp())
      .post("/system/update")
      .send({ targetCommit: "different-release" });

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/check for updates again/i);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("allows an owner to retry a failed deployment of the current release", async () => {
    const commit = "currentcommit1111111111111111111111111111111";
    mockGit(commit, commit);
    mockReadFileSync.mockReturnValue(JSON.stringify({
      state: "failed",
      phase: "verifying health",
      targetCommit: commit,
      pid: 999999,
    }));

    const response = await request(buildApp())
      .post("/system/update")
      .send({ targetCommit: commit });

    expect(response.status).toBe(200);
    expect(mockSpawn).toHaveBeenCalledOnce();
  });

  it("starts the updater with the owner-confirmed release and remote", async () => {
    const remote = "remotecommit2222222222222222222222222222222";
    mockGit("localcommit1111111111111111111111111111111", remote);

    const response = await request(buildApp())
      .post("/system/update")
      .send({ targetCommit: remote });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/text\/event-stream/);
    expect(mockSpawn).toHaveBeenCalledWith(
      "bash",
      ["/opt/netpulse/deploy/update.sh"],
      expect.objectContaining({
        env: expect.objectContaining({
          NETPULSE_EXPECTED_COMMIT: remote,
          NETPULSE_UPDATE_REMOTE: "origin",
          NETPULSE_UPDATE_BRANCH: "main",
        }),
      }),
    );
  });
});