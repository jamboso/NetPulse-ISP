import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("@workspace/db", () => ({ db: {}, eq: vi.fn() }));

const { default: macVendorRouter } = await import("../routes/mac-vendor.js");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(macVendorRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("GET /mac-vendor/:oui", () => {
  it("returns 400 when the OUI is empty or invalid", async () => {
    const res = await request(buildApp()).get("/mac-vendor/%20%20%20");

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns the vendor when upstream lookup succeeds", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("MikroTik", { status: 200 }) as Response,
    );

    const res = await request(buildApp()).get("/mac-vendor/AA-BB-CC");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("vendor", "MikroTik");
  });

  it("returns null vendor when upstream returns non-ok status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Not Found", { status: 404 }) as Response,
    );

    const res = await request(buildApp()).get("/mac-vendor/00-11-22");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("vendor", null);
  });

  it("returns null vendor when upstream fetch throws", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network error"));

    const res = await request(buildApp()).get("/mac-vendor/FF-EE-DD");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("vendor", null);
  });

  it("returns cached result on second request for the same OUI", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("Cisco", { status: 200 }) as Response);

    const app = buildApp();
    await request(app).get("/mac-vendor/CC-DD-EE");
    const res = await request(app).get("/mac-vendor/CC-DD-EE");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("vendor");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
