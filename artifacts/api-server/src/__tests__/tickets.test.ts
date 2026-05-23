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
    ticketsTable: {
      id: {},
      customerId: {},
      subject: {},
      description: {},
      status: {},
      priority: {},
      category: {},
      assignedTo: {},
      resolvedAt: {},
      createdAt: {},
    },
    ticketRepliesTable: {
      id: {},
      ticketId: {},
      message: {},
      author: {},
      isStaff: {},
      createdAt: {},
    },
    customersTable: { id: {}, name: {}, email: {} },
    eq: vi.fn(),
  };
});

const { default: ticketsRouter } = await import("../routes/tickets.js");

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

const adminUser: MockUser = {
  id: "u1", email: "admin@test.com", name: "Admin", role: "admin",
  active: true, emailVerified: false, createdAt: new Date(), updatedAt: new Date(),
};

const supportUser: MockUser = {
  id: "u2", email: "support@test.com", name: "Support", role: "support",
  active: true, emailVerified: false, createdAt: new Date(), updatedAt: new Date(),
};

const billingUser: MockUser = {
  id: "u3", email: "billing@test.com", name: "Billing", role: "billing",
  active: true, emailVerified: false, createdAt: new Date(), updatedAt: new Date(),
};

const technicianUser: MockUser = {
  id: "u4", email: "tech@test.com", name: "Tech", role: "technician",
  active: true, emailVerified: false, createdAt: new Date(), updatedAt: new Date(),
};

function buildApp(user: MockUser = adminUser) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { user: MockUser }).user = user;
    next();
  });
  app.use(ticketsRouter);
  return app;
}

const sampleTicket = {
  id: 1,
  customerId: 10,
  subject: "Internet down",
  description: "No connection since morning",
  status: "open",
  priority: "medium",
  category: null,
  assignedTo: null,
  resolvedAt: null,
  createdAt: new Date().toISOString(),
};

const sampleReply = {
  id: 1,
  ticketId: 1,
  message: "We are looking into it",
  author: "Staff Name",
  isStaff: "true",
  createdAt: new Date().toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// GET /tickets — list with pagination
// ---------------------------------------------------------------------------

describe("GET /tickets", () => {
  it("returns paginated ticket list", async () => {
    mockExec.mockResolvedValueOnce([{ tickets: sampleTicket, customers: { id: 10, name: "Alice" } }]);

    const res = await request(buildApp()).get("/tickets");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("data");
    expect(res.body).toHaveProperty("total");
    expect(res.body).toHaveProperty("page");
    expect(res.body).toHaveProperty("limit");
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("defaults to page 1 with limit 20", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp()).get("/tickets");

    expect(res.status).toBe(200);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(20);
  });

  it("respects page and limit query params", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp()).get("/tickets?page=2&limit=5");

    expect(res.status).toBe(200);
    expect(res.body.page).toBe(2);
    expect(res.body.limit).toBe(5);
  });

  it("clamps limit to 100 max", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp()).get("/tickets?limit=9999");

    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(100);
  });

  it("slices results according to pagination", async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      tickets: { ...sampleTicket, id: i + 1 },
      customers: null,
    }));
    mockExec.mockResolvedValueOnce(rows);

    const res = await request(buildApp()).get("/tickets?page=1&limit=2");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.total).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// GET /tickets — filters
// ---------------------------------------------------------------------------

describe("GET /tickets — filters", () => {
  it("filters by customerId", async () => {
    mockExec.mockResolvedValueOnce([
      { tickets: { ...sampleTicket, customerId: 10 }, customers: { id: 10, name: "Alice" } },
      { tickets: { ...sampleTicket, id: 2, customerId: 99 }, customers: null },
    ]);

    const res = await request(buildApp()).get("/tickets?customerId=10");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].customerId).toBe(10);
  });

  it("filters by status", async () => {
    mockExec.mockResolvedValueOnce([
      { tickets: { ...sampleTicket, status: "open" }, customers: null },
      { tickets: { ...sampleTicket, id: 2, status: "closed" }, customers: null },
    ]);

    const res = await request(buildApp()).get("/tickets?status=open");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].status).toBe("open");
  });

  it("filters by priority", async () => {
    mockExec.mockResolvedValueOnce([
      { tickets: { ...sampleTicket, priority: "high" }, customers: null },
      { tickets: { ...sampleTicket, id: 2, priority: "low" }, customers: null },
    ]);

    const res = await request(buildApp()).get("/tickets?priority=high");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].priority).toBe("high");
  });

  it("returns empty data when no tickets match combined filters", async () => {
    mockExec.mockResolvedValueOnce([
      { tickets: { ...sampleTicket, customerId: 99, status: "open" }, customers: null },
    ]);

    const res = await request(buildApp()).get("/tickets?customerId=10&status=resolved");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// GET /tickets/:id
// ---------------------------------------------------------------------------

describe("GET /tickets/:id", () => {
  it("returns a single ticket with customer", async () => {
    mockExec.mockResolvedValueOnce([
      { tickets: sampleTicket, customers: { id: 10, name: "Alice" } },
    ]);

    const res = await request(buildApp()).get("/tickets/1");

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(1);
    expect(res.body.subject).toBe("Internet down");
    expect(res.body.customer).toHaveProperty("name", "Alice");
  });

  it("returns null customer when no customer is joined", async () => {
    mockExec.mockResolvedValueOnce([{ tickets: sampleTicket, customers: null }]);

    const res = await request(buildApp()).get("/tickets/1");

    expect(res.status).toBe(200);
    expect(res.body.customer).toBeNull();
  });

  it("returns 404 when ticket does not exist", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp()).get("/tickets/999");

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });
});

