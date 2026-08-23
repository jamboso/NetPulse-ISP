import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const mockDbResult = vi.hoisted(() => vi.fn());

vi.mock("@workspace/db", () => {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "from", "where"]) chain[method] = () => chain;
  chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(mockDbResult()).then(resolve, reject);

  return {
    db: chain,
    routersTable: { id: {} },
  };
});

const { default: rosRouter } = await import("../routes/ros.js");

const routerRecord = {
  id: 3,
  routerType: "routeros",
  ipAddress: "198.51.100.3",
  apiSsl: false,
  username: "admin",
  password: "password",
};

function buildApp() {
  const app = express();
  app.use(rosRouter);
  return app;
}

function rosResponse(body: unknown, status = 200) {
  return new Response(body === null ? "" : JSON.stringify(body), { status });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", vi.fn());
});

describe("RouterOS live-data routes", () => {
  it.each([
    ["/routers/3/ros/live"],
    ["/routers/3/ros/traffic"],
  ])("returns 404 without contacting a missing router at %s", async (path) => {
    mockDbResult.mockResolvedValueOnce([]);

    const response = await request(buildApp()).get(path);

    expect(response).toMatchObject({ status: 404, body: { error: "Router not found" } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["/routers/3/ros/live", "RouterOS live data only supported for RouterOS devices"],
    ["/routers/3/ros/traffic", "RouterOS only"],
  ])("rejects non-RouterOS devices at %s", async (path, error) => {
    mockDbResult.mockResolvedValueOnce([{ ...routerRecord, routerType: "juniper" }]);

    const response = await request(buildApp()).get(path);

    expect(response).toMatchObject({ status: 400, body: { error } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("enriches live RouterOS interface and PPPoE data", async () => {
    mockDbResult.mockResolvedValueOnce([routerRecord]);
    vi.mocked(fetch)
      .mockResolvedValueOnce(rosResponse({ name: "edge-3" }))
      .mockResolvedValueOnce(rosResponse({ uptime: "1d" }))
      .mockResolvedValueOnce(rosResponse([
        {
          name: "ether1",
          type: "ether",
          running: "true",
          disabled: "false",
          "tx-byte": "120",
          "rx-byte": "240",
          "tx-packet": "3",
          "rx-packet": "4",
        },
        { name: "<pppoe-alice>", "tx-byte": "500", "rx-byte": "600" },
      ]))
      .mockResolvedValueOnce(rosResponse([
        {
          name: "alice",
          interface: "<pppoe-alice>",
          "bytes-out": "0",
          "bytes-in": "0",
          "packets-out": "7",
          "packets-in": "8",
        },
      ]))
      .mockResolvedValueOnce(rosResponse([{ address: "10.0.0.2" }]))
      .mockResolvedValueOnce(rosResponse([{ address: "10.0.0.1/24" }]))
      .mockResolvedValueOnce(rosResponse([{ name: "alice-limit" }]))
      .mockResolvedValueOnce(rosResponse([{ message: "started" }]))
      .mockResolvedValueOnce(rosResponse([{ "mac-address": "00:11:22:33:44:55" }]))
      .mockResolvedValueOnce(rosResponse([{ name: "upstream" }]))
      .mockResolvedValueOnce(rosResponse([{ address: "10.0.0.254" }]))
      .mockResolvedValueOnce(rosResponse([{ name: "ether1" }]));

    const response = await request(buildApp()).get("/routers/3/ros/live");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      routerId: 3,
      error: null,
      identity: { name: "edge-3" },
      resources: { uptime: "1d" },
      interfaces: expect.arrayContaining([
        expect.objectContaining({
          name: "ether1",
          txBytes: 120,
          rxBytes: 240,
          txPackets: 3,
          rxPackets: 4,
          running: true,
          disabled: false,
          comment: "",
        }),
      ]),
      pppoeActive: expect.arrayContaining([
        expect.objectContaining({
          name: "alice",
          txBytes: 500,
          rxBytes: 600,
          txPackets: 7,
          rxPackets: 8,
        }),
      ]),
      dhcpLeases: [{ address: "10.0.0.2" }],
      bgpPeers: [{ name: "upstream" }],
    });
    expect(response.body.fetchedAt).toEqual(expect.any(String));
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "http://198.51.100.3/rest/system/identity",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Basic YWRtaW46cGFzc3dvcmQ=",
          Accept: "application/json",
        }),
      }),
    );
  });

  it("returns a usable traffic response when the router cannot be reached", async () => {
    mockDbResult.mockResolvedValueOnce([routerRecord]);
    vi.mocked(fetch).mockRejectedValueOnce(new Error("connection refused"));

    const response = await request(buildApp()).get("/routers/3/ros/traffic");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      routerId: 3,
      error: "connection refused",
      interfaces: [],
    });
    expect(response.body.fetchedAt).toEqual(expect.any(String));
  });
});