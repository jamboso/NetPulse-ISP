import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

const mockExec = vi.hoisted(() => vi.fn());
const mockPurge = vi.hoisted(() => vi.fn());

vi.mock("@workspace/db", () => {
  const chain: Record<string, unknown> = {};
  const chainMethods = [
    "select",
    "from",
    "where",
    "orderBy",
    "limit",
    "offset",
    "$dynamic",
  ];
  for (const m of chainMethods) {
    chain[m] = () => chain;
  }
  chain["then"] = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    mockExec().then(resolve, reject);
  chain["catch"] = (reject: (e: unknown) => unknown) => mockExec().catch(reject);

  return {
    db: chain,
    auditLogsTable: {
      id: {},
      userId: {},
      userEmail: {},
      action: {},
      entityType: {},
      entityId: {},
      diff: {},
      createdAt: {},
    },
    auditPurgeLogTable: {
      id: {},
      purgedAt: {},
      deletedCount: {},
      triggeredBy: {},
    },
    eq: vi.fn(),
    and: vi.fn((...conds: unknown[]) => conds),
    gte: vi.fn(),
    lte: vi.fn(),
    desc: vi.fn(),
    ilike: vi.fn(),
  };
});

vi.mock("../lib/auditLogPurge.js", () => ({
  purgeAuditLogs: mockPurge,
}));

const { default: auditLogsRouter } = await import("../routes/audit-logs.js");

type MockUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const adminUser: MockUser = {
  id: "u1", email: "admin@test.com", name: "Admin", role: "admin",
  active: true, emailVerified: false, createdAt: new Date(), updatedAt: new Date(),
};

const billingUser: MockUser = {
  id: "u2", email: "billing@test.com", name: "Billing", role: "billing",
  active: true, emailVerified: false, createdAt: new Date(), updatedAt: new Date(),
};

function buildApp(user: MockUser = adminUser) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { user: MockUser }).user = user;
    next();
  });
  app.use(auditLogsRouter);
  return app;
}

