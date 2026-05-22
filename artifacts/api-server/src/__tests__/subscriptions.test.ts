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
    "leftJoin",
    "$dynamic",
    "inArray",
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
    subscriptionsTable: {
      id: {},
      customerId: {},
      planId: {},
      routerId: {},
      status: {},
      startDate: {},
      endDate: {},
      ipAddress: {},
      macAddress: {},
      pppoeUsername: {},
      pppoePassword: {},
      createdAt: {},
    },
    customersTable: { id: {}, name: {}, email: {} },
    plansTable: { id: {}, name: {}, price: {}, rosProfileName: {} },
    routersTable: { id: {}, routerType: {}, ipAddress: {}, apiSsl: {}, username: {}, password: {} },
    invoicesTable: { id: {}, subscriptionId: {} },
    paymentsTable: { id: {}, invoiceId: {} },
    eq: vi.fn(),
    and: vi.fn(),
    inArray: vi.fn(),
  };
});

vi.mock("../lib/audit.js", () => ({
  writeAuditLog: vi.fn(),
}));

const { default: subscriptionsRouter } = await import("../routes/subscriptions.js");

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
  app.use(subscriptionsRouter);
  return app;
}

const sampleSubscription = {
  id: 1,
  customerId: 10,
  planId: 2,
  routerId: null,
  status: "active",
  startDate: "2026-01-01",
  endDate: null,
  ipAddress: null,
  macAddress: null,
  pppoeUsername: null,
  pppoePassword: null,
  createdAt: new Date().toISOString(),
};

const sampleCustomer = {
  id: 10,
  name: "Alice Ngugi",
  email: "alice@example.com",
};

const samplePlan = {
  id: 2,
  name: "Basic",
  price: "29.99",
  rosProfileName: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /subscriptions", () => {
  it("returns a list of subscriptions with joined customer and plan", async () => {
    mockExec.mockResolvedValueOnce([
      { subscriptions: sampleSubscription, customers: sampleCustomer, plans: samplePlan },
    ]);

    const res = await request(buildApp()).get("/subscriptions");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(1);
    expect(res.body[0].customer).toMatchObject({ id: 10, name: "Alice Ngugi" });
    expect(res.body[0].plan).toMatchObject({ id: 2, name: "Basic", price: 29.99 });
  });

  it("returns plan price as a number", async () => {
    mockExec.mockResolvedValueOnce([
      { subscriptions: sampleSubscription, customers: sampleCustomer, plans: samplePlan },
    ]);

    const res = await request(buildApp()).get("/subscriptions");

    expect(res.body[0].plan.price).toBe(29.99);
  });

  it("returns empty array when no subscriptions exist", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp()).get("/subscriptions");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe("GET /subscriptions/:id", () => {
  it("returns a single subscription by id", async () => {
    mockExec.mockResolvedValueOnce([
      { subscriptions: sampleSubscription, customers: sampleCustomer, plans: samplePlan },
    ]);

    const res = await request(buildApp()).get("/subscriptions/1");

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(1);
    expect(res.body.status).toBe("active");
  });

  it("returns 404 when subscription does not exist", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp()).get("/subscriptions/999");

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });
});