// ---------------------------------------------------------------------------
// POST /tickets
// ---------------------------------------------------------------------------

describe("POST /tickets", () => {
  it("creates a ticket and returns 201", async () => {
    mockExec.mockResolvedValueOnce([sampleTicket]);

    const res = await request(buildApp())
      .post("/tickets")
      .send({ customerId: 10, subject: "Internet down", description: "No connection since morning" });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(1);
    expect(res.body.subject).toBe("Internet down");
  });

  it("allows support role to create a ticket", async () => {
    mockExec.mockResolvedValueOnce([sampleTicket]);

    const res = await request(buildApp(supportUser))
      .post("/tickets")
      .send({ customerId: 10, subject: "Internet down", description: "No connection" });

    expect(res.status).toBe(201);
  });

  it("allows billing role to create a ticket", async () => {
    mockExec.mockResolvedValueOnce([sampleTicket]);

    const res = await request(buildApp(billingUser))
      .post("/tickets")
      .send({ customerId: 10, subject: "Billing issue", description: "Overcharged" });

    expect(res.status).toBe(201);
  });

  it("returns 403 for technician role", async () => {
    const res = await request(buildApp(technicianUser))
      .post("/tickets")
      .send({ customerId: 10, subject: "Internet down", description: "No connection" });

    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// POST /tickets — validation
// ---------------------------------------------------------------------------

describe("POST /tickets — validation", () => {
  it("returns 400 when customerId is missing", async () => {
    const res = await request(buildApp())
      .post("/tickets")
      .send({ subject: "Internet down", description: "No connection" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when subject is missing", async () => {
    const res = await request(buildApp())
      .post("/tickets")
      .send({ customerId: 10, description: "No connection" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when description is missing", async () => {
    const res = await request(buildApp())
      .post("/tickets")
      .send({ customerId: 10, subject: "Internet down" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when customerId is not a number", async () => {
    const res = await request(buildApp())
      .post("/tickets")
      .send({ customerId: "ten", subject: "Internet down", description: "No connection" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when customerId is not a positive integer", async () => {
    const res = await request(buildApp())
      .post("/tickets")
      .send({ customerId: 0, subject: "Internet down", description: "No connection" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when status is an invalid enum value", async () => {
    const res = await request(buildApp())
      .post("/tickets")
      .send({ customerId: 10, subject: "Internet down", description: "No connection", status: "pending" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when priority is an invalid enum value", async () => {
    const res = await request(buildApp())
      .post("/tickets")
      .send({ customerId: 10, subject: "Internet down", description: "No connection", priority: "critical" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when subject is an empty string", async () => {
    const res = await request(buildApp())
      .post("/tickets")
      .send({ customerId: 10, subject: "", description: "No connection" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });
});

// ---------------------------------------------------------------------------
// PATCH /tickets/:id
// ---------------------------------------------------------------------------

describe("PATCH /tickets/:id", () => {
  it("updates a ticket and returns 200", async () => {
    const updated = { ...sampleTicket, status: "resolved" };
    mockExec.mockResolvedValueOnce([updated]);

    const res = await request(buildApp())
      .patch("/tickets/1")
      .send({ status: "resolved" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("resolved");
  });

  it("returns 404 when ticket does not exist", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp())
      .patch("/tickets/999")
      .send({ status: "resolved" });

    expect(res.status).toBe(404);
  });

  it("returns 403 for technician role", async () => {
    const res = await request(buildApp(technicianUser))
      .patch("/tickets/1")
      .send({ status: "closed" });

    expect(res.status).toBe(403);
  });

  it("auto-sets resolvedAt when status is changed to resolved", async () => {
    const updated = { ...sampleTicket, status: "resolved", resolvedAt: new Date().toISOString() };
    mockExec.mockResolvedValueOnce([updated]);

    const res = await request(buildApp())
      .patch("/tickets/1")
      .send({ status: "resolved" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("resolved");
    expect(res.body.resolvedAt).not.toBeNull();
  });

  it("closes a ticket (status: closed)", async () => {
    const updated = { ...sampleTicket, status: "closed" };
    mockExec.mockResolvedValueOnce([updated]);

    const res = await request(buildApp())
      .patch("/tickets/1")
      .send({ status: "closed" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("closed");
  });

  it("reopens a resolved ticket (status: open)", async () => {
    const updated = { ...sampleTicket, status: "open", resolvedAt: null };
    mockExec.mockResolvedValueOnce([updated]);

    const res = await request(buildApp())
      .patch("/tickets/1")
      .send({ status: "open" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("open");
  });
});

// ---------------------------------------------------------------------------
// PATCH /tickets/:id — validation
// ---------------------------------------------------------------------------

describe("PATCH /tickets/:id — field updates", () => {
  it("updates subject and description fields", async () => {
    const updated = { ...sampleTicket, subject: "New subject", description: "New description" };
    mockExec.mockResolvedValueOnce([updated]);

    const res = await request(buildApp())
      .patch("/tickets/1")
      .send({ subject: "New subject", description: "New description" });

    expect(res.status).toBe(200);
    expect(res.body.subject).toBe("New subject");
    expect(res.body.description).toBe("New description");
  });

  it("updates priority field", async () => {
    const updated = { ...sampleTicket, priority: "high" };
    mockExec.mockResolvedValueOnce([updated]);

    const res = await request(buildApp())
      .patch("/tickets/1")
      .send({ priority: "high" });

    expect(res.status).toBe(200);
    expect(res.body.priority).toBe("high");
  });

  it("updates category and assignedTo fields", async () => {
    const updated = { ...sampleTicket, category: "billing", assignedTo: "agent1" };
    mockExec.mockResolvedValueOnce([updated]);

    const res = await request(buildApp())
      .patch("/tickets/1")
      .send({ category: "billing", assignedTo: "agent1" });

    expect(res.status).toBe(200);
    expect(res.body.category).toBe("billing");
    expect(res.body.assignedTo).toBe("agent1");
  });

  it("updates resolvedAt field explicitly", async () => {
    const resolvedAt = new Date().toISOString();
    const updated = { ...sampleTicket, resolvedAt };
    mockExec.mockResolvedValueOnce([updated]);

    const res = await request(buildApp())
      .patch("/tickets/1")
      .send({ resolvedAt });

    expect(res.status).toBe(200);
    expect(res.body.resolvedAt).toBe(resolvedAt);
  });

  it("clears category and assignedTo with null", async () => {
    const updated = { ...sampleTicket, category: null, assignedTo: null };
    mockExec.mockResolvedValueOnce([updated]);

    const res = await request(buildApp())
      .patch("/tickets/1")
      .send({ category: null, assignedTo: null });

    expect(res.status).toBe(200);
    expect(res.body.category).toBeNull();
    expect(res.body.assignedTo).toBeNull();
  });
});

describe("PATCH /tickets/:id — validation", () => {
  it("returns 400 when status is an invalid enum value", async () => {
    const res = await request(buildApp())
      .patch("/tickets/1")
      .send({ status: "pending" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when priority is an invalid enum value", async () => {
    const res = await request(buildApp())
      .patch("/tickets/1")
      .send({ priority: "critical" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when subject is an empty string", async () => {
    const res = await request(buildApp())
      .patch("/tickets/1")
      .send({ subject: "" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });
});

// ---------------------------------------------------------------------------
// DELETE /tickets/:id
// ---------------------------------------------------------------------------

describe("DELETE /tickets/:id", () => {
  it("deletes a ticket and returns 204", async () => {
    mockExec
      .mockResolvedValueOnce([{ id: 1 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete("/tickets/1");

    expect(res.status).toBe(204);
    expect(res.text).toBe("");
  });

  it("returns 404 when ticket does not exist", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete("/tickets/999");

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 403 for support role (admin only)", async () => {
    const res = await request(buildApp(supportUser)).delete("/tickets/1");

    expect(res.status).toBe(403);
  });

  it("returns 403 for billing role (admin only)", async () => {
    const res = await request(buildApp(billingUser)).delete("/tickets/1");

    expect(res.status).toBe(403);
  });

  it("returns 403 for technician role (admin only)", async () => {
    const res = await request(buildApp(technicianUser)).delete("/tickets/1");

    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// POST /tickets/:id/reply
// ---------------------------------------------------------------------------

describe("POST /tickets/:id/reply", () => {
  it("creates a staff reply and returns 201 with isStaff=true", async () => {
    mockExec.mockResolvedValueOnce([sampleReply]).mockResolvedValueOnce([]);

    const res = await request(buildApp())
      .post("/tickets/1/reply")
      .send({ message: "We are looking into it", author: "Staff Name", isStaff: true });

    expect(res.status).toBe(201);
    expect(res.body.message).toBe("We are looking into it");
    expect(res.body.isStaff).toBe(true);
  });

  it("creates a customer reply and returns 201 with isStaff=false", async () => {
    const customerReply = { ...sampleReply, isStaff: "false" };
    mockExec.mockResolvedValueOnce([customerReply]);

    const res = await request(buildApp())
      .post("/tickets/1/reply")
      .send({ message: "Still broken", author: "Customer", isStaff: false });

    expect(res.status).toBe(201);
    expect(res.body.isStaff).toBe(false);
  });

  it("returns 403 for technician role", async () => {
    const res = await request(buildApp(technicianUser))
      .post("/tickets/1/reply")
      .send({ message: "Looking into it", author: "Tech", isStaff: false });

    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// POST /tickets/:id/reply — staff auto-status
// ---------------------------------------------------------------------------

describe("POST /tickets/:id/reply — staff auto-status", () => {
  it("triggers a status update to in_progress when staff replies", async () => {
    mockExec.mockResolvedValueOnce([sampleReply]).mockResolvedValueOnce([]);

    const res = await request(buildApp())
      .post("/tickets/1/reply")
      .send({ message: "We are looking into it", author: "Staff Name", isStaff: true });

    expect(res.status).toBe(201);
    expect(mockExec).toHaveBeenCalledTimes(2);
  });

  it("does not update status when customer replies (isStaff false)", async () => {
    const customerReply = { ...sampleReply, isStaff: "false" };
    mockExec.mockResolvedValueOnce([customerReply]);

    const res = await request(buildApp())
      .post("/tickets/1/reply")
      .send({ message: "Still broken", author: "Customer", isStaff: false });

    expect(res.status).toBe(201);
    expect(res.body.isStaff).toBe(false);
    expect(mockExec).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// POST /tickets/:id/reply — validation
// ---------------------------------------------------------------------------

describe("POST /tickets/:id/reply — validation", () => {
  it("returns 400 when message is missing", async () => {
    const res = await request(buildApp())
      .post("/tickets/1/reply")
      .send({ author: "Staff Name" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when author is missing", async () => {
    const res = await request(buildApp())
      .post("/tickets/1/reply")
      .send({ message: "Looking into it" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when message is an empty string", async () => {
    const res = await request(buildApp())
      .post("/tickets/1/reply")
      .send({ message: "", author: "Staff Name" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when author is an empty string", async () => {
    const res = await request(buildApp())
      .post("/tickets/1/reply")
      .send({ message: "Looking into it", author: "" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });

  it("returns 400 when isStaff is not a boolean", async () => {
    const res = await request(buildApp())
      .post("/tickets/1/reply")
      .send({ message: "Looking into it", author: "Staff", isStaff: "yes" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("fields");
  });
});

// ---------------------------------------------------------------------------
// GET /tickets/:id/replies
// ---------------------------------------------------------------------------

describe("GET /tickets/:id/replies", () => {
  it("returns a list of replies with isStaff as boolean", async () => {
    mockExec.mockResolvedValueOnce([sampleReply]);

    const res = await request(buildApp()).get("/tickets/1/replies");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].isStaff).toBe(true);
  });

  it("coerces isStaff='false' string to boolean false", async () => {
    const customerReply = { ...sampleReply, id: 2, isStaff: "false" };
    mockExec.mockResolvedValueOnce([customerReply]);

    const res = await request(buildApp()).get("/tickets/1/replies");

    expect(res.status).toBe(200);
    expect(res.body[0].isStaff).toBe(false);
  });

  it("returns an empty array when there are no replies", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp()).get("/tickets/1/replies");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });
});
