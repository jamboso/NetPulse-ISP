import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";

const mockExec = vi.hoisted(() => vi.fn());
const mockGenerateServerCerts = vi.hoisted(() => vi.fn());
const mockGenerateClientCert = vi.hoisted(() => vi.fn());
const mockGenerateServerConf = vi.hoisted(() => vi.fn());
const mockGenerateRosScript = vi.hoisted(() => vi.fn());
const mockLoadInstalledOpenVpnCertificatesWithHelper = vi.hoisted(() => vi.fn());
const mockRepairOpenVpnService = vi.hoisted(() => vi.fn());

vi.mock("@workspace/db", () => {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "insert", "update", "from", "where", "limit", "values", "set", "innerJoin"]) {
    chain[method] = () => chain;
  }
  chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(mockExec()).then(resolve, reject);
  return {
    db: chain,
    vpnConfigTable: { id: {} },
    routerVpnCertsTable: { id: {}, routerId: {} },
    routersTable: { id: {}, ipAddress: {}, name: {} },
    settingsTable: { key: {} },
    subscriptionsTable: { id: {}, customerId: {}, planId: {}, status: {} },
    customersTable: { id: {}, email: {} },
    plansTable: { id: {}, name: {}, downloadSpeed: {}, uploadSpeed: {} },
  };
});
vi.mock("../lib/certGen.js", () => ({
  generateVpnServerCerts: mockGenerateServerCerts,
  generateClientCert: mockGenerateClientCert,
  generateOpenVpnServerConf: mockGenerateServerConf,
  generateRosScript: mockGenerateRosScript,
}));
vi.mock("../lib/systemVpnCerts.js", () => ({
  loadInstalledOpenVpnCertificatesWithHelper: mockLoadInstalledOpenVpnCertificatesWithHelper,
}));
vi.mock("../lib/openVpnRepair.js", () => ({
  repairOpenVpnService: mockRepairOpenVpnService,
}));

const { default: infrastructureRouter } = await import("../routes/infrastructure.js");

