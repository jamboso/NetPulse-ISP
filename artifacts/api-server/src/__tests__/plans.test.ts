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
    "limit",
    "offset",
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
    plansTable: { id: {}, name: {}, price: {}, createdAt: {}, isActive: {} },
    eq: vi.fn(),
  };
});

const { default: plansRouter } = await import("../routes/plans.js");

type MockUser = { id: string; email: string; name: string; role: string; active: boolean; emailVerified: boolean; image?: string | null; createdAt: Date; updatedAt: Date };

function buildApp(user: MockUser = { id: "u1", email: "admin@test.com", name: "Admin", role: "admin", active: true, emailVerified: false, createdAt: new Date(), updatedAt: new Date() }) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { user: MockUser }).user = user;
    next();
  });
  app.use(plansRouter);
  return app;
}

const samplePlan = {
  id: 1,
  name: "Basic",
  description: "Entry plan",
  downloadSpeed: 10,
  uploadSpeed: 5,
  price: "9.99",
  billingCycle: "monthly",
  isActive: true,
  rosProfileName: null,
  createdAt: new Date().toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /plans", () => {
  it("returns a list of plans with numeric price", async () => {
    mockExec.mockResolvedValueOnce([samplePlan]);

    const res = await request(buildApp()).get("/plans");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].price).toBe(9.99);
  });

  it("returns an empty array when no plans exist", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp()).get("/plans");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe("GET /plans/:id", () => {
  it("returns a single plan by id", async () => {
    mockExec.mockResolvedValueOnce([samplePlan]);

    const res = await request(buildApp()).get("/plans/1");

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(1);
    expect(res.body.price).toBe(9.99);
  });

  it("returns 404 when plan is not found", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp()).get("/plans/999");

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });
});

describe("POST /plans", () => {
  it("creates a plan and returns 201 (admin)", async () => {
    mockExec.mockResolvedValueOnce([{ ...samplePlan, id: 2 }]);

    const res = await request(buildApp())
      .post("/plans")
      .send({ name: "Pro", downloadSpeed: 100, uploadSpeed: 50, price: 29.99 });

    expect(res.status).toBe(201);
    expect(res.body.price).toBe(9.99);
  });

  it("returns 403 when non-admin tries to create a plan", async () => {
    const res = await request(buildApp({ id: "u2", email: "support@test.com", name: "Support", role: "support", active: true, emailVerified: false, createdAt: new Date(), updatedAt: new Date() }))
      .post("/plans")
      .send({ name: "Pro", downloadSpeed: 100, uploadSpeed: 50, price: 29.99 });

    expect(res.status).toBe(403);
  });
});

describe("POST /plans — validation", () => {
  it("returns 400 when name is missing", async () => {
    const res = await request(buildApp())
      .post("/plans")
      .send({ downloadSpeed: 100, uploadSpeed: 50, price: 29.99 });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when downloadSpeed is missing", async () => {
    const res = await request(buildApp())
      .post("/plans")
      .send({ name: "Pro", uploadSpeed: 50, price: 29.99 });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when uploadSpeed is missing", async () => {
    const res = await request(buildApp())
      .post("/plans")
      .send({ name: "Pro", downloadSpeed: 100, price: 29.99 });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when price is missing", async () => {
    const res = await request(buildApp())
      .post("/plans")
      .send({ name: "Pro", downloadSpeed: 100, uploadSpeed: 50 });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when downloadSpeed is not a number", async () => {
    const res = await request(buildApp())
      .post("/plans")
      .send({ name: "Pro", downloadSpeed: "fast", uploadSpeed: 50, price: 29.99 });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when downloadSpeed is not a positive integer", async () => {
    const res = await request(buildApp())
      .post("/plans")
      .send({ name: "Pro", downloadSpeed: -5, uploadSpeed: 50, price: 29.99 });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when price is negative", async () => {
    const res = await request(buildApp())
      .post("/plans")
      .send({ name: "Pro", downloadSpeed: 100, uploadSpeed: 50, price: -1 });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when billingCycle is an invalid enum value", async () => {
    const res = await request(buildApp())
      .post("/plans")
      .send({ name: "Pro", downloadSpeed: 100, uploadSpeed: 50, price: 29.99, billingCycle: "weekly" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });
});

describe("PATCH /plans/:id — validation", () => {
  it("returns 400 when billingCycle is an invalid enum value", async () => {
    const res = await request(buildApp())
      .patch("/plans/1")
      .send({ billingCycle: "daily" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when price is negative", async () => {
    const res = await request(buildApp())
      .patch("/plans/1")
      .send({ price: -10 });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });
});

describe("PATCH /plans/:id", () => {
  it("updates a plan (admin)", async () => {
    const updated = { ...samplePlan, name: "Basic Plus", price: "12.99" };
    mockExec.mockResolvedValueOnce([updated]);

    const res = await request(buildApp()).patch("/plans/1").send({ name: "Basic Plus", price: 12.99 });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Basic Plus");
  });

  it("returns 404 when plan does not exist", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp()).patch("/plans/999").send({ name: "Ghost" });

    expect(res.status).toBe(404);
  });

  it("returns 403 for billing role on PATCH", async () => {
    const res = await request(buildApp({ id: "u3", email: "billing@test.com", name: "Billing", role: "billing", active: true, emailVerified: false, createdAt: new Date(), updatedAt: new Date() }))
      .patch("/plans/1")
      .send({ price: 5 });

    expect(res.status).toBe(403);
  });
});

describe("DELETE /plans/:id", () => {
  it("deletes a plan and returns 204 (admin)", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete("/plans/1");

    expect(res.status).toBe(204);
  });

  it("returns 403 when non-admin tries to delete", async () => {
    const res = await request(buildApp({ id: "u4", email: "tech@test.com", name: "Tech", role: "technician", active: true, emailVerified: false, createdAt: new Date(), updatedAt: new Date() })).delete(
      "/plans/1",
    );

    expect(res.status).toBe(403);
  });
});
