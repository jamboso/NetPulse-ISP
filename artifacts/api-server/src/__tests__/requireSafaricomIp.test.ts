import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

vi.mock("@workspace/db", () => ({ db: {}, pool: {} }));

type MiddlewareModule = typeof import("../middlewares/requireSafaricomIp.js");

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

async function buildApp(overrideIp: string): Promise<Express> {
  const { requireSafaricomIp } = (await import(
    "../middlewares/requireSafaricomIp.js"
  )) as MiddlewareModule;

  const app = express();
  app.set("trust proxy", true);

  // Force req.ip to a fixed value regardless of supertest connection address
  app.use((_req, _res, next) => {
    Object.defineProperty(_req, "ip", { get: () => overrideIp, configurable: true });
    next();
  });

  attachLogger(app);

  app.post("/api/mpesa/callback", requireSafaricomIp, (_req, res) => {
    res.json({ ok: true });
  });

  return app;
}

describe("requireSafaricomIp middleware", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env["MPESA_ALLOWED_IPS"];
    vi.resetModules();
    vi.mock("@workspace/db", () => ({ db: {}, pool: {} }));
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.resetModules();
  });

  it("allows a request from a Safaricom IP (196.201.214.1)", async () => {
    const app = await buildApp("196.201.214.1");
    const res = await request(app).post("/api/mpesa/callback").send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("allows a request from another Safaricom subnet (196.201.216.50)", async () => {
    const app = await buildApp("196.201.216.50");
    const res = await request(app).post("/api/mpesa/callback").send({});
    expect(res.status).toBe(200);
  });

  it("rejects a request from an unknown IP (1.2.3.4) with 403", async () => {
    const app = await buildApp("1.2.3.4");
    const res = await request(app).post("/api/mpesa/callback").send({});
    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty("error");
  });

  it("rejects a loopback IP (127.0.0.1) with 403 when defaults apply", async () => {
    const app = await buildApp("127.0.0.1");
    const res = await request(app).post("/api/mpesa/callback").send({});
    expect(res.status).toBe(403);
  });

  it("allows custom IPs set via MPESA_ALLOWED_IPS (single /32)", async () => {
    process.env["MPESA_ALLOWED_IPS"] = "1.2.3.4/32";
    vi.resetModules();
    vi.mock("@workspace/db", () => ({ db: {}, pool: {} }));
    const app = await buildApp("1.2.3.4");
    const res = await request(app).post("/api/mpesa/callback").send({});
    expect(res.status).toBe(200);
  });

  it("rejects IPs not in the custom MPESA_ALLOWED_IPS list", async () => {
    process.env["MPESA_ALLOWED_IPS"] = "1.2.3.4/32";
    vi.resetModules();
    vi.mock("@workspace/db", () => ({ db: {}, pool: {} }));
    const app = await buildApp("1.2.3.5");
    const res = await request(app).post("/api/mpesa/callback").send({});
    expect(res.status).toBe(403);
  });

  it("allows all IPs when MPESA_ALLOWED_IPS=* (sandbox bypass)", async () => {
    process.env["MPESA_ALLOWED_IPS"] = "*";
    vi.resetModules();
    vi.mock("@workspace/db", () => ({ db: {}, pool: {} }));
    const app = await buildApp("192.168.0.1");
    const res = await request(app).post("/api/mpesa/callback").send({});
    expect(res.status).toBe(200);
  });

  it("allows a custom CIDR range (10.0.0.0/8) and accepts IPs within it", async () => {
    process.env["MPESA_ALLOWED_IPS"] = "10.0.0.0/8";
    vi.resetModules();
    vi.mock("@workspace/db", () => ({ db: {}, pool: {} }));
    const app = await buildApp("10.255.100.200");
    const res = await request(app).post("/api/mpesa/callback").send({});
    expect(res.status).toBe(200);
  });

  it("strips IPv6-mapped IPv4 prefix (::ffff:196.201.214.5) before checking", async () => {
    const app = await buildApp("::ffff:196.201.214.5");
    const res = await request(app).post("/api/mpesa/callback").send({});
    expect(res.status).toBe(200);
  });

  it("rejects a plain IP not in defaults when MPESA_ALLOWED_IPS contains only one /32", async () => {
    process.env["MPESA_ALLOWED_IPS"] = "5.5.5.5/32";
    vi.resetModules();
    vi.mock("@workspace/db", () => ({ db: {}, pool: {} }));
    const app = await buildApp("5.5.5.6");
    const res = await request(app).post("/api/mpesa/callback").send({});
    expect(res.status).toBe(403);
  });

  it("treats a plain IP entry (no /prefix) in MPESA_ALLOWED_IPS as /32", async () => {
    process.env["MPESA_ALLOWED_IPS"] = "5.5.5.5";
    vi.resetModules();
    vi.mock("@workspace/db", () => ({ db: {}, pool: {} }));
    const allowed = await buildApp("5.5.5.5");
    const resAllowed = await request(allowed).post("/api/mpesa/callback").send({});
    expect(resAllowed.status).toBe(200);

    vi.resetModules();
    vi.mock("@workspace/db", () => ({ db: {}, pool: {} }));
    const blocked = await buildApp("5.5.5.6");
    const resBlocked = await request(blocked).post("/api/mpesa/callback").send({});
    expect(resBlocked.status).toBe(403);
  });
});
