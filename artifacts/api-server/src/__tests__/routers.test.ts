import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";

const mockExec = vi.hoisted(() => vi.fn());
const mockUpsertRadnas = vi.hoisted(() => vi.fn());
const mockRemoveRadnas = vi.hoisted(() => vi.fn());

vi.mock("@workspace/db", () => {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "insert", "update", "delete", "from", "where", "orderBy", "values", "set", "limit"]) {
    chain[method] = () => chain;
  }
  chain.returning = () => Promise.resolve(mockExec());
  chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(mockExec()).then(resolve, reject);
  return {
    db: chain,
    routersTable: {
      id: {}, companyId: {}, name: {}, createdAt: {}, ipAddress: {}, radiusSecret: {},
      bridgePorts: {}, routerType: {}, provisionToken: {}, provisionStatus: {}, macAddress: {},
      rosVersion: {}, vpnConnected: {}, vpnIp: {}, lastCallbackAt: {},
    },
    routerVpnCertsTable: { routerId: {}, vpnIp: {} },
    vpnConfigTable: {},
  };
});

vi.mock("../middlewares/companyScope.js", () => ({
  resolveCompanyScope: (req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock("../lib/radiusSync.js", () => ({
  upsertRadnas: mockUpsertRadnas,
  removeRadnas: mockRemoveRadnas,
}));
vi.mock("crypto", () => ({ randomUUID: () => "provision-token" }));

const { default: routersRouter } = await import("../routes/routers.js");

const routerRecord = {
  id: 4,
  companyId: 12,
  name: "Edge router",
  routerType: "juniper",
  ipAddress: "203.0.113.4",
  username: "netops",
  password: "secret",
  enabled: true,
  radiusSecret: null,
  bridgePorts: '["ether2"]',
};

function buildApp(companyId: number | null = 12) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).companyId = companyId;
    (req as any).log = { info: vi.fn(), error: vi.fn() };
    next();
  });
  app.use(routersRouter);
  return app;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("router CRUD", () => {
  it("lists routers in the current company scope", async () => {
    mockExec.mockResolvedValueOnce([routerRecord]);

    const response = await request(buildApp()).get("/routers");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([expect.objectContaining({ id: 4, name: "Edge router" })]);
    expect(response.headers["cache-control"]).toBe("public, max-age=10");
  });

  it("does not create a router when the user has no company scope", async () => {
    const response = await request(buildApp(null))
      .post("/routers")
      .send({ name: "Unscoped", ipAddress: "203.0.113.9" });

    expect(response.status).toBe(403);
    expect(response.body.error).toContain("no company scope");
  });

  it("creates a router with a provisioning token", async () => {
    mockExec.mockResolvedValueOnce([routerRecord]);

    const response = await request(buildApp())
      .post("/routers")
      .send({ name: "Edge router", routerType: "juniper", ipAddress: "203.0.113.4" });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ id: 4, name: "Edge router" });
  });

  it("returns 404 for a router outside the scoped result", async () => {
    mockExec.mockResolvedValueOnce([]);

    const response = await request(buildApp()).get("/routers/404");

    expect(response.status).toBe(404);
  });

  it("updates supported router fields and synchronizes a new RADIUS NAS", async () => {
    const updated = { ...routerRecord, radiusSecret: "nas-secret", radiusPort: 1812 };
    mockExec.mockResolvedValueOnce([updated]);

    const response = await request(buildApp()).patch("/routers/4").send({ radiusSecret: "nas-secret", radiusPort: 1812 });

    expect(response.status).toBe(200);
    expect(response.body.radiusSecret).toBe("nas-secret");
    await vi.waitFor(() => expect(mockUpsertRadnas).toHaveBeenCalledWith(expect.objectContaining({
      ipAddress: "203.0.113.4",
      radiusSecret: "nas-secret",
    })));
  });

  it("deletes an existing router and removes its RADIUS NAS entry", async () => {
    mockExec.mockResolvedValueOnce([{ ipAddress: "203.0.113.4", radiusSecret: "nas-secret" }]);
    mockExec.mockResolvedValueOnce([]);

    const response = await request(buildApp()).delete("/routers/4");

    expect(response.status).toBe(204);
    await vi.waitFor(() => expect(mockRemoveRadnas).toHaveBeenCalledWith("203.0.113.4"));
  });
});

describe("router bridge ports", () => {
  it("falls back to the safe default when stored bridge ports are malformed", async () => {
    mockExec.mockResolvedValueOnce([{ bridgePorts: "not-json" }]);

    const response = await request(buildApp()).get("/routers/4/bridge-ports");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ports: ["ether2"] });
  });

  it("rejects unsafe bridge-port names", async () => {
    const response = await request(buildApp()).post("/routers/4/bridge-ports").send({ port: "ether1; reboot" });

    expect(response.status).toBe(400);
  });

  it("adds a valid port and returns the matching RouterOS command", async () => {
    mockExec.mockResolvedValueOnce([{ bridgePorts: '["ether2"]' }]);

    const response = await request(buildApp()).post("/routers/4/bridge-ports").send({ port: "ether3" });

    expect(response.status).toBe(200);
    expect(response.body.ports).toEqual(["ether2", "ether3"]);
    expect(response.body.command).toContain("interface=ether3");
  });

  it("prevents duplicate bridge ports", async () => {
    mockExec.mockResolvedValueOnce([{ bridgePorts: '["ether2","ether3"]' }]);

    const response = await request(buildApp()).post("/routers/4/bridge-ports").send({ port: "ether3" });

    expect(response.status).toBe(409);
    expect(response.body.error).toContain("already");
  });
});