function buildApp(role = "owner") {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).log = { info: vi.fn(), error: vi.fn() };
    (req as any).user = { role };
    next();
  });
  app.use(infrastructureRouter);
  return app;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("infrastructure read operations", () => {
  it("summarizes configured RADIUS, VPN, routers, and client certificates", async () => {
    mockExec
      .mockResolvedValueOnce([{ isConfigured: true, caCert: "ca", serverPublicIp: "vpn.example.test", vpnPort: 443 }])
      .mockResolvedValueOnce([{ value: "radius.example.test" }])
      .mockResolvedValueOnce([{ value: "shared-secret" }])
      .mockResolvedValueOnce([{ id: 1 }, { id: 2 }])
      .mockResolvedValueOnce([{ id: 8, routerId: 1, routerName: "Edge", vpnIp: "10.8.0.2", createdAt: "today", revokedAt: null }]);

    const response = await request(buildApp()).get("/infrastructure/status");

    expect(response.status).toBe(200);
    expect(response.body.radius).toEqual({ configured: true, server: "radius.example.test" });
    expect(response.body.vpn.certsGenerated).toBe(true);
    expect(response.body.routerCount).toBe(2);
  });

  it("reports missing RADIUS configuration without attempting a network connection", async () => {
    mockExec.mockResolvedValueOnce([]);

    const response = await request(buildApp()).post("/infrastructure/radius/test");

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it("requires certificates before downloading the OpenVPN server config", async () => {
    mockExec.mockResolvedValueOnce([{ id: 1, caCert: null }]);

    const response = await request(buildApp()).get("/infrastructure/vpn/server-conf");

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("Generate certificates");
  });

  it("downloads a generated OpenVPN server configuration", async () => {
    mockExec.mockResolvedValueOnce([{
      id: 1, caCert: "ca", serverCert: "server", serverKey: "server-key",
      vpnPort: 443, vpnProtocol: "tcp", vpnSubnet: "10.8.0.0",
      vpnSubnetMask: "255.255.255.0", vpnDns: "1.1.1.1",
    }]);
    mockGenerateServerConf.mockReturnValueOnce("port 443\nproto tcp");

    const response = await request(buildApp()).get("/infrastructure/vpn/server-conf");

    expect(response.status).toBe(200);
    expect(response.text).toContain("port 443");
    expect(response.headers["content-disposition"]).toContain("netpulse-vpn-server.conf");
    expect(mockGenerateServerConf).toHaveBeenCalledWith(expect.objectContaining({ port: 443 }));
  });

  it("lists VPN clients without exposing their certificate material", async () => {
    mockExec.mockResolvedValueOnce([
      { id: 2, routerId: 4, routerName: "Edge", vpnIp: "10.8.0.2", createdAt: "today", revokedAt: null, clientKey: "private" },
    ]);

    const response = await request(buildApp()).get("/infrastructure/vpn/clients");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([expect.objectContaining({ routerName: "Edge", revoked: false })]);
    expect(response.body[0]).not.toHaveProperty("clientKey");
  });
});

describe("infrastructure write operations", () => {
  it("saves a new VPN configuration with safe defaults", async () => {
    mockExec.mockResolvedValueOnce([]);

    const response = await request(buildApp())
      .post("/infrastructure/vpn/config")
      .send({ serverPublicIp: "vpn.example.test" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
  });

  it("rejects a non-TCP management VPN configuration before it can mismatch RouterOS", async () => {
    const response = await request(buildApp())
      .post("/infrastructure/vpn/config")
      .send({ serverPublicIp: "vpn.example.test", vpnPort: 443, vpnProtocol: "udp" });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("TCP only");
    expect(mockExec).not.toHaveBeenCalled();
  });

  it("requires a VPN configuration before generating certificates", async () => {
    mockExec.mockResolvedValueOnce([]);

    const response = await request(buildApp()).post("/infrastructure/vpn/generate-certs");

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("Save VPN configuration");
  });

  it("generates and persists CA and server certificates for an existing configuration", async () => {
    mockExec.mockResolvedValueOnce([{ id: 1 }]);
    mockGenerateServerCerts.mockResolvedValueOnce({
      ca: { cert: "ca-cert", key: "ca-key" },
      server: { cert: "server-cert", key: "server-key" },
    });

    const response = await request(buildApp()).post("/infrastructure/vpn/generate-certs");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(mockGenerateServerCerts).toHaveBeenCalledOnce();
  });

  it("syncs the installed OpenVPN certificate authority for an owner", async () => {
    mockExec.mockResolvedValueOnce([{ id: 1 }]);
    mockLoadInstalledOpenVpnCertificatesWithHelper.mockResolvedValueOnce({
      caCert: "installed-ca",
      caKey: "installed-ca-key",
      serverCert: "installed-server",
      serverKey: "installed-server-key",
    });

    const response = await request(buildApp()).post("/infrastructure/vpn/sync-installed-certs");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({ success: true }));
    expect(mockLoadInstalledOpenVpnCertificatesWithHelper).toHaveBeenCalledOnce();
  });

  it("refuses to sync installed OpenVPN certificates for non-owners", async () => {
    const response = await request(buildApp("admin")).post("/infrastructure/vpn/sync-installed-certs");

    expect(response.status).toBe(403);
    expect(mockLoadInstalledOpenVpnCertificatesWithHelper).not.toHaveBeenCalled();
  });

  it("repairs the NetPulse VPN service for an owner and returns its safe status", async () => {
    mockRepairOpenVpnService.mockResolvedValueOnce({
      success: true,
      state: "repaired",
      message: "NetPulse VPN service is ready for RouterOS onboarding.",
      events: ["Stopping stale NetPulse OpenVPN listener PID 1404."],
    });

    const response = await request(buildApp()).post("/infrastructure/vpn/repair-service");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      success: true,
      state: "repaired",
      events: ["Stopping stale NetPulse OpenVPN listener PID 1404."],
    }));
    expect(mockRepairOpenVpnService).toHaveBeenCalledOnce();
  });

  it("does not expose the VPN repair action to non-owners", async () => {
    const response = await request(buildApp("admin")).post("/infrastructure/vpn/repair-service");

    expect(response.status).toBe(403);
    expect(mockRepairOpenVpnService).not.toHaveBeenCalled();
  });

  it("returns an actionable service-unavailable result when the helper is missing", async () => {
    mockRepairOpenVpnService.mockResolvedValueOnce({
      success: false,
      state: "unavailable",
      message: "The NetPulse VPN repair helper is not installed or not authorized on this server.",
      events: [],
    });

    const response = await request(buildApp()).post("/infrastructure/vpn/repair-service");

    expect(response.status).toBe(503);
    expect(response.body.message).toContain("not installed");
  });

  it("revokes a router client certificate", async () => {
    const response = await request(buildApp()).delete("/infrastructure/vpn/client/9");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
  });
});