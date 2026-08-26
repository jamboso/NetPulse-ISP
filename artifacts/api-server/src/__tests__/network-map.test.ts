import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";

const mockExec = vi.hoisted(() => vi.fn());
const NO_COMPANY_SCOPE_MARKER = vi.hoisted(() => Symbol("NO_COMPANY_SCOPE"));

vi.mock("@workspace/db", () => {
  const chain: Record<string, unknown> = {};
  for (const method of [
    "select", "insert", "update", "delete", "from", "where", "orderBy",
    "values", "set", "leftJoin",
  ]) {
    chain[method] = () => chain;
  }
  chain.returning = () => Promise.resolve(mockExec());
  chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(mockExec()).then(resolve, reject);
  return {
    db: chain,
    customersTable: {
      id: {}, name: {}, phone: {}, address: {}, status: {},
      latitude: {}, longitude: {}, companyId: {},
    },
    subscriptionsTable: { customerId: {}, id: {}, pppoeUsername: {}, planId: {}, status: {}, routerId: {} },
    plansTable: { id: {}, name: {}, price: {} },
    sessionLogsTable: { subscriptionId: {}, ipAddress: {}, macAddress: {}, sessionStart: {}, sessionEnd: {}, bytesIn: {}, bytesOut: {}, routerName: {} },
    routersTable: { id: {}, name: {}, companyId: {} },
    splittersTable: {
      id: {}, name: {}, description: {}, latitude: {}, longitude: {},
      routerId: {}, capacity: {}, location: {}, fiberColor: {}, companyId: {},
    },
  };
});

vi.mock("../middlewares/companyScope.js", () => ({
  resolveCompanyScope: (req: Request, _res: Response, next: NextFunction) => next(),
  NO_COMPANY_SCOPE: NO_COMPANY_SCOPE_MARKER,
}));

const { default: networkMapRouter } = await import("../routes/network-map.js");

function buildApp(companyId: number | null = 12) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).companyId = companyId;
    next();
  });
  app.use(networkMapRouter);
  return app;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("GET /network-map — unscoped owner exposure prevention", () => {
  it("returns no clients or splitters for an owner who has not selected a company", async () => {
    const response = await request(buildApp(null)).get("/network-map");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ clients: [], splitters: [] });
    expect(mockExec).not.toHaveBeenCalled();
  });

  it("returns customers scoped to the selected company", async () => {
    mockExec
      .mockResolvedValueOnce([{ id: 1, name: "Jane", phone: "1", address: "A", status: "active", latitude: 1, longitude: 2 }])
      .mockResolvedValueOnce([]) // subs
      .mockResolvedValueOnce([]) // plans
      .mockResolvedValueOnce([]) // open sessions
      .mockResolvedValueOnce([]); // splitters

    const response = await request(buildApp(12)).get("/network-map");

    expect(response.status).toBe(200);
    expect(response.body.clients).toHaveLength(1);
    expect(response.body.clients[0].name).toBe("Jane");
  });
});

describe("GET /splitters — unscoped owner exposure prevention", () => {
  it("returns an empty list for an owner who has not selected a company", async () => {
    const response = await request(buildApp(null)).get("/splitters");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    expect(mockExec).not.toHaveBeenCalled();
  });

  it("returns splitters scoped to the selected company", async () => {
    mockExec.mockResolvedValueOnce([
      { s: { id: 1, name: "Splitter A", companyId: 12 }, routerName: "Edge" },
    ]);

    const response = await request(buildApp(12)).get("/splitters");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([expect.objectContaining({ id: 1, name: "Splitter A", routerName: "Edge" })]);
  });
});

describe("POST /splitters", () => {
  it("rejects creating a splitter when the owner has not selected a company", async () => {
    const response = await request(buildApp(null))
      .post("/splitters")
      .send({ name: "Splitter A" });

    expect(response.status).toBe(403);
    expect(mockExec).not.toHaveBeenCalled();
  });

  it("rejects a routerId that belongs to a different company", async () => {
    mockExec.mockResolvedValueOnce([]); // router lookup finds nothing in this company

    const response = await request(buildApp(12))
      .post("/splitters")
      .send({ name: "Splitter A", routerId: 999 });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("not found in this company");
  });

  it("creates a splitter scoped to the current company", async () => {
    mockExec
      .mockResolvedValueOnce([{ id: 5 }]) // router lookup — same company
      .mockResolvedValueOnce([{ id: 1, name: "Splitter A", companyId: 12, routerId: 5 }]); // insert

    const response = await request(buildApp(12))
      .post("/splitters")
      .send({ name: "Splitter A", routerId: 5 });

    expect(response.status).toBe(201);
    expect(response.body.companyId).toBe(12);
  });
});

describe("PATCH /customers/:id/location — unscoped owner exposure prevention", () => {
  it("does not update a customer's location for an owner with no company selected", async () => {
    // The scoped WHERE clause matches nothing, so the update returns no row.
    mockExec.mockResolvedValueOnce([]);

    const response = await request(buildApp(null))
      .patch("/customers/1/location")
      .send({ latitude: 1, longitude: 2 });

    expect(response.status).toBe(404);
  });
});
