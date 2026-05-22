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
    paymentsTable: {
      id: {},
      customerId: {},
      invoiceId: {},
      amount: {},
      method: {},
      status: {},
      reference: {},
      notes: {},
      createdAt: {},
    },
    customersTable: { id: {}, name: {}, email: {} },
    invoicesTable: { id: {}, status: {}, paidAt: {} },
    eq: vi.fn(),
  };
});

vi.mock("../lib/audit.js", () => ({
  writeAuditLog: vi.fn(),
}));

const { default: paymentsRouter } = await import("../routes/payments.js");

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
  app.use(paymentsRouter);
  return app;
}

const samplePayment = {
  id: 1,
  customerId: 10,
  invoiceId: 5,
  amount: "150.00",
  method: "mpesa",
  status: "completed",
  reference: "TXN123",
  notes: null,
  createdAt: new Date().toISOString(),
};

const sampleCustomer = {
  id: 10,
  name: "Alice Ngugi",
  email: "alice@example.com",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /payments", () => {
  it("returns a list of payments with numeric amounts", async () => {
    mockExec.mockResolvedValueOnce([{ payments: samplePayment, customers: sampleCustomer }]);

    const res = await request(buildApp()).get("/payments");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].amount).toBe(150);
    expect(res.body[0].customer).toMatchObject({ id: 10, name: "Alice Ngugi" });
  });

  it("returns empty array when no payments exist", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp()).get("/payments");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("filters by customerId", async () => {
    mockExec.mockResolvedValueOnce([
      { payments: samplePayment, customers: sampleCustomer },
      { payments: { ...samplePayment, id: 2, customerId: 99 }, customers: null },
    ]);

    const res = await request(buildApp()).get("/payments?customerId=10");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].customerId).toBe(10);
  });

  it("filters by invoiceId", async () => {
    mockExec.mockResolvedValueOnce([
      { payments: samplePayment, customers: sampleCustomer },
      { payments: { ...samplePayment, id: 2, invoiceId: 99 }, customers: null },
    ]);

    const res = await request(buildApp()).get("/payments?invoiceId=5");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].invoiceId).toBe(5);
  });
});

describe("GET /payments/:id", () => {
  it("returns a single payment by id", async () => {
    mockExec.mockResolvedValueOnce([{ payments: samplePayment, customers: sampleCustomer }]);

    const res = await request(buildApp()).get("/payments/1");

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(1);
    expect(res.body.amount).toBe(150);
    expect(res.body.method).toBe("mpesa");
  });

  it("returns 404 when payment does not exist", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp()).get("/payments/999");

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });

  it("returns null customer when no join result", async () => {
    mockExec.mockResolvedValueOnce([{ payments: samplePayment, customers: null }]);

    const res = await request(buildApp()).get("/payments/1");

    expect(res.status).toBe(200);
    expect(res.body.customer).toBeNull();
  });
});

describe("POST /payments", () => {
  it("creates a payment and returns 201 (admin)", async () => {
    mockExec
      .mockResolvedValueOnce([samplePayment])
      .mockResolvedValueOnce([]);

    const res = await request(buildApp())
      .post("/payments")
      .send({ customerId: 10, invoiceId: 5, amount: 150, method: "mpesa" });

    expect(res.status).toBe(201);
    expect(res.body.amount).toBe(150);
    expect(res.body.status).toBe("completed");
  });

  it("creates a payment as billing role", async () => {
    mockExec
      .mockResolvedValueOnce([samplePayment])
      .mockResolvedValueOnce([]);

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
      .post("/payments")
      .send({ customerId: 10, amount: 150 });

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
      .post("/payments")
      .send({ amount: 100 });

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
      .post("/payments")
      .send({ amount: 100 });

    expect(res.status).toBe(403);
  });

  it("marks linked invoice as paid when payment is completed", async () => {
    const completedPayment = { ...samplePayment, status: "completed", invoiceId: 5 };
    mockExec
      .mockResolvedValueOnce([completedPayment])
      .mockResolvedValueOnce([]);

    const res = await request(buildApp())
      .post("/payments")
      .send({ customerId: 10, invoiceId: 5, amount: 150, status: "completed" });

    expect(res.status).toBe(201);
    expect(mockExec).toHaveBeenCalledTimes(2);
  });

  it("does not update invoice when payment status is pending", async () => {
    const pendingPayment = { ...samplePayment, status: "pending" };
    mockExec.mockResolvedValueOnce([pendingPayment]);

    const res = await request(buildApp())
      .post("/payments")
      .send({ customerId: 10, invoiceId: 5, amount: 150, status: "pending" });

    expect(res.status).toBe(201);
    expect(mockExec).toHaveBeenCalledTimes(1);
  });
});
