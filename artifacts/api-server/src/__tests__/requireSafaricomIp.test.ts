import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
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
  const { requireSafaricomIp } =
    (await import("../middlewares/requireSafaricomIp.js")) as MiddlewareModule;

  const app = express();
  app.set("trust proxy", true);

  // Force req.ip to a fixed value regardless of supertest connection address
  app.use((_req, _res, next) => {
    Object.defineProperty(_req, "ip", {
      get: () => overrideIp,
      configurable: true,
    });
    next();
  });

  attachLogger(app);

  app.post("/api/mpesa/callback", requireSafaricomIp, (_req, res) => {
    res.json({ ok: true });
  });

  return app;
}

/**
 * Mount the actual public callback router as routes/index.ts does. A settings
 * route registered afterwards represents staff traffic that falls through the
 * public router before authentication is applied.
 */
async function buildRouteScopingApp(overrideIp: string): Promise<Express> {
  const { mpesaPublicRouter } = await import("../routes/mpesa.js");

  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    Object.defineProperty(req, "ip", {
      get: () => overrideIp,
      configurable: true,
    });
    next();
  });
  attachLogger(app);

  app.use("/api", mpesaPublicRouter);
  app.patch("/api/settings", (_req, res) => {
    res.json({ saved: true });
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
    const resAllowed = await request(allowed)
      .post("/api/mpesa/callback")
      .send({});
    expect(resAllowed.status).toBe(200);

    vi.resetModules();
    vi.mock("@workspace/db", () => ({ db: {}, pool: {} }));
    const blocked = await buildApp("5.5.5.6");
    const resBlocked = await request(blocked)
      .post("/api/mpesa/callback")
      .send({});
    expect(resBlocked.status).toBe(403);
  });

  it.each([
    "/api/mpesa/callback",
    "/api/mpesa/c2b/validation",
    "/api/mpesa/c2b/confirmation",
  ])(
    "blocks non-Safaricom IPs on the public callback route %s",
    async (path) => {
      const app = await buildRouteScopingApp("1.2.3.4");

      const res = await request(app).post(path).send({});

      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty("error");
    },
  );

  it("does not apply the callback IP filter to PATCH /api/settings", async () => {
    const app = await buildRouteScopingApp("1.2.3.4");

    const res = await request(app)
      .patch("/api/settings")
      .send({ siteName: "NetPulse" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ saved: true });
  });

  // --- Per-company M-Pesa configuration tests ---
  // Mock the resolved config boundary rather than the old global settings
  // table: callback allowlists are now stored per company.

  function mockMpesaConfig(allowedIps?: string) {
    vi.doMock("../lib/mpesaConfig.js", () => ({
      resolveMpesaConfig: vi
        .fn()
        .mockResolvedValue({ companyId: 1, env: "sandbox", allowedIps }),
    }));
  }

  it("allows an IP in the per-company callback CIDR", async () => {
    vi.resetModules();
    mockMpesaConfig("10.20.30.0/24");

    const app = await buildApp("10.20.30.55");
    const res = await request(app).post("/api/mpesa/callback").send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("rejects an IP outside the per-company callback CIDR", async () => {
    vi.resetModules();
    mockMpesaConfig("10.20.30.0/24");

    const app = await buildApp("10.20.31.1");
    const res = await request(app).post("/api/mpesa/callback").send({});

    expect(res.status).toBe(403);
  });

  it("allows all IPs when the per-company callback allowlist is *", async () => {
    vi.resetModules();
    mockMpesaConfig("*");

    const app = await buildApp("1.2.3.4");
    const res = await request(app).post("/api/mpesa/callback").send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("falls through to MPESA_ALLOWED_IPS when the legacy company has no stored allowlist", async () => {
    process.env["MPESA_ALLOWED_IPS"] = "7.7.7.7/32";
    vi.resetModules();
    mockMpesaConfig();

    const app = await buildApp("7.7.7.7");
    const res = await request(app).post("/api/mpesa/callback").send({});

    expect(res.status).toBe(200);
  });
});
