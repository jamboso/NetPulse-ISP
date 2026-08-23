import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

const mockExec = vi.hoisted(() => vi.fn());

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
    ipPoolsTable: {
      id: {},
      name: {},
      network: {},
      gateway: {},
      subnetMask: {},
      dns1: {},
      dns2: {},
      totalIps: {},
      usedIps: {},
      description: {},
      createdAt: {},
    },
    companiesTable: {
      id: {},
    },
    eq: vi.fn(),
  };
});

vi.mock("../lib/audit.js", () => ({
  writeAuditLog: vi.fn(),
}));

const { default: ipPoolsRouter } = await import("../routes/ipPools.js");
const { writeAuditLog } = await import("../lib/audit.js");

type MockUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  companyId?: number;
  active: boolean;
  emailVerified: boolean;
  image?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function buildApp(
  user: MockUser = {
    id: "u1",
    email: "owner@test.com",
    name: "Owner",
    role: "owner",
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
    next();
  });
  app.use(ipPoolsRouter);
  return app;
}

const samplePool = {
  id: 1,
  name: "Main Pool",
  network: "192.168.1.0/24",
  gateway: "192.168.1.1",
  subnetMask: "255.255.255.0",
  dns1: "8.8.8.8",
  dns2: null,
  totalIps: 254,
  usedIps: 0,
  description: null,
  createdAt: new Date().toISOString(),
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("GET /ip-pools", () => {
  it("returns a list of IP pools", async () => {
    mockExec.mockResolvedValueOnce([samplePool]);

    const res = await request(buildApp()).get("/ip-pools");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
  });

  it("returns empty array when no pools exist", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp()).get("/ip-pools");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe("GET /ip-pools/:id", () => {
  it("returns a single pool by id", async () => {
    mockExec.mockResolvedValueOnce([samplePool]);

    const res = await request(buildApp()).get("/ip-pools/1");

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(1);
    expect(res.body.name).toBe("Main Pool");
  });

  it("returns 404 when pool does not exist", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp()).get("/ip-pools/999");

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });
});

describe("POST /ip-pools", () => {
  it("creates an IP pool and returns 201 (admin)", async () => {
    mockExec.mockResolvedValueOnce([samplePool]);

    const res = await request(buildApp())
      .post("/ip-pools")
      .send({ name: "Main Pool", network: "192.168.1.0/24", gateway: "192.168.1.1", subnetMask: "255.255.255.0" });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(1);
  });

  it("calculates totalIps from the CIDR prefix (/24 = 254)", async () => {
    const poolWith254 = { ...samplePool, totalIps: 254 };
    mockExec.mockResolvedValueOnce([poolWith254]);

    const res = await request(buildApp())
      .post("/ip-pools")
      .send({ name: "Pool A", network: "10.0.0.0/24", gateway: "10.0.0.1", subnetMask: "255.255.255.0" });

    expect(res.status).toBe(201);
    expect(res.body.totalIps).toBe(254);
  });

  it("calculates a single usable IP for a /32 network", async () => {
    const poolWithOne = { ...samplePool, totalIps: 1 };
    mockExec.mockResolvedValueOnce([poolWithOne]);
    const res = await request(buildApp())
      .post("/ip-pools")
      .send({ name: "Pool B", network: "10.0.0.1/32", gateway: "10.0.0.1", subnetMask: "255.255.255.255" });

    expect(res.status).toBe(201);
    expect(res.body.totalIps).toBe(1);
  });

  it("creates an IP pool as technician role", async () => {
    mockExec
      .mockResolvedValueOnce([{ accessStatus: "active", accessUntil: null, exempt: false }])
      .mockResolvedValueOnce([samplePool]);

    const res = await request(
      buildApp({
        id: "u2",
        email: "tech@test.com",
        name: "Tech",
        role: "technician",
        companyId: 1,
        active: true,
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    )
      .post("/ip-pools")
      .send({ name: "Main Pool", network: "192.168.1.0/24", gateway: "192.168.1.1", subnetMask: "255.255.255.0" });

    expect(res.status).toBe(201);
  });

  it("returns 403 for support role on POST", async () => {
    const res = await request(
      buildApp({
        id: "u3",
        email: "support@test.com",
        name: "Support",
        role: "support",
        active: true,
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    )
      .post("/ip-pools")
      .send({ name: "Main Pool", network: "192.168.1.0/24", gateway: "192.168.1.1", subnetMask: "255.255.255.0" });

    expect(res.status).toBe(403);
  });
});

describe("POST /ip-pools — validation", () => {
  it("returns 400 when name is missing", async () => {
    const res = await request(buildApp())
      .post("/ip-pools")
      .send({ network: "192.168.1.0/24", gateway: "192.168.1.1", subnetMask: "255.255.255.0" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when network is missing", async () => {
    const res = await request(buildApp())
      .post("/ip-pools")
      .send({ name: "Main Pool", gateway: "192.168.1.1", subnetMask: "255.255.255.0" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when gateway is missing", async () => {
    const res = await request(buildApp())
      .post("/ip-pools")
      .send({ name: "Main Pool", network: "192.168.1.0/24", subnetMask: "255.255.255.0" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when subnetMask is missing", async () => {
    const res = await request(buildApp())
      .post("/ip-pools")
      .send({ name: "Main Pool", network: "192.168.1.0/24", gateway: "192.168.1.1" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it.each([
    "10.0.0.0",
    "not-a-network",
    "10.0.0.0/33",
  ])("returns 400 when network is an invalid CIDR (%s)", async (network) => {
    const res = await request(buildApp())
      .post("/ip-pools")
      .send({ name: "Main Pool", network, gateway: "10.0.0.1", subnetMask: "255.255.255.0" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when name is an empty string", async () => {
    const res = await request(buildApp())
      .post("/ip-pools")
      .send({ name: "", network: "192.168.1.0/24", gateway: "192.168.1.1", subnetMask: "255.255.255.0" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when gateway is an empty string", async () => {
    const res = await request(buildApp())
      .post("/ip-pools")
      .send({ name: "Main Pool", network: "192.168.1.0/24", gateway: "", subnetMask: "255.255.255.0" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });
});

describe("PATCH /ip-pools/:id", () => {
  it("updates an IP pool and returns 200 (admin)", async () => {
    const updated = { ...samplePool, gateway: "192.168.1.254" };
    mockExec.mockResolvedValueOnce([updated]);

    const res = await request(buildApp())
      .patch("/ip-pools/1")
      .send({ gateway: "192.168.1.254" });

    expect(res.status).toBe(200);
    expect(res.body.gateway).toBe("192.168.1.254");
  });

  it("returns 404 when pool does not exist", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp())
      .patch("/ip-pools/999")
      .send({ gateway: "192.168.1.254" });

    expect(res.status).toBe(404);
  });
});

describe("PATCH /ip-pools/:id — validation", () => {
  it("returns 400 when name is an empty string", async () => {
    const res = await request(buildApp())
      .patch("/ip-pools/1")
      .send({ name: "" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when gateway is an empty string", async () => {
    const res = await request(buildApp())
      .patch("/ip-pools/1")
      .send({ gateway: "" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when subnetMask is an empty string", async () => {
    const res = await request(buildApp())
      .patch("/ip-pools/1")
      .send({ subnetMask: "" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when gateway is not an IPv4 string", async () => {
    const res = await request(buildApp())
      .patch("/ip-pools/1")
      .send({ gateway: 123 });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });
});

describe("DELETE /ip-pools/:id", () => {
  it("deletes an IP pool and returns 204 (admin)", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete("/ip-pools/1");

    expect(res.status).toBe(204);
  });

  it("returns 403 for technician role on DELETE", async () => {
    const res = await request(
      buildApp({
        id: "u2",
        email: "tech@test.com",
        name: "Tech",
        role: "technician",
        active: true,
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ).delete("/ip-pools/1");

    expect(res.status).toBe(403);
  });
});

describe("Audit log — ip_pool", () => {
  it("writes an audit record with entityType 'ip_pool' and action 'create' on POST /ip-pools", async () => {
    mockExec.mockResolvedValueOnce([samplePool]);

    await request(buildApp())
      .post("/ip-pools")
      .send({ name: "Main Pool", network: "192.168.1.0/24", gateway: "192.168.1.1", subnetMask: "255.255.255.0" });

    expect(vi.mocked(writeAuditLog)).toHaveBeenCalledOnce();
    expect(vi.mocked(writeAuditLog)).toHaveBeenCalledWith(
      expect.objectContaining({
        action:     "create",
        entityType: "ip_pool",
        entityId:   samplePool.id,
        userId:     "u1",
        diff:       samplePool,
      }),
    );
  });

  it("writes an audit record with entityType 'ip_pool' and action 'update' on PATCH /ip-pools/:id", async () => {
    const updated = { ...samplePool, gateway: "192.168.1.254" };
    mockExec.mockResolvedValueOnce([updated]);

    await request(buildApp())
      .patch("/ip-pools/1")
      .send({ gateway: "192.168.1.254" });

    expect(vi.mocked(writeAuditLog)).toHaveBeenCalledOnce();
    expect(vi.mocked(writeAuditLog)).toHaveBeenCalledWith(
      expect.objectContaining({
        action:     "update",
        entityType: "ip_pool",
        entityId:   1,
        userId:     "u1",
        diff:       { gateway: "192.168.1.254" },
      }),
    );
  });

  it("writes an audit record with entityType 'ip_pool' and action 'delete' on DELETE /ip-pools/:id", async () => {
    mockExec.mockResolvedValueOnce([]);

    await request(buildApp()).delete("/ip-pools/1");

    expect(vi.mocked(writeAuditLog)).toHaveBeenCalledOnce();
    const auditCall = vi.mocked(writeAuditLog).mock.calls[0][0];
    expect(auditCall).toMatchObject({
      action:     "delete",
      entityType: "ip_pool",
      entityId:   1,
      userId:     "u1",
    });
    expect(auditCall.diff).toBeUndefined();
  });

  it("does NOT write an audit record when POST /ip-pools fails validation", async () => {
    await request(buildApp())
      .post("/ip-pools")
      .send({ network: "192.168.1.0/24" });

    expect(vi.mocked(writeAuditLog)).not.toHaveBeenCalled();
  });

  it("does NOT write an audit record when PATCH /ip-pools/:id returns 404", async () => {
    mockExec.mockResolvedValueOnce([]);

    await request(buildApp())
      .patch("/ip-pools/999")
      .send({ gateway: "192.168.1.254" });

    expect(vi.mocked(writeAuditLog)).not.toHaveBeenCalled();
  });
});
