import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

vi.mock("@workspace/db", () => ({ db: {}, pool: {} }));

type MiddlewareModule = typeof import("../middlewares/requireMpesaWebhookSecret.js");

/** Minimal pino-compatible logger stub attached to req.log */
function attachLogger(app: Express) {
  app.use((req, _res, next) => {
    (req as unknown as { log: Record<string, unknown> }).log = {
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    next();
  });
}

async function buildApp(): Promise<Express> {
  const { requireMpesaWebhookSecret } = (await import(
    "../middlewares/requireMpesaWebhookSecret.js"
  )) as MiddlewareModule;

  const app = express();
  attachLogger(app);

  app.post("/api/mpesa/callback", requireMpesaWebhookSecret, (_req, res) => {
    res.json({ ok: true });
  });

  return app;
}

describe("requireMpesaWebhookSecret middleware", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env["MPESA_WEBHOOK_SECRET"];
    vi.resetModules();
    vi.mock("@workspace/db", () => ({ db: {}, pool: {} }));
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.resetModules();
  });

  it("allows the request when MPESA_WEBHOOK_SECRET is not set (backward-compatible)", async () => {
    const app = await buildApp();
    const res = await request(app).post("/api/mpesa/callback").send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("allows the request when the correct secret header is provided", async () => {
    process.env["MPESA_WEBHOOK_SECRET"] = "super-secret-value";
    vi.resetModules();
    vi.mock("@workspace/db", () => ({ db: {}, pool: {} }));
    const app = await buildApp();
    const res = await request(app)
      .post("/api/mpesa/callback")
      .set("x-mpesa-webhook-secret", "super-secret-value")
      .send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("rejects with 403 when the secret header is missing", async () => {
    process.env["MPESA_WEBHOOK_SECRET"] = "super-secret-value";
    vi.resetModules();
    vi.mock("@workspace/db", () => ({ db: {}, pool: {} }));
    const app = await buildApp();
    const res = await request(app).post("/api/mpesa/callback").send({});
    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty("error");
  });

  it("rejects with 403 when the secret header has the wrong value", async () => {
    process.env["MPESA_WEBHOOK_SECRET"] = "super-secret-value";
    vi.resetModules();
    vi.mock("@workspace/db", () => ({ db: {}, pool: {} }));
    const app = await buildApp();
    const res = await request(app)
      .post("/api/mpesa/callback")
      .set("x-mpesa-webhook-secret", "wrong-value")
      .send({});
    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty("error");
  });

  it("rejects with 403 when the secret header is an empty string", async () => {
    process.env["MPESA_WEBHOOK_SECRET"] = "super-secret-value";
    vi.resetModules();
    vi.mock("@workspace/db", () => ({ db: {}, pool: {} }));
    const app = await buildApp();
    const res = await request(app)
      .post("/api/mpesa/callback")
      .set("x-mpesa-webhook-secret", "")
      .send({});
    expect(res.status).toBe(403);
  });

  it("is case-sensitive: rejects a header value with different casing", async () => {
    process.env["MPESA_WEBHOOK_SECRET"] = "MySecret";
    vi.resetModules();
    vi.mock("@workspace/db", () => ({ db: {}, pool: {} }));
    const app = await buildApp();
    const res = await request(app)
      .post("/api/mpesa/callback")
      .set("x-mpesa-webhook-secret", "mysecret")
      .send({});
    expect(res.status).toBe(403);
  });
});