const sampleLog = {
  id: 1,
  userId: "u1",
  userEmail: "admin@test.com",
  action: "create",
  entityType: "customer",
  entityId: 42,
  diff: { name: "Alice" },
  createdAt: new Date().toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// GET /audit-logs
// ---------------------------------------------------------------------------

describe("GET /audit-logs", () => {
  it("returns paginated audit log list (admin)", async () => {
    mockExec.mockResolvedValueOnce([sampleLog]);

    const res = await request(buildApp()).get("/audit-logs");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("data");
    expect(res.body).toHaveProperty("page", 1);
    expect(res.body).toHaveProperty("limit", 50);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("returns 403 for non-admin role", async () => {
    const res = await request(buildApp(billingUser)).get("/audit-logs");

    expect(res.status).toBe(403);
  });

  it("respects page and limit query params", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp()).get("/audit-logs?page=2&limit=10");

    expect(res.status).toBe(200);
    expect(res.body.page).toBe(2);
    expect(res.body.limit).toBe(10);
  });

  it("clamps limit to 200 max", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp()).get("/audit-logs?limit=9999");

    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(200);
  });

  it("defaults to page 1 limit 50", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp()).get("/audit-logs");

    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(50);
  });

  it("accepts entityType filter without error", async () => {
    mockExec.mockResolvedValueOnce([sampleLog]);

    const res = await request(buildApp()).get("/audit-logs?entityType=customer");

    expect(res.status).toBe(200);
  });

  it("accepts multiple filters combined", async () => {
    mockExec.mockResolvedValueOnce([sampleLog]);

    const res = await request(buildApp()).get(
      "/audit-logs?entityType=customer&action=create&userId=u1",
    );

    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// GET /audit-logs/export.csv
// ---------------------------------------------------------------------------

describe("GET /audit-logs/export.csv", () => {
  it("returns CSV content-type (admin)", async () => {
    mockExec.mockResolvedValueOnce([sampleLog]);

    const res = await request(buildApp()).get("/audit-logs/export.csv");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
  });

  it("returns 403 for non-admin role", async () => {
    const res = await request(buildApp(billingUser)).get("/audit-logs/export.csv");

    expect(res.status).toBe(403);
  });

  it("returns CSV with header row", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp()).get("/audit-logs/export.csv");

    expect(res.status).toBe(200);
    expect(res.text).toContain("Timestamp");
    expect(res.text).toContain("User Email");
    expect(res.text).toContain("Action");
  });

  it("includes a data row for each log entry", async () => {
    mockExec.mockResolvedValueOnce([sampleLog]);

    const res = await request(buildApp()).get("/audit-logs/export.csv");

    expect(res.text).toContain("admin@test.com");
    expect(res.text).toContain("create");
  });

  it("renders diff with before/after structure in CSV", async () => {
    const logWithDiff = {
      ...sampleLog,
      diff: { before: { status: "active" }, after: { status: "suspended" } },
    };
    mockExec.mockResolvedValueOnce([logWithDiff]);

    const res = await request(buildApp()).get("/audit-logs/export.csv");

    expect(res.status).toBe(200);
    expect(res.text).toContain("status");
  });

  it("renders null diff as empty string in CSV", async () => {
    const logNullDiff = { ...sampleLog, diff: null };
    mockExec.mockResolvedValueOnce([logNullDiff]);

    const res = await request(buildApp()).get("/audit-logs/export.csv");

    expect(res.status).toBe(200);
  });

  it("renders primitive diff value in CSV", async () => {
    const logPrimitiveDiff = { ...sampleLog, diff: "simple string" };
    mockExec.mockResolvedValueOnce([logPrimitiveDiff]);

    const res = await request(buildApp()).get("/audit-logs/export.csv");

    expect(res.status).toBe(200);
    expect(res.text).toContain("simple string");
  });

  it("sets Content-Disposition attachment header", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp()).get("/audit-logs/export.csv");

    expect(res.headers["content-disposition"]).toMatch(/attachment/);
    expect(res.headers["content-disposition"]).toMatch(/audit-log/);
  });

  it("accepts entityType filter in CSV export", async () => {
    mockExec.mockResolvedValueOnce([sampleLog]);

    const res = await request(buildApp()).get("/audit-logs/export.csv?entityType=customer");

    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// GET /audit-logs/purge-history
// ---------------------------------------------------------------------------

describe("GET /audit-logs/purge-history", () => {
  it("returns purge history (admin)", async () => {
    const purgeRow = { id: 1, purgedAt: new Date().toISOString(), deletedCount: 100, triggeredBy: "manual" };
    mockExec.mockResolvedValueOnce([purgeRow]);

    const res = await request(buildApp()).get("/audit-logs/purge-history");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("data");
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("returns 403 for non-admin role", async () => {
    const res = await request(buildApp(billingUser)).get("/audit-logs/purge-history");

    expect(res.status).toBe(403);
  });

  it("returns empty data array when no history exists", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp()).get("/audit-logs/purge-history");

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// POST /audit-logs/purge
// ---------------------------------------------------------------------------

describe("POST /audit-logs/purge", () => {
  it("runs purge and returns deleted count (admin)", async () => {
    mockPurge.mockResolvedValueOnce(250);

    const res = await request(buildApp()).post("/audit-logs/purge");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("deleted", 250);
    expect(mockPurge).toHaveBeenCalledWith("manual");
  });

  it("returns 403 for non-admin role", async () => {
    const res = await request(buildApp(billingUser)).post("/audit-logs/purge");

    expect(res.status).toBe(403);
    expect(mockPurge).not.toHaveBeenCalled();
  });

  it("returns 0 when no records were purged", async () => {
    mockPurge.mockResolvedValueOnce(0);

    const res = await request(buildApp()).post("/audit-logs/purge");

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(0);
  });
});
