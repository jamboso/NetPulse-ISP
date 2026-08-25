import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";

const mockExec = vi.hoisted(() => vi.fn());
const mockRunCommand = vi.hoisted(() => vi.fn());
const mockCaptureHostKey = vi.hoisted(() => vi.fn());
const mockAudit = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("@workspace/db", () => {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "from", "where", "update", "set"]) chain[method] = () => chain;
  chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(mockExec()).then(resolve, reject);
  return { db: chain, routersTable: { id: {}, companyId: {}, sshHostKey: {} } };
});
vi.mock("../middlewares/companyScope.js", () => ({
  resolveCompanyScope: (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock("../lib/routerSsh.js", () => ({
  runRouterSshCommand: mockRunCommand,
  captureRouterSshHostKey: mockCaptureHostKey,
}));
vi.mock("../lib/audit.js", () => ({ writeAuditLog: mockAudit }));

const { default: consoleRouter } = await import("../routes/router-console.js");

const connectedRouter = {
  id: 17,
  companyId: 12,
  name: "MAJE_TEMP",
  routerType: "routeros",
  ipAddress: "198.51.100.10",
  vpnIp: "10.8.0.17",
  vpnConnected: true,
  sshPort: null,
  username: "netpulse",
  password: "router-secret",
  sshHostKey: "SHA256:verifiedRouterKey",
};

function buildApp(role = "admin") {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).companyId = 12;
    (req as any).user = { id: "staff-1", email: "admin@example.test", role };
    (req as any).log = { warn: vi.fn() };
    next();
  });
  app.use(consoleRouter);
  return app;
}

describe("router SSH console", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAudit.mockResolvedValue(undefined);
  });

  it("denies non-admin roles before selecting a router", async () => {
    const response = await request(buildApp("support"))
      .post("/routers/17/console/command")
      .send({ command: "/system resource print" });

    expect(response.status).toBe(403);
    expect(mockExec).not.toHaveBeenCalled();
  });

  it("refuses RouterOS console access until its private VPN is connected", async () => {
    mockExec.mockResolvedValueOnce([{ ...connectedRouter, vpnConnected: false }]);

    const response = await request(buildApp())
      .post("/routers/17/console/command")
      .send({ command: "/system resource print" });

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/private NetPulse VPN tunnel/i);
    expect(mockRunCommand).not.toHaveBeenCalled();
  });

  it("rejects non-RouterOS routers so the console can never target a public address", async () => {
    mockExec.mockResolvedValueOnce([{
      ...connectedRouter,
      routerType: "juniper",
      vpnConnected: false,
      vpnIp: null,
      ipAddress: "198.51.100.17",
    }]);

    const response = await request(buildApp())
      .post("/routers/17/console/host-key")
      .send();

    expect(response.status).toBe(422);
    expect(response.body.error).toMatch(/only for RouterOS/i);
    expect(mockCaptureHostKey).not.toHaveBeenCalled();
    expect(mockRunCommand).not.toHaveBeenCalled();
  });

  it("uses the registered VPN address and default SSH port, never the public address", async () => {
    mockExec.mockResolvedValueOnce([connectedRouter]);
    mockRunCommand.mockImplementation(async ({ onOutput }: { onOutput: (value: unknown) => void }) => {
      onOutput({ stream: "stdout", text: "uptime: 1d" });
      return { exitCode: 0 };
    });

    const response = await request(buildApp())
      .post("/routers/17/console/command")
      .send({ command: "/system resource print" });

    expect(response.status).toBe(200);
    expect(response.text).toContain("uptime: 1d");
    expect(mockRunCommand).toHaveBeenCalledWith(expect.objectContaining({
      host: "10.8.0.17",
      port: 2222,
      hostKeyFingerprint: "SHA256:verifiedRouterKey",
      command: "/system resource print",
    }));
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "router",
      entityId: 17,
      diff: { operation: "ssh_console_command", port: 2222 },
    }));
    expect(JSON.stringify(mockAudit.mock.calls)).not.toContain("/system resource print");
    expect(JSON.stringify(mockAudit.mock.calls)).not.toContain("uptime: 1d");
  });

  it("blocks commands until an administrator verifies the router SSH host key", async () => {
    mockExec.mockResolvedValueOnce([{ ...connectedRouter, sshHostKey: null }]);

    const response = await request(buildApp())
      .post("/routers/17/console/command")
      .send({ command: "/system resource print" });

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/trust.*SSH host key/i);
    expect(mockRunCommand).not.toHaveBeenCalled();
  });

  it("reads a fingerprint without attempting command authentication and rejects a changed key during confirmation", async () => {
    mockExec.mockResolvedValueOnce([{ ...connectedRouter, sshHostKey: null }]);
    mockCaptureHostKey.mockResolvedValueOnce("SHA256:observedKey");

    const readResponse = await request(buildApp()).post("/routers/17/console/host-key");
    expect(readResponse.status).toBe(200);
    expect(readResponse.body).toEqual({ fingerprint: "SHA256:observedKey" });
    expect(mockRunCommand).not.toHaveBeenCalled();

    mockExec.mockResolvedValueOnce([{ ...connectedRouter, sshHostKey: null }]);
    mockCaptureHostKey.mockResolvedValueOnce("SHA256:changedKey");
    const confirmResponse = await request(buildApp())
      .post("/routers/17/console/host-key/confirm")
      .send({ fingerprint: "SHA256:observedKey" });
    expect(confirmResponse.status).toBe(409);
    expect(confirmResponse.body.error).toMatch(/key changed/i);
  });
});