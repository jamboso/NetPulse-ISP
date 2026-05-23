import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

const mockExec = vi.hoisted(() => vi.fn());
const mockPurge = vi.hoisted(() => vi.fn());
const mockEq = vi.hoisted(() => vi.fn());
const mockGte = vi.hoisted(() => vi.fn());
const mockLte = vi.hoisted(() => vi.fn());
const mockIlike = vi.hoisted(() => vi.fn());
const mockAnd = vi.hoisted(() => vi.fn((...args: unknown[]) => args));
const mockDesc = vi.hoisted(() => vi.fn());

vi.mock("drizzle-orm", () => ({
  eq: mockEq,
  gte: mockGte,
  lte: mockLte,
  and: mockAnd,
  desc: mockDesc,
  ilike: mockIlike,
}));

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
  };
});

vi.mock("../lib/auditLogPurge.js", () => ({
  purgeAuditLogs: mockPurge,
}));

const { default: auditLogsRouter } = await import("../routes/audit-logs.js");
const { auditLogsTable } = await import("@workspace/db");

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

  it("builds eq predicate for entityId filter", async () => {
    mockExec.mockResolvedValueOnce([sampleLog]);

    await request(buildApp()).get("/audit-logs?entityId=42");

    expect(mockEq).toHaveBeenCalledWith(auditLogsTable.entityId, 42);
  });

  it("returns only matching rows when entityId is supplied", async () => {
    const matchingLog = { ...sampleLog, entityId: 42 };
    mockExec.mockResolvedValueOnce([matchingLog]);

    const res = await request(buildApp()).get("/audit-logs?entityId=42");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].entityId).toBe(42);
  });

  it("returns empty data when no rows match the entityId", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp()).get("/audit-logs?entityId=9999");

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it("builds eq predicates for both entityType and entityId when combined", async () => {
    mockExec.mockResolvedValueOnce([sampleLog]);

    await request(buildApp()).get("/audit-logs?entityType=customer&entityId=42");

    expect(mockEq).toHaveBeenCalledWith(auditLogsTable.entityType, "customer");
    expect(mockEq).toHaveBeenCalledWith(auditLogsTable.entityId, 42);
    expect(mockAnd).toHaveBeenCalled();
  });

  it("returns intersection of entityType + entityId filters", async () => {
    const matchingLog = { ...sampleLog, entityType: "customer", entityId: 42 };
    mockExec.mockResolvedValueOnce([matchingLog]);

    const res = await request(buildApp()).get(
      "/audit-logs?entityType=customer&entityId=42",
    );

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].entityType).toBe("customer");
    expect(res.body.data[0].entityId).toBe(42);
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

  it("CSV header row contains all seven required columns", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp()).get("/audit-logs/export.csv");

    expect(res.status).toBe(200);
    const headerLine = res.text.split("\r\n")[0];
    expect(headerLine).toBe("Timestamp,User Email,User ID,Action,Entity Type,Entity ID,Diff Summary");
  });

  it("data row fields match the seeded log values", async () => {
    const ts = "2025-01-15T10:00:00.000Z";
    const log = {
      ...sampleLog,
      userId: "u42",
      userEmail: "ops@acme.com",
      action: "update",
      entityType: "subscription",
      entityId: 99,
      diff: null,
      createdAt: ts,
    };
    mockExec.mockResolvedValueOnce([log]);

    const res = await request(buildApp()).get("/audit-logs/export.csv");

    expect(res.status).toBe(200);
    const lines = res.text.split("\r\n").filter(Boolean);
    expect(lines).toHaveLength(2);

    const dataLine = lines[1];
    expect(dataLine).toContain(ts);
    expect(dataLine).toContain("ops@acme.com");
    expect(dataLine).toContain("u42");
    expect(dataLine).toContain("update");
    expect(dataLine).toContain("subscription");
    expect(dataLine).toContain("99");
  });

  it("multiple seeded rows produce matching number of data lines", async () => {
    const log2 = { ...sampleLog, id: 2, userEmail: "b@test.com", action: "delete", entityId: 7 };
    mockExec.mockResolvedValueOnce([sampleLog, log2]);

    const res = await request(buildApp()).get("/audit-logs/export.csv");

    expect(res.status).toBe(200);
    const dataLines = res.text.split("\r\n").filter(Boolean).slice(1);
    expect(dataLines).toHaveLength(2);
    expect(res.text).toContain("admin@test.com");
    expect(res.text).toContain("b@test.com");
  });

  it("escapes commas in values by wrapping the field in double-quotes", async () => {
    const logWithComma = {
      ...sampleLog,
      diff: { before: { note: "hello, world" }, after: { note: "goodbye" } },
    };
    mockExec.mockResolvedValueOnce([logWithComma]);

    const res = await request(buildApp()).get("/audit-logs/export.csv");

    expect(res.status).toBe(200);
    const dataLine = res.text.split("\r\n").filter(Boolean)[1]!;
    expect(dataLine).toMatch(/^[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,".*"$/);
  });

  it("escapes double-quotes in values by doubling them per RFC 4180", async () => {
    const logWithQuote = {
      ...sampleLog,
      diff: 'he said "hello"',
    };
    mockExec.mockResolvedValueOnce([logWithQuote]);

    const res = await request(buildApp()).get("/audit-logs/export.csv");

    expect(res.status).toBe(200);
    const dataLine = res.text.split("\r\n").filter(Boolean)[1]!;
    expect(dataLine).toContain('"he said ""hello"""');
  });

  it("prefixes formula-injection characters with a single quote", async () => {
    const logWithFormula = {
      ...sampleLog,
      action: "=SUM(A1)",
    };
    mockExec.mockResolvedValueOnce([logWithFormula]);

    const res = await request(buildApp()).get("/audit-logs/export.csv");

    expect(res.status).toBe(200);
    const dataLine = res.text.split("\r\n").filter(Boolean)[1]!;
    const fields = dataLine.split(",");
    expect(fields[3]).toBe("'=SUM(A1)");
  });

  it("diff summary shows before→after only for changed fields", async () => {
    const logDiff = {
      ...sampleLog,
      diff: { before: { status: "active", speed: "10Mbps" }, after: { status: "suspended", speed: "10Mbps" } },
    };
    mockExec.mockResolvedValueOnce([logDiff]);

    const res = await request(buildApp()).get("/audit-logs/export.csv");

    expect(res.status).toBe(200);
    const dataLine = res.text.split("\r\n").filter(Boolean)[1]!;
    expect(dataLine).toContain("status");
    expect(dataLine).toContain("active");
    expect(dataLine).toContain("suspended");
    expect(dataLine).not.toContain("speed");
  });

  it("builds eq predicate for action filter", async () => {
    mockExec.mockResolvedValueOnce([sampleLog]);

    await request(buildApp()).get("/audit-logs/export.csv?action=create");

    expect(mockEq).toHaveBeenCalledWith(auditLogsTable.action, "create");
  });

  it("builds gte/lte predicates for date-range filters", async () => {
    mockExec.mockResolvedValueOnce([sampleLog]);

    await request(buildApp()).get(
      "/audit-logs/export.csv?from=2025-01-01&to=2025-12-31",
    );

    expect(mockGte).toHaveBeenCalledWith(auditLogsTable.createdAt, expect.any(Date));
    expect(mockLte).toHaveBeenCalledWith(auditLogsTable.createdAt, expect.any(Date));
  });

  it("builds predicates for combined filters (entityType + action + from/to)", async () => {
    mockExec.mockResolvedValueOnce([sampleLog]);

    const res = await request(buildApp()).get(
      "/audit-logs/export.csv?entityType=customer&action=create&from=2025-01-01&to=2025-12-31",
    );

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(mockEq).toHaveBeenCalledWith(auditLogsTable.entityType, "customer");
    expect(mockEq).toHaveBeenCalledWith(auditLogsTable.action, "create");
    expect(mockGte).toHaveBeenCalledWith(auditLogsTable.createdAt, expect.any(Date));
    expect(mockLte).toHaveBeenCalledWith(auditLogsTable.createdAt, expect.any(Date));
    expect(mockAnd).toHaveBeenCalled();
  });

  it("builds eq predicate for entityId filter in CSV export", async () => {
    mockExec.mockResolvedValueOnce([sampleLog]);

    await request(buildApp()).get("/audit-logs/export.csv?entityId=42");

    expect(mockEq).toHaveBeenCalledWith(auditLogsTable.entityId, 42);
  });

  it("CSV export with entityId returns only rows for that entity", async () => {
    const matchingLog = { ...sampleLog, entityId: 42 };
    mockExec.mockResolvedValueOnce([matchingLog]);

    const res = await request(buildApp()).get("/audit-logs/export.csv?entityId=42");

    expect(res.status).toBe(200);
    const dataLines = res.text.split("\r\n").filter(Boolean).slice(1);
    expect(dataLines).toHaveLength(1);
    expect(dataLines[0]).toContain("42");
  });

  it("builds eq predicates for entityType + entityId in CSV export", async () => {
    mockExec.mockResolvedValueOnce([sampleLog]);

    await request(buildApp()).get(
      "/audit-logs/export.csv?entityType=customer&entityId=42",
    );

    expect(mockEq).toHaveBeenCalledWith(auditLogsTable.entityType, "customer");
    expect(mockEq).toHaveBeenCalledWith(auditLogsTable.entityId, 42);
    expect(mockAnd).toHaveBeenCalled();
  });

  it("returns empty CSV with only header when no rows match filters", async () => {
    mockExec.mockResolvedValueOnce([]);

    const res = await request(buildApp()).get(
      "/audit-logs/export.csv?entityType=nonexistent",
    );

    expect(res.status).toBe(200);
    const lines = res.text.split("\r\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe("Timestamp,User Email,User ID,Action,Entity Type,Entity ID,Diff Summary");
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
