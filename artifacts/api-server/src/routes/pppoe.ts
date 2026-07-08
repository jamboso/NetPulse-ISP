import { Router } from "express";
import { db } from "@workspace/db";
import { routersTable, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

// ── RouterOS API helpers ──────────────────────────────────────────────────────

export async function rosReq(
  ip: string, ssl: boolean, user: string, pass: string,
  method: "GET" | "PUT" | "PATCH" | "DELETE",
  path: string, body?: object
): Promise<unknown> {
  const scheme = ssl ? "https" : "http";
  const url = `${scheme}://${ip}/rest${path}`;
  const creds = Buffer.from(`${user}:${pass}`).toString("base64");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Basic ${creds}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (res.status === 401) throw new Error("RouterOS authentication failed");
    if (res.status === 404) return method === "GET" ? [] : null;
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`RouterOS HTTP ${res.status}: ${t}`);
    }
    const text = await res.text();
    return text.trim() ? JSON.parse(text) : null;
  } catch (err: any) {
    clearTimeout(timer);
    if (err.name === "AbortError") throw new Error(`Timeout connecting to ${ip}`);
    throw err;
  }
}

export async function getRouter(id: number) {
  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  return r;
}

// Create-or-update a RouterOS object matched by one or more query params (e.g. name,
// or service-name+interface). RouterOS REST `PUT` always creates a *new* object, so
// re-running setup against a router that already has the object would otherwise fail
// with "already exists" errors. This looks the object up first and PATCHes it if found.
export async function upsertRos(
  ip: string, ssl: boolean, user: string, pass: string,
  path: string, match: Record<string, string>, body: Record<string, unknown>
): Promise<unknown> {
  const query = Object.entries(match)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  const existing = await rosReq(ip, ssl, user, pass, "GET", `${path}?${query}`);
  const id = Array.isArray(existing) && existing.length > 0 ? existing[0][".id"] : undefined;
  if (id) {
    return rosReq(ip, ssl, user, pass, "PATCH", `${path}/${id}`, body);
  }
  return rosReq(ip, ssl, user, pass, "PUT", path, { ...match, ...body });
}

// Resolves the RADIUS server/secret to configure on a given router: prefers the
// router's own NAS secret (set on the router record, also used for its radnas entry)
// and falls back to the global RADIUS settings configured in Settings → Network.
export async function getRadiusConfig(r: typeof routersTable.$inferSelect): Promise<{
  server: string; secret: string; authPort: number; acctPort: number;
} | null> {
  const rows = await db
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.key, "radiusServer"));
  const server = rows[0]?.value ?? null;
  if (!server) return null;

  const secret = r.radiusSecret ?? undefined;
  let globalSecret: string | undefined;
  if (!secret) {
    const secretRows = await db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.key, "radiusSecret"));
    globalSecret = secretRows[0]?.value ?? undefined;
  }
  const resolvedSecret = secret ?? globalSecret;
  if (!resolvedSecret) return null;

  const authPort = r.radiusPort ?? 1812;
  return { server, secret: resolvedSecret, authPort, acctPort: authPort + 1 };
}

