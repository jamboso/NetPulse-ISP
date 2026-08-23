import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const mockExec = vi.hoisted(() => vi.fn());

vi.mock("@workspace/db", () => {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "insert", "update", "delete", "from", "where", "orderBy", "values", "set", "limit"]) {
    chain[method] = () => chain;
  }
  chain.returning = () => Promise.resolve(mockExec());
  chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(mockExec()).then(resolve, reject);
  return {
    db: chain,
    routersTable: { id: {}, ipAddress: {}, apiSsl: {}, username: {}, password: {} },
    hotspotPackagesTable: { id: {}, routerId: {}, sortOrder: {}, createdAt: {} },
    hotspotVouchersTable: { routerId: {}, createdAt: {} },
  };
});

const { default: hotspotRouter } = await import("../routes/hotspot-admin.js");

const routerRecord = {
  id: 7,
  ipAddress: "192.0.2.7",
  apiSsl: false,
  username: "api-user",
  password: "api-pass",
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(hotspotRouter);
  return app;
}

function rosResponse(body: unknown, status = 200) {
  return new Response(body === null ? "" : JSON.stringify(body), { status });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", vi.fn());
});

describe("hotspot RouterOS session management", () => {
  it("lists active hotspot sessions from the selected router", async () => {
    mockExec.mockResolvedValueOnce([routerRecord]);
    vi.mocked(fetch).mockResolvedValueOnce(rosResponse([{ ".id": "*A", user: "guest" }]));

    const response = await request(buildApp()).get("/routers/7/ros/hotspot/active");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ ".id": "*A", user: "guest" }]);
    expect(fetch).toHaveBeenCalledWith(
      "http://192.0.2.7/rest/ip/hotspot/active",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("kicks an active session and reports RouterOS errors safely", async () => {
    mockExec.mockResolvedValueOnce([routerRecord]);
    vi.mocked(fetch).mockResolvedValueOnce(rosResponse(null));

    const response = await request(buildApp()).delete("/routers/7/ros/hotspot/active/*A");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
    expect(fetch).toHaveBeenCalledWith(
      "http://192.0.2.7/rest/ip/hotspot/active/*A",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("returns a gateway error when RouterOS cannot list sessions", async () => {
    mockExec.mockResolvedValueOnce([routerRecord]);
    vi.mocked(fetch).mockResolvedValueOnce(rosResponse({ error: "offline" }, 503));

    const response = await request(buildApp()).get("/routers/7/ros/hotspot/active");

    expect(response.status).toBe(502);
    expect(response.body.error).toContain("RouterOS HTTP 503");
  });
});

describe("hotspot plan assignment", () => {
  it("lists packages assigned to a router", async () => {
    mockExec.mockResolvedValueOnce([{ id: 4, routerId: 7, name: "One hour" }]);

    const response = await request(buildApp()).get("/routers/7/hotspot/packages");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ id: 4, routerId: 7, name: "One hour" }]);
  });

  it("creates a package with the router it belongs to", async () => {
    const packageRecord = { id: 4, routerId: 7, name: "One hour", durationMinutes: 60, price: "20.00", currency: "KES" };
    mockExec.mockResolvedValueOnce([packageRecord]);

    const response = await request(buildApp())
      .post("/routers/7/hotspot/packages")
      .send({ name: "One hour", durationMinutes: 60, price: "20.00" });

    expect(response.status).toBe(201);
    expect(response.body).toEqual(packageRecord);
  });

  it("rejects packages without the fields required for a plan assignment", async () => {
    const response = await request(buildApp())
      .post("/routers/7/hotspot/packages")
      .send({ name: "Incomplete", durationMinutes: 60 });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("price");
  });

  it("returns 404 when a package to update no longer exists", async () => {
    mockExec.mockResolvedValueOnce([]);

    const response = await request(buildApp())
      .patch("/routers/7/hotspot/packages/99")
      .send({ price: "30.00" });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Package not found" });
  });

  it("updates and removes assigned packages", async () => {
    mockExec.mockResolvedValueOnce([{ id: 4, routerId: 7, name: "One hour", price: "30.00" }]);

    const updated = await request(buildApp())
      .patch("/routers/7/hotspot/packages/4")
      .send({ price: "30.00" });
    const deleted = await request(buildApp()).delete("/routers/7/hotspot/packages/4");

    expect(updated.status).toBe(200);
    expect(updated.body.price).toBe("30.00");
    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ success: true });
  });
});

describe("hotspot MAC-bound users", () => {
  it("removes a MAC-bound RouterOS hotspot user", async () => {
    mockExec.mockResolvedValueOnce([routerRecord]);
    vi.mocked(fetch).mockResolvedValueOnce(rosResponse(null));

    const response = await request(buildApp()).delete("/routers/7/ros/hotspot/users/*MAC1");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
    expect(fetch).toHaveBeenCalledWith(
      "http://192.0.2.7/rest/ip/hotspot/user/*MAC1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("rejects setup before making router changes when an interface is absent", async () => {
    mockExec.mockResolvedValueOnce([routerRecord]);

    const response = await request(buildApp()).post("/routers/7/ros/hotspot/setup").send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("interface");
    expect(fetch).not.toHaveBeenCalled();
  });
});