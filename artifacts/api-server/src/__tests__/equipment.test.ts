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
    equipmentTable: {
      id: {},
      name: {},
      type: {},
      model: {},
      brand: {},
      ipAddress: {},
      macAddress: {},
      location: {},
      status: {},
      notes: {},
      createdAt: {},
    },
    eq: vi.fn(),
  };
});

vi.mock("../lib/audit.js", () => ({
  writeAuditLog: vi.fn(),
}));

const { default: equipmentRouter } = await import("../routes/equipment.js");

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
    next();
  });
  app.use(equipmentRouter);
  return app;
}

const sampleEquipment = {
  id: 1,
  name: "Core Router",
  type: "router",
  model: "RB4011",
  brand: "MikroTik",
  ipAddress: "192.168.1.1",
  macAddress: null,
  location: "Server Room",
  status: "online",
  notes: null,
  createdAt: new Date().toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /equipment", () => {
  it("returns a list of equipment", async () => {
    mockExec.mockResolvedValueOnce([sampleEquipment]);

    const res = await request(buildApp()).get("/equipment");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
  });

  it("returns empty array when no equipment exists", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp()).get("/equipment");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe("GET /equipment/:id", () => {
  it("returns a single equipment item", async () => {
    mockExec.mockResolvedValueOnce([sampleEquipment]);

    const res = await request(buildApp()).get("/equipment/1");

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(1);
    expect(res.body.name).toBe("Core Router");
  });

  it("returns 404 when equipment does not exist", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp()).get("/equipment/999");

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });
});

describe("POST /equipment", () => {
  it("creates equipment and returns 201 (admin)", async () => {
    mockExec.mockResolvedValueOnce([sampleEquipment]);

    const res = await request(buildApp())
      .post("/equipment")
      .send({ name: "Core Router", model: "RB4011", ipAddress: "192.168.1.1" });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(1);
  });

  it("creates equipment as technician role", async () => {
    mockExec.mockResolvedValueOnce([sampleEquipment]);

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
    )
      .post("/equipment")
      .send({ name: "Core Router", model: "RB4011", ipAddress: "192.168.1.1" });

    expect(res.status).toBe(201);
  });

  it("returns 403 for billing role on POST", async () => {
    const res = await request(
      buildApp({
        id: "u3",
        email: "billing@test.com",
        name: "Billing",
        role: "billing",
        active: true,
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    )
      .post("/equipment")
      .send({ name: "Core Router", model: "RB4011", ipAddress: "192.168.1.1" });

    expect(res.status).toBe(403);
  });
});

describe("POST /equipment — validation", () => {
  it("returns 400 when name is missing", async () => {
    const res = await request(buildApp())
      .post("/equipment")
      .send({ model: "RB4011", ipAddress: "192.168.1.1" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when model is missing", async () => {
    const res = await request(buildApp())
      .post("/equipment")
      .send({ name: "Core Router", ipAddress: "192.168.1.1" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when ipAddress is missing", async () => {
    const res = await request(buildApp())
      .post("/equipment")
      .send({ name: "Core Router", model: "RB4011" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when type is an invalid enum value", async () => {
    const res = await request(buildApp())
      .post("/equipment")
      .send({ name: "Core Router", model: "RB4011", ipAddress: "192.168.1.1", type: "server" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when status is an invalid enum value", async () => {
    const res = await request(buildApp())
      .post("/equipment")
      .send({ name: "Core Router", model: "RB4011", ipAddress: "192.168.1.1", status: "broken" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when name is an empty string", async () => {
    const res = await request(buildApp())
      .post("/equipment")
      .send({ name: "", model: "RB4011", ipAddress: "192.168.1.1" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });
});

describe("PATCH /equipment/:id", () => {
  it("updates equipment and returns 200 (admin)", async () => {
    const updated = { ...sampleEquipment, status: "maintenance" };
    mockExec.mockResolvedValueOnce([updated]);

    const res = await request(buildApp())
      .patch("/equipment/1")
      .send({ status: "maintenance" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("maintenance");
  });

  it("returns 404 when equipment does not exist", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp())
      .patch("/equipment/999")
      .send({ status: "maintenance" });

    expect(res.status).toBe(404);
  });
});

describe("PATCH /equipment/:id — validation", () => {
  it("returns 400 when type is an invalid enum value", async () => {
    const res = await request(buildApp())
      .patch("/equipment/1")
      .send({ type: "server" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when status is an invalid enum value", async () => {
    const res = await request(buildApp())
      .patch("/equipment/1")
      .send({ status: "broken" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when name is an empty string", async () => {
    const res = await request(buildApp())
      .patch("/equipment/1")
      .send({ name: "" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });
});

describe("DELETE /equipment/:id", () => {
  it("deletes equipment and returns 204 (admin)", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete("/equipment/1");

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
    ).delete("/equipment/1");

    expect(res.status).toBe(403);
  });
});