// ── GET /api/routers/:id/ros/pppoe/status ─────────────────────────────────────
router.get("/routers/:id/ros/pppoe/status", async (req, res) => {
  const r = await getRouter(parseInt(req.params.id!));
  if (!r) { res.status(404).json({ error: "Router not found" }); return; }
  const { ipAddress: ip, apiSsl: ssl, username: user, password: pass } = r;
  try {
    const [servers, profiles, pools, activeCount, radiusEntries, aaa] = await Promise.all([
      rosReq(ip, ssl ?? false, user, pass, "GET", "/interface/pppoe-server/server"),
      rosReq(ip, ssl ?? false, user, pass, "GET", "/ppp/profile"),
      rosReq(ip, ssl ?? false, user, pass, "GET", "/ip/pool"),
      rosReq(ip, ssl ?? false, user, pass, "GET", "/ppp/active").then(d => (Array.isArray(d) ? d.length : 0)),
      rosReq(ip, ssl ?? false, user, pass, "GET", "/radius").catch(() => []),
      rosReq(ip, ssl ?? false, user, pass, "GET", "/ppp/aaa").catch(() => null),
    ]);
    const radiusConfig = await getRadiusConfig(r);
    res.json({
      servers, profiles, pools, activeSessionCount: activeCount,
      radius: {
        appConfigured: !!radiusConfig,
        entries: Array.isArray(radiusEntries) ? radiusEntries : [],
        aaaUseRadius: (aaa as any)?.["use-radius"] === "yes",
      },
    });
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// ── GET /api/routers/:id/ros/pppoe/secrets ────────────────────────────────────
router.get("/routers/:id/ros/pppoe/secrets", async (req, res) => {
  const r = await getRouter(parseInt(req.params.id!));
  if (!r) { res.status(404).json({ error: "Router not found" }); return; }
  try {
    const secrets = await rosReq(r.ipAddress, r.apiSsl ?? false, r.username, r.password, "GET", "/ppp/secret");
    res.json(secrets);
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// ── POST /api/routers/:id/ros/pppoe/secrets ───────────────────────────────────
router.post("/routers/:id/ros/pppoe/secrets", async (req, res) => {
  const r = await getRouter(parseInt(req.params.id!));
  if (!r) { res.status(404).json({ error: "Router not found" }); return; }
  const { name, password, service, profile, comment, remoteAddress, localAddress } = req.body as Record<string, string>;
  if (!name || !password) { res.status(400).json({ error: "name and password required" }); return; }
  try {
    const result = await rosReq(r.ipAddress, r.apiSsl ?? false, r.username, r.password, "PUT", "/ppp/secret", {
      name, password, service: service ?? "pppoe",
      profile: profile ?? "default",
      comment: comment ?? "",
      ...(remoteAddress ? { "remote-address": remoteAddress } : {}),
      ...(localAddress ? { "local-address": localAddress } : {}),
    });
    res.status(201).json(result);
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// ── DELETE /api/routers/:id/ros/pppoe/secrets/:rosId ─────────────────────────
router.delete("/routers/:id/ros/pppoe/secrets/:rosId", async (req, res) => {
  const r = await getRouter(parseInt(req.params.id!));
  if (!r) { res.status(404).json({ error: "Router not found" }); return; }
  try {
    await rosReq(r.ipAddress, r.apiSsl ?? false, r.username, r.password, "DELETE", `/ppp/secret/${req.params.rosId}`);
    res.json({ success: true });
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// ── POST /api/routers/:id/ros/pppoe/setup (auto-configure enterprise PPPoE) ──
router.post("/routers/:id/ros/pppoe/setup", async (req, res) => {
  const r = await getRouter(parseInt(req.params.id!));
  if (!r) { res.status(404).json({ error: "Router not found" }); return; }
  const {
    interface: iface,
    poolName = "pppoe-pool",
    poolRange = "10.10.0.1-10.10.15.254",
    serviceName = "pppoe-server",
    localAddress = "10.10.0.1",
    dnsServers = "8.8.8.8,1.1.1.1",
    profiles = [] as Array<{ name: string; downloadKbps: number; uploadKbps: number; sessionLimit?: string }>,
    mtu = 1480,
  } = req.body as {
    interface: string;
    poolName?: string;
    poolRange?: string;
    serviceName?: string;
    localAddress?: string;
    dnsServers?: string;
    profiles?: Array<{ name: string; downloadKbps: number; uploadKbps: number; sessionLimit?: string }>;
    mtu?: number;
  };

  if (!iface) { res.status(400).json({ error: "interface is required" }); return; }

  const { ipAddress: ip, apiSsl: ssl, username: user, password: pass } = r;
  const steps: string[] = [];
  const errors: string[] = [];

  async function tryStep(label: string, fn: () => Promise<unknown>) {
    try { await fn(); steps.push(`✓ ${label}`); }
    catch (e: any) { errors.push(`✗ ${label}: ${e.message}`); }
  }

  // 1. Create (or update) IP pool
  await tryStep("Create IP pool", () =>
    upsertRos(ip, ssl ?? false, user, pass, "/ip/pool", { name: poolName }, {
      ranges: poolRange,
    })
  );

  // 2. Create (or update) speed-tier profiles
  const defaultProfiles = profiles.length > 0 ? profiles : [
    { name: "plan-2mbps", downloadKbps: 2048, uploadKbps: 1024 },
    { name: "plan-5mbps", downloadKbps: 5120, uploadKbps: 2048 },
    { name: "plan-10mbps", downloadKbps: 10240, uploadKbps: 5120 },
    { name: "plan-unlimited", downloadKbps: 0, uploadKbps: 0 },
  ];

  for (const p of defaultProfiles) {
    const rateLimit = p.downloadKbps > 0
      ? `${p.uploadKbps}k/${p.downloadKbps}k`
      : "";
    await tryStep(`Create profile: ${p.name}`, () =>
      upsertRos(ip, ssl ?? false, user, pass, "/ppp/profile", { name: p.name }, {
        "local-address": localAddress,
        "remote-address": poolName,
        "rate-limit": rateLimit,
        "session-timeout": p.sessionLimit ?? "0",
        "dns-server": dnsServers.split(",").map(s => s.trim()).join(","),
      })
    );
  }

  // 4. Create (or update) PPPoE server
  await tryStep("Create PPPoE server", () =>
    upsertRos(ip, ssl ?? false, user, pass, "/interface/pppoe-server/server", {
      interface: iface,
      "service-name": serviceName,
    }, {
      "max-mtu": String(mtu),
      "max-mru": String(mtu),
      authentication: "pap,chap,mschap1,mschap2",
      "one-session-per-host": "yes",
      disabled: "no",
    })
  );

  // 5. Configure RADIUS authentication automatically, if a RADIUS server/secret
  //    is already set up in Settings → Network. No opt-in required — this keeps
  //    the router's auth in sync with the app's RADIUS config whenever it exists.
  const radius = await getRadiusConfig(r);
  if (radius) {
    await tryStep("Add RADIUS server", () =>
      upsertRos(ip, ssl ?? false, user, pass, "/radius", {
        address: radius.server,
        service: "ppp",
      }, {
        secret: radius.secret,
        "authentication-port": String(radius.authPort),
        "accounting-port": String(radius.acctPort),
        disabled: "no",
      })
    );
    await tryStep("Enable RADIUS for PPPoE (AAA)", () =>
      rosReq(ip, ssl ?? false, user, pass, "PATCH", "/ppp/aaa", {
        "use-radius": "yes",
        accounting: "yes",
      })
    );
  } else {
    steps.push("○ RADIUS not configured in Settings → Network — skipped (router auth left on local secrets)");
  }

  res.json({ success: errors.length === 0, steps, errors });
});

// ── GET /api/routers/:id/ros/pppoe/interfaces ─────────────────────────────────
router.get("/routers/:id/ros/pppoe/interfaces", async (req, res) => {
  const r = await getRouter(parseInt(req.params.id!));
  if (!r) { res.status(404).json({ error: "Router not found" }); return; }
  try {
    const ifaces = await rosReq(r.ipAddress, r.apiSsl ?? false, r.username, r.password, "GET", "/interface");
    res.json(ifaces);
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// ── GET /api/routers/:id/ros/pppoe/active ─────────────────────────────────────
router.get("/routers/:id/ros/pppoe/active", async (req, res) => {
  const r = await getRouter(parseInt(req.params.id!));
  if (!r) { res.status(404).json({ error: "Router not found" }); return; }
  try {
    const active = await rosReq(r.ipAddress, r.apiSsl ?? false, r.username, r.password, "GET", "/ppp/active");
    res.json(active);
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// ── DELETE /api/routers/:id/ros/pppoe/active/:sessionId (kick session) ────────
router.delete("/routers/:id/ros/pppoe/active/:sessionId", async (req, res) => {
  const r = await getRouter(parseInt(req.params.id!));
  if (!r) { res.status(404).json({ error: "Router not found" }); return; }
  try {
    await rosReq(r.ipAddress, r.apiSsl ?? false, r.username, r.password, "DELETE", `/ppp/active/${req.params.sessionId}`);
    res.json({ success: true });
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// ── POST /api/routers/:id/ros/pppoe/profiles ─────────────────────────────────
router.post("/routers/:id/ros/pppoe/profiles", async (req, res) => {
  const r = await getRouter(parseInt(req.params.id!));
  if (!r) { res.status(404).json({ error: "Router not found" }); return; }
  const { name, downloadKbps, uploadKbps, poolName, localAddress, sessionTimeout } = req.body as Record<string, any>;
  if (!name) { res.status(400).json({ error: "name required" }); return; }
  const rateLimit = downloadKbps > 0 ? `${uploadKbps ?? Math.ceil(downloadKbps / 2)}k/${downloadKbps}k` : "";
  try {
    const result = await upsertRos(r.ipAddress, r.apiSsl ?? false, r.username, r.password, "/ppp/profile", { name }, {
      "rate-limit": rateLimit,
      ...(poolName ? { "remote-address": poolName } : {}),
      ...(localAddress ? { "local-address": localAddress } : {}),
      "session-timeout": sessionTimeout ?? "0",
    });
    res.status(201).json(result);
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

export default router;
