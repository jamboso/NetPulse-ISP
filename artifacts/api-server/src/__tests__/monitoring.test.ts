import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";

const mockExec = vi.hoisted(() => vi.fn());
const mockDbWhere = vi.hoisted(() => vi.fn());
const mockDbInnerJoin = vi.hoisted(() => vi.fn());

vi.mock("@workspace/db", () => {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "from", "orderBy", "groupBy"]) {
    chain[method] = () => chain;
  }
  chain.where = (...args: unknown[]) => { mockDbWhere(...args); return chain; };
  chain.innerJoin = (...args: unknown[]) => { mockDbInnerJoin(...args); return chain; };
  chain.catch = (reject: (reason: unknown) => unknown) => Promise.resolve(mockExec()).catch(reject);
  chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(mockExec()).then(resolve, reject);
  return {
    db: chain,
    routersTable: {
      id: {}, name: {}, ipAddress: {}, apiSsl: {}, username: {}, password: {},
      enabled: {}, location: {}, routerType: {}, lastSeen: {}, vpnIp: {}, vpnConnected: {}, companyId: {},
    },
    sessionLogsTable: {
      subscriptionId: {}, pppoeUsername: {}, sessionEnd: {}, sessionStart: {}, routerName: {},
    },
    subscriptionsTable: { id: {}, customerId: {}, companyId: {} },
    customersTable: { id: {}, name: {} },
  };
});

// Recursively walks a real drizzle SQL condition tree (built by the actual,
// unmocked eq/and/gte helpers) to confirm it references a specific column
// object together with a specific value — i.e. that tenant scoping is wired
// into the query itself, not bolted on afterwards in application code.
function referencesColumnAndValue(node: unknown, column: unknown, value: unknown, seen = new Set<unknown>()): boolean {
  if (node == null || typeof node !== "object") return false;
  if (seen.has(node)) return false;
  seen.add(node);
  if (Array.isArray(node)) return node.some((item) => referencesColumnAndValue(item, column, value, seen));
  const chunks = (node as { queryChunks?: unknown[] }).queryChunks;
  if (Array.isArray(chunks)) {
    if (chunks.includes(column) && chunks.includes(value)) return true;
    return chunks.some((c) => referencesColumnAndValue(c, column, value, seen));
  }
  return Object.values(node as Record<string, unknown>).some((v) => referencesColumnAndValue(v, column, value, seen));
}

vi.mock("../middlewares/companyScope.js", () => ({
  resolveCompanyScope: (req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock("../lib/routerManagement.js", () => ({
  getRouterManagementHost: () => null,
}));

const { default: monitoringRouter } = await import("../routes/monitoring.js");

function buildApp(companyId: number | null = 12) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).companyId = companyId;
    next();
  });
  app.use(monitoringRouter);
  return app;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("GET /monitoring/overview — unscoped owner exposure prevention", () => {
  it("reports zero routers and no session-derived alerts for an owner with no company selected, without querying session data at all", async () => {
    const response = await request(buildApp(null)).get("/monitoring/overview");

    expect(response.status).toBe(200);
    expect(response.body.summary.totalRouters).toBe(0);
    expect(response.body.routers).toEqual([]);
    expect(response.body.onuEvents).toEqual([]);
    expect(response.body.flappingAccounts).toEqual([]);
    // No company selected means the route must never even issue the
    // session-log queries — there is no router-name allow-list left to trust.
    expect(mockExec).not.toHaveBeenCalled();
  });

  it("scopes the ONU-failure and flapping queries to the selected company via a real subscriptions.company_id join, not router-name matching", async () => {
    mockExec
      .mockResolvedValueOnce([{ // scoped router list
        id: 1, name: "Edge", ipAddress: "10.0.0.1", apiSsl: false, username: "u", password: "p",
        enabled: true, location: null, routerType: "mikrotik", lastSeen: null, vpnIp: null, vpnConnected: false,
      }])
      .mockResolvedValueOnce([ // ONU rows — the DB itself is responsible for scoping these
        { routerName: "Edge", pppoeUsername: "user1", sessionEnd: new Date().toISOString() },
      ])
      .mockResolvedValueOnce([ // flapping candidate rows — same DB-level scoping responsibility
        { subscriptionId: 1, pppoeUsername: "user1", routerName: "Edge", count: 10, lastSeen: new Date().toISOString() },
      ])
      .mockResolvedValueOnce([{ id: 1, customerId: 42 }]) // subscription lookup for flapping join
      .mockResolvedValueOnce([{ id: 42, name: "Jane" }]); // customer lookup for flapping join

    const { subscriptionsTable } = await import("@workspace/db");
    const response = await request(buildApp(12)).get("/monitoring/overview");

    expect(response.status).toBe(200);
    expect(response.body.summary.totalRouters).toBe(1);

    // Both the ONU-failure and flapping detectors must join to subscriptions
    // and filter by this exact company id at the query level — never by
    // matching router-name strings, which are not tenant-unique.
    expect(mockDbInnerJoin).toHaveBeenCalledWith(subscriptionsTable, expect.anything());
    expect(mockDbInnerJoin.mock.calls.filter(([table]) => table === subscriptionsTable).length).toBe(2);

    const scopedWhereCalls = mockDbWhere.mock.calls.filter(([condition]) =>
      referencesColumnAndValue(condition, (subscriptionsTable as { companyId: unknown }).companyId, 12));
    expect(scopedWhereCalls.length).toBe(2); // one for detectOnuFailures, one for detectFlapping
  });
});
