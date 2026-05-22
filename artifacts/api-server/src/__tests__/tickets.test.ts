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

describe("GET /tickets", () => {
  it("returns a list of tickets", async () => {
    mockExec.mockResolvedValueOnce([{ tickets: sampleTicket, customers: { id: 10, name: "Alice" } }]);

    const res = await request(buildApp()).get("/tickets");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

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
});

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

describe("POST /tickets/:id/reply", () => {
  it("creates a reply and returns 201", async () => {
    mockExec.mockResolvedValueOnce([sampleReply]).mockResolvedValueOnce([]);

    const res = await request(buildApp())
      .post("/tickets/1/reply")
      .send({ message: "We are looking into it", author: "Staff Name", isStaff: true });

    expect(res.status).toBe(201);
    expect(res.body.message).toBe("We are looking into it");
    expect(res.body.isStaff).toBe(true);
  });
});

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
