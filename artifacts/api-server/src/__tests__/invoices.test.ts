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
    invoicesTable: {
      id: {},
      customerId: {},
      subscriptionId: {},
      amount: {},
      tax: {},
      total: {},
      status: {},
      dueDate: {},
      paidAt: {},
      notes: {},
      createdAt: {},
    },
    customersTable: { id: {}, name: {}, email: {} },
    eq: vi.fn(),
    sql: vi.fn(() => ({})),
  };
});

vi.mock("../lib/audit.js", () => ({
  writeAuditLog: vi.fn(),
}));

const { default: invoicesRouter } = await import("../routes/invoices.js");

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
  app.use(invoicesRouter);
  return app;
}

const sampleInvoice = {
  id: 1,
  customerId: 10,
  subscriptionId: null,
  amount: "100.00",
  tax: "10.00",
  total: "110.00",
  status: "draft",
  dueDate: "2026-06-01",
  paidAt: null,
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

describe("GET /invoices", () => {
  it("returns paginated invoice list with numeric fields", async () => {
    mockExec.mockResolvedValueOnce([{ invoices: sampleInvoice, customers: sampleCustomer }]);

    const res = await request(buildApp()).get("/invoices");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("data");
    expect(res.body).toHaveProperty("total");
    expect(res.body).toHaveProperty("page");
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].amount).toBe(100);
    expect(res.body.data[0].tax).toBe(10);
    expect(res.body.data[0].total).toBe(110);
  });

  it("returns empty list when no invoices exist", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp()).get("/invoices");

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it("defaults to page 1 with limit 20", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp()).get("/invoices");

    expect(res.status).toBe(200);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(20);
  });

  it("respects page and limit query params", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp()).get("/invoices?page=3&limit=5");

    expect(res.status).toBe(200);
    expect(res.body.page).toBe(3);
    expect(res.body.limit).toBe(5);
  });

  it("clamps limit to 100 max", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp()).get("/invoices?limit=9999");

    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(100);
  });
});

describe("GET /invoices/:id", () => {
  it("returns a single invoice by id", async () => {
    mockExec.mockResolvedValueOnce([{ invoices: sampleInvoice, customers: sampleCustomer }]);

    const res = await request(buildApp()).get("/invoices/1");

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(1);
    expect(res.body.amount).toBe(100);
    expect(res.body.customer).toMatchObject({ id: 10, name: "Alice Ngugi" });
  });

  it("returns 404 when invoice does not exist", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp()).get("/invoices/999");

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });

  it("returns null customer when no join result", async () => {
    mockExec.mockResolvedValueOnce([{ invoices: sampleInvoice, customers: null }]);

    const res = await request(buildApp()).get("/invoices/1");

    expect(res.status).toBe(200);
    expect(res.body.customer).toBeNull();
  });
});

describe("POST /invoices", () => {
  it("creates an invoice and returns 201 (admin)", async () => {
    mockExec.mockResolvedValueOnce([sampleInvoice]);

    const res = await request(buildApp())
      .post("/invoices")
      .send({ customerId: 10, amount: 100, tax: 10, dueDate: "2026-06-01" });

    expect(res.status).toBe(201);
    expect(res.body.amount).toBe(100);
    expect(res.body.total).toBe(110);
  });

  it("creates an invoice as billing role", async () => {
    mockExec.mockResolvedValueOnce([sampleInvoice]);

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
      .post("/invoices")
      .send({ customerId: 10, amount: 100, dueDate: "2026-06-01" });

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
      .post("/invoices")
      .send({ customerId: 10, amount: 100, dueDate: "2026-06-01" });

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
      .post("/invoices")
      .send({ customerId: 10, amount: 100, dueDate: "2026-06-01" });

    expect(res.status).toBe(403);
  });

  it("computes total as amount + tax", async () => {
    const invoice = { ...sampleInvoice, amount: "50.00", tax: "5.00", total: "55.00" };
    mockExec.mockResolvedValueOnce([invoice]);

    const res = await request(buildApp())
      .post("/invoices")
      .send({ customerId: 10, amount: 50, tax: 5, dueDate: "2026-06-01" });

    expect(res.status).toBe(201);
    expect(res.body.total).toBe(55);
  });
});

describe("POST /invoices — validation", () => {
  it("returns 400 when customerId is missing", async () => {
    const res = await request(buildApp())
      .post("/invoices")
      .send({ amount: 100, dueDate: "2026-06-01" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when amount is missing", async () => {
    const res = await request(buildApp())
      .post("/invoices")
      .send({ customerId: 10, dueDate: "2026-06-01" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when dueDate is missing", async () => {
    const res = await request(buildApp())
      .post("/invoices")
      .send({ customerId: 10, amount: 100 });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when amount is negative", async () => {
    const res = await request(buildApp())
      .post("/invoices")
      .send({ customerId: 10, amount: -50, dueDate: "2026-06-01" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when amount is not a number", async () => {
    const res = await request(buildApp())
      .post("/invoices")
      .send({ customerId: 10, amount: "hundred", dueDate: "2026-06-01" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when tax is negative", async () => {
    const res = await request(buildApp())
      .post("/invoices")
      .send({ customerId: 10, amount: 100, tax: -5, dueDate: "2026-06-01" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when status is an invalid enum value", async () => {
    const res = await request(buildApp())
      .post("/invoices")
      .send({ customerId: 10, amount: 100, dueDate: "2026-06-01", status: "cancelled" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });
});

describe("PATCH /invoices/:id — validation", () => {
  it("returns 400 when status is an invalid enum value", async () => {
    const res = await request(buildApp())
      .patch("/invoices/1")
      .send({ status: "cancelled" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when amount is negative", async () => {
    const res = await request(buildApp())
      .patch("/invoices/1")
      .send({ amount: -1 });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });
});

describe("PATCH /invoices/:id", () => {
  it("updates an invoice and returns updated record (admin)", async () => {
    const updated = { ...sampleInvoice, status: "sent" };
    mockExec
      .mockResolvedValueOnce([sampleInvoice])
      .mockResolvedValueOnce([updated]);

    const res = await request(buildApp()).patch("/invoices/1").send({ status: "sent" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("sent");
  });

  it("allows billing role to patch", async () => {
    const updated = { ...sampleInvoice, status: "sent" };
    mockExec
      .mockResolvedValueOnce([sampleInvoice])
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
      .patch("/invoices/1")
      .send({ status: "sent" });

    expect(res.status).toBe(200);
  });

  it("returns 404 when invoice does not exist", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp()).patch("/invoices/999").send({ status: "sent" });

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
      .patch("/invoices/1")
      .send({ status: "sent" });

    expect(res.status).toBe(403);
  });

  it("automatically sets paidAt when status transitions to paid", async () => {
    const paidInvoice = { ...sampleInvoice, status: "paid", paidAt: new Date().toISOString() };
    mockExec
      .mockResolvedValueOnce([sampleInvoice])
      .mockResolvedValueOnce([paidInvoice]);

    const res = await request(buildApp()).patch("/invoices/1").send({ status: "paid" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("paid");
    expect(res.body.paidAt).not.toBeNull();
  });
});

describe("DELETE /invoices/:id", () => {
  it("deletes an invoice and returns 204 (admin)", async () => {
    mockExec
      .mockResolvedValueOnce([sampleInvoice])
      .mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete("/invoices/1");

    expect(res.status).toBe(204);
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
    ).delete("/invoices/1");

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
    ).delete("/invoices/1");

    expect(res.status).toBe(403);
  });
});
