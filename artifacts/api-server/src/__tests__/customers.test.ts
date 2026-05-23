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
    customersTable: { id: {}, name: {}, email: {}, phone: {}, status: {}, createdAt: {} },
    subscriptionsTable: {},
    invoicesTable: {},
    paymentsTable: {},
    ticketsTable: {},
    ticketRepliesTable: {},
    eq: vi.fn(),
    ilike: vi.fn(),
    or: vi.fn(),
    sql: vi.fn(() => ({})),
    inArray: vi.fn(),
  };
});

vi.mock("../lib/audit.js", () => ({
  writeAuditLog: vi.fn(),
}));

const { default: customersRouter } = await import("../routes/customers.js");
const { writeAuditLog } = await import("../lib/audit.js");

type MockUser = { id: string; email: string; name: string; role: string; active: boolean; emailVerified: boolean; image?: string | null; createdAt: Date; updatedAt: Date };

function buildApp(user: MockUser = { id: "u1", email: "admin@test.com", name: "Admin", role: "admin", active: true, emailVerified: false, createdAt: new Date(), updatedAt: new Date() }) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { user: MockUser }).user = user;
    next();
  });
  app.use(customersRouter);
  return app;
}

const sampleCustomer = {
  id: 1,
  name: "Alice Ngugi",
  email: "alice@example.com",
  phone: "0712345678",
  address: "123 Main St",
  status: "active",
  notes: null,
  latitude: null,
  longitude: null,
  createdAt: new Date().toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /customers", () => {
  it("returns paginated customer list", async () => {
    mockExec
      .mockResolvedValueOnce([sampleCustomer])
      .mockResolvedValueOnce([{ count: 1 }]);

    const res = await request(buildApp()).get("/customers");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("data");
    expect(res.body).toHaveProperty("total");
    expect(res.body).toHaveProperty("page");
    expect(res.body.data).toHaveLength(1);
    expect(res.body.total).toBe(1);
  });

  it("respects page and limit query params", async () => {
    mockExec
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: 0 }]);

    const res = await request(buildApp()).get("/customers?page=2&limit=10");

    expect(res.status).toBe(200);
    expect(res.body.page).toBe(2);
    expect(res.body.limit).toBe(10);
  });

  it("clamps limit to 100 max", async () => {
    mockExec
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: 0 }]);

    const res = await request(buildApp()).get("/customers?limit=9999");

    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(100);
  });

  it("defaults to page 1 with limit 20", async () => {
    mockExec
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: 0 }]);

    const res = await request(buildApp()).get("/customers");

    expect(res.status).toBe(200);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(20);
  });
});

describe("GET /customers/:id", () => {
  it("returns a single customer", async () => {
    mockExec.mockResolvedValueOnce([sampleCustomer]);

    const res = await request(buildApp()).get("/customers/1");

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(1);
    expect(res.body.name).toBe("Alice Ngugi");
  });

  it("returns 404 when customer does not exist", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp()).get("/customers/999");

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });
});

describe("POST /customers", () => {
  it("creates a customer and returns 201 (admin)", async () => {
    mockExec.mockResolvedValueOnce([{ ...sampleCustomer, id: 2 }]);

    const res = await request(buildApp())
      .post("/customers")
      .send({ name: "Bob Omondi", email: "bob@example.com", phone: "0700000000", address: "456 Test Ave" });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Alice Ngugi");
  });

  it("returns 403 for technician role", async () => {
    const res = await request(buildApp({ id: "u2", email: "tech@test.com", name: "Tech", role: "technician", active: true, emailVerified: false, createdAt: new Date(), updatedAt: new Date() }))
      .post("/customers")
      .send({ name: "Eve", email: "eve@example.com", phone: "0700000001", address: "789 Oak Rd" });

    expect(res.status).toBe(403);
  });

  it("allows support role to create customers", async () => {
    mockExec.mockResolvedValueOnce([{ ...sampleCustomer, id: 3 }]);

    const res = await request(buildApp({ id: "u3", email: "support@test.com", name: "Support", role: "support", active: true, emailVerified: false, createdAt: new Date(), updatedAt: new Date() }))
      .post("/customers")
      .send({ name: "Carol", email: "carol@example.com", phone: "0700000002", address: "321 Pine St" });

    expect(res.status).toBe(201);
  });
});