describe("POST /subscriptions", () => {
  it("creates a subscription and returns 201 (admin, no router)", async () => {
    mockExec
      .mockResolvedValueOnce([sampleCustomer])
      .mockResolvedValueOnce([samplePlan])
      .mockResolvedValueOnce([sampleSubscription]);

    const res = await request(buildApp())
      .post("/subscriptions")
      .send({ customerId: 10, planId: 2, startDate: "2026-01-01" });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(1);
    expect(res.body.customerId).toBe(10);
  });

  it("creates a subscription as billing role", async () => {
    mockExec
      .mockResolvedValueOnce([sampleCustomer])
      .mockResolvedValueOnce([samplePlan])
      .mockResolvedValueOnce([sampleSubscription]);

    const res = await request(
      buildApp({
        id: "u2",
        email: "billing@test.com",
        name: "Billing",
        role: "billing",
        active: true,
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    )
      .post("/subscriptions")
      .send({ customerId: 10, planId: 2, startDate: "2026-01-01" });

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
      .post("/subscriptions")
      .send({ customerId: 10, planId: 2, startDate: "2026-01-01" });

    expect(res.status).toBe(403);
  });

  it("returns 403 for technician role on POST", async () => {
    const res = await request(
      buildApp({
        id: "u4",
        email: "tech@test.com",
        name: "Tech",
        role: "technician",
        active: true,
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    )
      .post("/subscriptions")
      .send({ customerId: 10, planId: 2, startDate: "2026-01-01" });

    expect(res.status).toBe(403);
  });
});

describe("POST /subscriptions — validation", () => {
  it("returns 400 when customerId is missing", async () => {
    const res = await request(buildApp())
      .post("/subscriptions")
      .send({ planId: 2, startDate: "2026-01-01" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when planId is missing", async () => {
    const res = await request(buildApp())
      .post("/subscriptions")
      .send({ customerId: 10, startDate: "2026-01-01" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when startDate is missing", async () => {
    const res = await request(buildApp())
      .post("/subscriptions")
      .send({ customerId: 10, planId: 2 });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when customerId is not a number", async () => {
    const res = await request(buildApp())
      .post("/subscriptions")
      .send({ customerId: "abc", planId: 2, startDate: "2026-01-01" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when customerId is not a positive integer", async () => {
    const res = await request(buildApp())
      .post("/subscriptions")
      .send({ customerId: 0, planId: 2, startDate: "2026-01-01" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when status is an invalid enum value", async () => {
    const res = await request(buildApp())
      .post("/subscriptions")
      .send({ customerId: 10, planId: 2, startDate: "2026-01-01", status: "expired" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });
});

describe("PATCH /subscriptions/:id — validation", () => {
  it("returns 400 when status is an invalid enum value", async () => {
    const res = await request(buildApp())
      .patch("/subscriptions/1")
      .send({ status: "expired" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when planId is not a positive integer", async () => {
    const res = await request(buildApp())
      .patch("/subscriptions/1")
      .send({ planId: -1 });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });
});

describe("PATCH /subscriptions/:id", () => {
  it("updates a subscription status (admin)", async () => {
    const updated = { ...sampleSubscription, status: "suspended" };
    mockExec
      .mockResolvedValueOnce([sampleSubscription])
      .mockResolvedValueOnce([updated]);

    const res = await request(buildApp())
      .patch("/subscriptions/1")
      .send({ status: "suspended" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("suspended");
  });

  it("allows billing role to patch", async () => {
    const updated = { ...sampleSubscription, status: "suspended" };
    mockExec
      .mockResolvedValueOnce([sampleSubscription])
      .mockResolvedValueOnce([updated]);

    const res = await request(
      buildApp({
        id: "u2",
        email: "billing@test.com",
        name: "Billing",
        role: "billing",
        active: true,
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    )
      .patch("/subscriptions/1")
      .send({ status: "suspended" });

    expect(res.status).toBe(200);
  });

  it("returns 404 when subscription does not exist", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp())
      .patch("/subscriptions/999")
      .send({ status: "suspended" });

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 403 for support role on PATCH", async () => {
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
      .patch("/subscriptions/1")
      .send({ status: "suspended" });

    expect(res.status).toBe(403);
  });

  it("returns 403 for technician role on PATCH", async () => {
    const res = await request(
      buildApp({
        id: "u4",
        email: "tech@test.com",
        name: "Tech",
        role: "technician",
        active: true,
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    )
      .patch("/subscriptions/1")
      .send({ status: "suspended" });

    expect(res.status).toBe(403);
  });
});

describe("DELETE /subscriptions/:id", () => {
  it("deletes a subscription with no invoices and returns 204 (admin)", async () => {
    mockExec
      .mockResolvedValueOnce([sampleSubscription])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete("/subscriptions/1");

    expect(res.status).toBe(204);
  });

  it("cascades deletion through invoices and payments", async () => {
    mockExec
      .mockResolvedValueOnce([sampleSubscription])
      .mockResolvedValueOnce([{ id: 5 }, { id: 6 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete("/subscriptions/1");

    expect(res.status).toBe(204);
    expect(mockExec).toHaveBeenCalledTimes(5);
  });

  it("returns 404 when subscription does not exist", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete("/subscriptions/999");

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 403 for billing role on DELETE", async () => {
    const res = await request(
      buildApp({
        id: "u2",
        email: "billing@test.com",
        name: "Billing",
        role: "billing",
        active: true,
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ).delete("/subscriptions/1");

    expect(res.status).toBe(403);
  });

  it("returns 403 for support role on DELETE", async () => {
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
    ).delete("/subscriptions/1");

    expect(res.status).toBe(403);
  });
});
