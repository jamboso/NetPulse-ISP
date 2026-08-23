import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { EventEmitter } from "node:events";

const mockExecFileSync = vi.hoisted(() => vi.fn());
const mockSpawn = vi.hoisted(() => vi.fn());

vi.mock("child_process", () => ({
  execFileSync: mockExecFileSync,
  spawn: mockSpawn,
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
  id: "owner", email: "owner@test.com", name: "Owner", role: "owner",
  active: true, emailVerified: false, createdAt: new Date(), updatedAt: new Date(),
};
const adminUser: MockUser = { ...ownerUser, id: "admin", email: "admin@test.com", role: "admin" };
const billingUser: MockUser = { ...ownerUser, id: "billing", email: "billing@test.com", role: "billing" };

const localCommit = "a".repeat(40);
const candidateCommit = "b".repeat(40);

function buildApp(user: MockUser = ownerUser) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { user: MockUser }).user = user;
    next();
  });
  app.use(systemUpdateRouter);
  return app;
}

function mockTrackedRelease({ candidate = candidateCommit, local = localCommit } = {}) {
  mockExecFileSync.mockImplementation((_command: string, args: string[]) => {
    if (args[0] === "symbolic-ref") return "release\n";
    if (args[0] === "config" && args[2] === "branch.release.remote") return "github\n";
    if (args[0] === "config" && args[2] === "branch.release.merge") return "refs/heads/production\n";
    if (args[0] === "fetch") return "";
    if (args[0] === "rev-parse" && args[1] === "HEAD") return `${local}\n`;
    if (args[0] === "rev-parse" && args[1] === "FETCH_HEAD") return `${candidate}\n`;
    if (args[0] === "log" && args[2] === "--format=%s") return "Safe release\n";
    if (args[0] === "log" && args[2] === "--format=%ai") return "2026-08-23 12:00:00 +0000\n";
    throw new Error(`Unexpected git command ${args.join(" ")}`);
  });
}

function createChild(): EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  unref: ReturnType<typeof vi.fn>;
} {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    unref: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.unref = vi.fn();
  return child;
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.NETPULSE_DIR;
  delete process.env.NETPULSE_UPDATE_STATUS_FILE;
  mockTrackedRelease();
});

describe("GET /system/version", () => {
  it("allows only the platform owner to inspect release details", async () => {
    const denied = await request(buildApp(adminUser)).get("/system/version");
    expect(denied.status).toBe(403);
    expect(mockExecFileSync).not.toHaveBeenCalled();

    const allowed = await request(buildApp()).get("/system/version");
    expect(allowed.status).toBe(200);
    expect(allowed.body).toMatchObject({
      commit: localCommit.slice(0, 7),
      branch: "production",
      candidateCommit,
      remoteCommit: candidateCommit.slice(0, 7),
      updateAvailable: true,
      status: "update-available",
    });
  });

  it("fetches and compares the configured tracked branch without changing the checkout", async () => {
    const response = await request(buildApp()).get("/system/version");

    expect(response.status).toBe(200);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "git",
      ["fetch", "--quiet", "--no-tags", "github", "refs/heads/production"],
      expect.objectContaining({ cwd: "/opt/netpulse" }),
    );
    expect(mockExecFileSync.mock.calls.some(([, args]) => (args as string[])[0] === "checkout")).toBe(false);
  });

  it("reports no update when the tracked branch is already deployed", async () => {
    mockTrackedRelease({ candidate: localCommit });
    const response = await request(buildApp()).get("/system/version");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ updateAvailable: false, status: "up-to-date" });
  });

  it("clearly reports a failed preflight without starting deployment", async () => {
    mockExecFileSync.mockImplementation(() => { throw new Error("git fetch failed"); });
    const response = await request(buildApp()).get("/system/version");
    expect(response.status).toBe(503);
    expect(response.body.status).toBe("preflight-failed");
  });
});

describe("GET /system/update/status", () => {
  it("does not expose deployment state to non-owners", async () => {
    const response = await request(buildApp(billingUser)).get("/system/update/status");
    expect(response.status).toBe(403);
  });
});

describe("POST /system/update", () => {
  it("rejects non-owners before reading Git or starting an update", async () => {
    const response = await request(buildApp(adminUser))
      .post("/system/update")
      .send({ targetCommit: candidateCommit, confirmation: candidateCommit });
    expect(response.status).toBe(403);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("requires an exact full-commit confirmation", async () => {
    const missing = await request(buildApp()).post("/system/update").send({});
    expect(missing.status).toBe(400);

    const mismatch = await request(buildApp())
      .post("/system/update")
      .send({ targetCommit: candidateCommit, confirmation: localCommit });
    expect(mismatch.status).toBe(400);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("rejects a target that is no longer the configured branch candidate", async () => {
    const response = await request(buildApp())
      .post("/system/update")
      .send({ targetCommit: "c".repeat(40), confirmation: "c".repeat(40) });
    expect(response.status).toBe(409);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("rejects a no-change deployment path", async () => {
    mockTrackedRelease({ candidate: localCommit });
    const response = await request(buildApp())
      .post("/system/update")
      .send({ targetCommit: localCommit, confirmation: localCommit });
    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/No update/);
  });

  it("starts only the verified candidate and streams the final outcome", async () => {
    const child = createChild();
    mockSpawn.mockImplementation(() => {
      setImmediate(() => child.emit("close", 0));
      return child;
    });

    const response = await request(buildApp())
      .post("/system/update")
      .send({ targetCommit: candidateCommit.toUpperCase(), confirmation: candidateCommit.toUpperCase() });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/text\/event-stream/);
    expect(mockSpawn).toHaveBeenCalledWith(
      "sudo",
      ["-n", "/opt/netpulse/deploy/update.sh", candidateCommit],
      expect.objectContaining({ cwd: "/opt/netpulse", detached: true, stdio: "ignore" }),
    );
    expect(child.unref).toHaveBeenCalled();
    expect(response.text).toContain("event: phase");
    expect(response.text).toContain("event: done");
  });

  it("reports a failed script without claiming deployment succeeded", async () => {
    const child = createChild();
    mockSpawn.mockImplementation(() => {
      setImmediate(() => child.emit("close", 1));
      return child;
    });
    const response = await request(buildApp())
      .post("/system/update")
      .send({ targetCommit: candidateCommit, confirmation: candidateCommit });
    expect(response.status).toBe(200);
    expect(response.text).toContain("event: error");
    expect(response.text).not.toContain("Health check passed");
  });
});