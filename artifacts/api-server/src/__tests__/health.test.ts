import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("@workspace/db", () => ({
  db: {},
  pool: {},
}));

const { default: healthRouter } = await import("../routes/health.js");

function buildApp() {
  const app = express();
  app.use(healthRouter);
  return app;
}

describe("GET /healthz", () => {
  it("returns 200 with status ok", async () => {
    const res = await request(buildApp()).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("returns JSON content-type", async () => {
    const res = await request(buildApp()).get("/healthz");
    expect(res.headers["content-type"]).toMatch(/json/);
  });
});