describe("POST /customers — validation", () => {
  it("returns 400 when name is missing", async () => {
    const res = await request(buildApp())
      .post("/customers")
      .send({ email: "bob@example.com", phone: "0700000000", address: "456 Test Ave" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when email is missing", async () => {
    const res = await request(buildApp())
      .post("/customers")
      .send({ name: "Bob", phone: "0700000000", address: "456 Test Ave" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when email format is invalid", async () => {
    const res = await request(buildApp())
      .post("/customers")
      .send({ name: "Bob", email: "not-an-email", phone: "0700000000", address: "456 Test Ave" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when phone is missing", async () => {
    const res = await request(buildApp())
      .post("/customers")
      .send({ name: "Bob", email: "bob@example.com", address: "456 Test Ave" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when address is missing", async () => {
    const res = await request(buildApp())
      .post("/customers")
      .send({ name: "Bob", email: "bob@example.com", phone: "0700000000" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when status is an invalid enum value", async () => {
    const res = await request(buildApp())
      .post("/customers")
      .send({ name: "Bob", email: "bob@example.com", phone: "0700000000", address: "456 Test Ave", status: "unknown" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });
});

describe("PATCH /customers/:id — validation", () => {
  it("returns 400 when status is an invalid enum value", async () => {
    const res = await request(buildApp())
      .patch("/customers/1")
      .send({ status: "vip" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when email format is invalid", async () => {
    const res = await request(buildApp())
      .patch("/customers/1")
      .send({ email: "bad-email" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });
});

describe("PATCH /customers/:id", () => {
  it("updates a customer and returns the updated record (admin)", async () => {
    const updated = { ...sampleCustomer, name: "Alice Updated", status: "suspended" };
    mockExec.mockResolvedValueOnce([sampleCustomer]).mockResolvedValueOnce([updated]);

    const res = await request(buildApp())
      .patch("/customers/1")
      .send({ name: "Alice Updated", status: "suspended" });

    expect(res.status).toBe(200);
  });

  it("returns 404 when updating a nonexistent customer", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp()).patch("/customers/999").send({ name: "Ghost" });

    expect(res.status).toBe(404);
  });
});

describe("DELETE /customers/:id", () => {
  it("deletes a customer and returns 204 (admin)", async () => {
    mockExec.mockResolvedValueOnce([sampleCustomer]); // select before
    mockExec.mockResolvedValueOnce([]);               // tickets select
    mockExec.mockResolvedValueOnce([]);               // invoices select
    mockExec.mockResolvedValueOnce([]);               // delete subscriptions
    mockExec.mockResolvedValueOnce([]);               // delete customers

    const res = await request(buildApp()).delete("/customers/1");

    expect(res.status).toBe(204);
  });

  it("returns 403 for billing role on DELETE", async () => {
    const res = await request(buildApp({ id: "u4", email: "billing@test.com", name: "Billing", role: "billing", active: true, emailVerified: false, createdAt: new Date(), updatedAt: new Date() })).delete(
      "/customers/1",
    );

    expect(res.status).toBe(403);
  });
});

describe("Audit log — customers", () => {
  it("writes an audit record with entityType 'customer' and action 'create' on POST /customers", async () => {
    const created = { ...sampleCustomer, id: 2 };
    mockExec.mockResolvedValueOnce([created]);

    await request(buildApp())
      .post("/customers")
      .send({ name: "Bob Omondi", email: "bob@example.com", phone: "0700000000", address: "456 Test Ave" });

    expect(vi.mocked(writeAuditLog)).toHaveBeenCalledOnce();
    expect(vi.mocked(writeAuditLog)).toHaveBeenCalledWith(
      expect.objectContaining({
        action:     "create",
        entityType: "customer",
        entityId:   2,
        userId:     "u1",
      }),
    );
  });

  it("writes an audit record with entityType 'customer' and action 'update' on PATCH /customers/:id", async () => {
    const updated = { ...sampleCustomer, name: "Alice Updated" };
    mockExec
      .mockResolvedValueOnce([sampleCustomer])
      .mockResolvedValueOnce([updated]);

    await request(buildApp())
      .patch("/customers/1")
      .send({ name: "Alice Updated" });

    expect(vi.mocked(writeAuditLog)).toHaveBeenCalledOnce();
    expect(vi.mocked(writeAuditLog)).toHaveBeenCalledWith(
      expect.objectContaining({
        action:     "update",
        entityType: "customer",
        entityId:   1,
        userId:     "u1",
      }),
    );
  });

  it("writes an audit record with entityType 'customer' and action 'delete' on DELETE /customers/:id", async () => {
    mockExec.mockResolvedValueOnce([sampleCustomer]); // select before
    mockExec.mockResolvedValueOnce([]);               // tickets select
    mockExec.mockResolvedValueOnce([]);               // invoices select
    mockExec.mockResolvedValueOnce([]);               // delete subscriptions
    mockExec.mockResolvedValueOnce([]);               // delete customers

    await request(buildApp()).delete("/customers/1");

    expect(vi.mocked(writeAuditLog)).toHaveBeenCalledOnce();
    expect(vi.mocked(writeAuditLog)).toHaveBeenCalledWith(
      expect.objectContaining({
        action:     "delete",
        entityType: "customer",
        entityId:   1,
        userId:     "u1",
      }),
    );
  });

  it("does NOT write an audit record when POST /customers fails validation", async () => {
    await request(buildApp())
      .post("/customers")
      .send({ email: "bob@example.com", phone: "0700000000", address: "456 Test Ave" });

    expect(vi.mocked(writeAuditLog)).not.toHaveBeenCalled();
  });

  it("does NOT write an audit record when PATCH /customers/:id returns 404", async () => {
    mockExec.mockResolvedValueOnce([]);

    await request(buildApp())
      .patch("/customers/999")
      .send({ name: "Ghost" });

    expect(vi.mocked(writeAuditLog)).not.toHaveBeenCalled();
  });
});
