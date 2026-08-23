import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";

const mockDbResult = vi.hoisted(() => vi.fn());
const mockReadFile = vi.hoisted(() => vi.fn());
const mockExecAsync = vi.hoisted(() => vi.fn());

vi.mock("@workspace/db", () => {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "from", "where", "orderBy", "insert", "values", "update", "set"]) {
    chain[method] = () => chain;
  }
  chain.returning = () => Promise.resolve(mockDbResult());
  chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(mockDbResult()).then(resolve, reject);

  return {
    db: chain,
    vpnConfigsTable: {
      id: {}, customerId: {}, routerId: {}, commonName: {}, issuedAt: {},
      revokedAt: {}, revokedBy: {}, ovpnConfig: {},
    },
  };
});
vi.mock("fs/promises", () => ({ readFile: mockReadFile }));
vi.mock("child_process", () => ({ exec: vi.fn() }));
vi.mock("util", () => ({ promisify: () => mockExecAsync }));

const { default: vpnRouter } = await import("../routes/vpn.js");

const admin = { email: "admin@example.test", role: "admin" };
const support = { email: "support@example.test", role: "support" };

function buildApp(user = admin) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).user = user;
    (req as any).log = {
      info: vi.fn(),
      error: vi.fn(),
    };
    next();
  });
  app.use(vpnRouter);
  return app;
}

function vpnConfig(overrides: Record<string, unknown> = {}) {
  return {
    id: 3,
    customerId: 7,
    routerId: null,
    commonName: "np-7-active",
    issuedAt: new Date("2026-01-02T03:04:05.000Z"),
    revokedAt: null,
    revokedBy: null,
    ovpnConfig: "client\nremote vpn.example.test",
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("VPN configuration routes", () => {
  it("lists customer configurations with current connection details", async () => {
    mockDbResult.mockResolvedValueOnce([
      vpnConfig(),
      vpnConfig({
        id: 4,
        commonName: "np-7-revoked",
        revokedAt: new Date("2026-02-03T04:05:06.000Z"),
        revokedBy: "admin@example.test",
      }),
    ]);
    mockReadFile.mockResolvedValueOnce(
      "OpenVPN CLIENT LIST\nCommon Name,Real Address,Bytes Received,Bytes Sent,Connected Since\n" +
      "np-7-active,198.51.100.12:1234,1,2,now\nROUTING TABLE\n",
    );

    const response = await request(buildApp()).get("/customers/7/vpn");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      vpnAvailable: true,
      configs: [
        {
          id: 3,
          customerId: 7,
          commonName: "np-7-active",
          issuedAt: "2026-01-02T03:04:05.000Z",
          connected: true,
          remoteIp: "198.51.100.12",
        },
        {
          id: 4,
          revokedAt: "2026-02-03T04:05:06.000Z",
          revokedBy: "admin@example.test",
          connected: false,
          remoteIp: null,
        },
      ],
    });
  });

  it("rejects invalid customer and router IDs before querying VPN records", async () => {
    const app = buildApp();

    const [customerResponse, routerResponse] = await Promise.all([
      request(app).get("/customers/not-a-number/vpn"),
      request(app).get("/routers/not-a-number/vpn"),
    ]);

    expect(customerResponse).toMatchObject({ status: 400, body: { error: "Invalid customer ID" } });
    expect(routerResponse).toMatchObject({ status: 400, body: { error: "Invalid router ID" } });
    expect(mockDbResult).not.toHaveBeenCalled();
  });

  it("issues a customer configuration only after the issue command returns a client profile", async () => {
    mockExecAsync.mockResolvedValueOnce({ stdout: "client\nremote vpn.example.test\n" });
    mockDbResult.mockResolvedValueOnce([vpnConfig({ ovpnConfig: "client\nremote vpn.example.test" })]);

    const response = await request(buildApp()).post("/customers/7/vpn").send({});

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      id: 3,
      customerId: 7,
      commonName: "np-7-active",
      ovpnConfig: "client\nremote vpn.example.test",
    });
    expect(mockExecAsync).toHaveBeenCalledWith(
      expect.stringMatching(/^\/usr\/local\/bin\/netpulse-vpn-issue np-7-\d+$/),
      { timeout: 30_000 },
    );
  });

  it("protects customer downloads and returns a matching active profile for admins", async () => {
    const denied = await request(buildApp(support)).get("/customers/7/vpn/3/download");
    expect(denied).toMatchObject({
      status: 403,
      body: { error: "Forbidden: insufficient permissions" },
    });
    expect(mockDbResult).not.toHaveBeenCalled();

    mockDbResult.mockResolvedValueOnce([vpnConfig()]);
    const downloaded = await request(buildApp()).get("/customers/7/vpn/3/download");

    expect(downloaded.status).toBe(200);
    expect(downloaded.text).toBe("client\nremote vpn.example.test");
    expect(downloaded.headers["content-type"]).toContain("application/x-openvpn-profile");
    expect(downloaded.headers["content-disposition"]).toContain('filename="np-7-active.ovpn"');
  });

  it("blocks revoked customer configurations without calling the revoke command", async () => {
    mockDbResult.mockResolvedValueOnce([
      vpnConfig({ revokedAt: new Date("2026-02-03T04:05:06.000Z") }),
    ]);

    const response = await request(buildApp()).delete("/customers/7/vpn/3");

    expect(response).toMatchObject({ status: 409, body: { error: "Already revoked" } });
    expect(mockExecAsync).not.toHaveBeenCalled();
  });

  it("lists router configurations and downloads the matching active router profile", async () => {
    mockDbResult.mockResolvedValueOnce([
      vpnConfig({
        customerId: null,
        routerId: 9,
        commonName: "nr-9-active",
      }),
    ]);

    const listed = await request(buildApp()).get("/routers/9/vpn");
    expect(listed.status).toBe(200);
    expect(listed.body.configs).toEqual([
      expect.objectContaining({ routerId: 9, commonName: "nr-9-active", connected: false }),
    ]);

    mockDbResult.mockResolvedValueOnce([
      vpnConfig({
        customerId: null,
        routerId: 9,
        commonName: "nr-9-active",
      }),
    ]);
    const downloaded = await request(buildApp()).get("/routers/9/vpn/3/download");

    expect(downloaded.status).toBe(200);
    expect(downloaded.headers["content-disposition"]).toContain('filename="nr-9-active.ovpn"');
  });

  it("revokes an active router configuration and records the staff member", async () => {
    const active = vpnConfig({
      customerId: null,
      routerId: 9,
      commonName: "nr-9-active",
    });
    const updated = {
      ...active,
      revokedAt: new Date("2026-02-03T04:05:06.000Z"),
      revokedBy: admin.email,
    };
    mockDbResult.mockResolvedValueOnce([active]).mockResolvedValueOnce([updated]);
    mockExecAsync.mockResolvedValueOnce({ stdout: "" });

    const response = await request(buildApp()).delete("/routers/9/vpn/3");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: 3,
      routerId: 9,
      commonName: "nr-9-active",
      revokedAt: "2026-02-03T04:05:06.000Z",
      revokedBy: "admin@example.test",
      connected: false,
      remoteIp: null,
    });
    expect(mockExecAsync).toHaveBeenCalledWith(
      "/usr/local/bin/netpulse-vpn-revoke nr-9-active",
      { timeout: 30_000 },
    );
  });
});