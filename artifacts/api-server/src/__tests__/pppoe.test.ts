import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const mockExec = vi.hoisted(() => vi.fn());

vi.mock("@workspace/db", () => {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "from", "where"]) chain[method] = () => chain;
  chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(mockExec()).then(resolve, reject);
  return {
    db: chain,
    routersTable: { id: {}, radiusSecret: {}, radiusPort: {} },
    settingsTable: { key: {}, value: {} },
  };
});

const pppoe = await import("../routes/pppoe.js");

const routerRecord = {
  id: 3,
  ipAddress: "198.51.100.3",
  apiSsl: false,
  username: "admin",
  password: "password",
  radiusSecret: "router-secret",
  radiusPort: 18120,
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(pppoe.default);
  return app;
}

function rosResponse(body: unknown, status = 200) {
  return new Response(body === null ? "" : JSON.stringify(body), { status });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", vi.fn());
});

describe("PPPoE RouterOS helpers", () => {
  it("updates an existing RouterOS object instead of creating a duplicate", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(rosResponse([{ ".id": "*1" }]))
      .mockResolvedValueOnce(rosResponse({ ".id": "*1", name: "basic" }));

    await pppoe.upsertRos(
      "198.51.100.3", false, "admin", "password",
      "/ppp/profile", { name: "basic" }, { "rate-limit": "1m/2m" },
    );

    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "http://198.51.100.3/rest/ppp/profile/*1",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("prefers a router-specific RADIUS secret and port", async () => {
    mockExec.mockResolvedValueOnce([{ value: "radius.example.test" }]);

    await expect(pppoe.getRadiusConfig(routerRecord as never)).resolves.toEqual({
      server: "radius.example.test",
      secret: "router-secret",
      authPort: 18120,
      acctPort: 18121,
    });
  });
});

describe("PPPoE management routes", () => {
  it("rejects setup when its required server interface is absent", async () => {
    mockExec.mockResolvedValueOnce([routerRecord]);

    const response = await request(buildApp()).post("/routers/3/ros/pppoe/setup").send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("interface");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects an incomplete local secret before calling RouterOS", async () => {
    mockExec.mockResolvedValueOnce([routerRecord]);

    const response = await request(buildApp()).post("/routers/3/ros/pppoe/secrets").send({ name: "alice" });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("password");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("creates a local PPPoE secret with predictable RouterOS defaults", async () => {
    mockExec.mockResolvedValueOnce([routerRecord]);
    vi.mocked(fetch).mockResolvedValueOnce(rosResponse({ ".id": "*2", name: "alice" }));

    const response = await request(buildApp())
      .post("/routers/3/ros/pppoe/secrets")
      .send({ name: "alice", password: "s3cret" });

    expect(response.status).toBe(201);
    expect(fetch).toHaveBeenCalledWith(
      "http://198.51.100.3/rest/ppp/secret",
      expect.objectContaining({
        method: "PUT",
        body: expect.stringContaining('"service":"pppoe"'),
      }),
    );
  });

  it("reports a missing router for active-session operations", async () => {
    mockExec.mockResolvedValueOnce([]);

    const response = await request(buildApp()).delete("/routers/999/ros/pppoe/active/*A");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Router not found" });
  });

  it("returns 404 when profile creation targets a missing router", async () => {
    mockExec.mockResolvedValueOnce([]);

    const response = await request(buildApp())
      .post("/routers/999/ros/pppoe/profiles")
      .send({ name: "business" });

    expect(response.status).toBe(404);
  });
});