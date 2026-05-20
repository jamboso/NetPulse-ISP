import { Router } from "express";
import { db } from "@workspace/db";
import { routersTable, hotspotPackagesTable, hotspotVouchersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const router = Router();

async function rosReq(
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

async function getRouter(id: number) {
  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  return r;
}

// ── GET /api/routers/:id/ros/hotspot/status ───────────────────────────────────
router.get("/routers/:id/ros/hotspot/status", async (req, res) => {
  const r = await getRouter(parseInt(req.params.id!));
  if (!r) { res.status(404).json({ error: "Router not found" }); return; }
  const { ipAddress: ip, apiSsl: ssl, username: user, password: pass } = r;
  try {
    const [servers, profiles, activeSessions, userCount, pools] = await Promise.all([
      rosReq(ip, ssl ?? false, user, pass, "GET", "/ip/hotspot"),
      rosReq(ip, ssl ?? false, user, pass, "GET", "/ip/hotspot/profile"),
      rosReq(ip, ssl ?? false, user, pass, "GET", "/ip/hotspot/active"),
      rosReq(ip, ssl ?? false, user, pass, "GET", "/ip/hotspot/user").then(d => (Array.isArray(d) ? d.length : 0)),
      rosReq(ip, ssl ?? false, user, pass, "GET", "/ip/pool"),
    ]);
    res.json({ servers, profiles, activeSessions, userCount, pools });
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// ── POST /api/routers/:id/ros/hotspot/setup ───────────────────────────────────
router.post("/routers/:id/ros/hotspot/setup", async (req, res) => {
  const r = await getRouter(parseInt(req.params.id!));
  if (!r) { res.status(404).json({ error: "Router not found" }); return; }

  const {
    interface: iface,
    portalBaseUrl,
    poolName = "hs-pool",
    poolRange = "10.5.0.1-10.5.15.254",
    addressPool = "10.5.0.0/20",
    gateway = "10.5.0.1",
    dnsServers = "8.8.8.8,1.1.1.1",
    serverProfileName = "hs-profile",
    serverName = "hotspot1",
    cookieTimeout = "3d",
    sessionTimeout = "1h",
    idleTimeout = "10m",
    keepaliveTimeout = "2m",
    walledGarden = [] as string[],
  } = req.body as {
    interface: string;
    portalBaseUrl?: string;
    poolName?: string;
    poolRange?: string;
    addressPool?: string;
    gateway?: string;
    dnsServers?: string;
    serverProfileName?: string;
    serverName?: string;
    cookieTimeout?: string;
    sessionTimeout?: string;
    idleTimeout?: string;
    keepaliveTimeout?: string;
    walledGarden?: string[];
  };

  if (!iface) { res.status(400).json({ error: "interface is required" }); return; }

  const { ipAddress: ip, apiSsl: ssl, username: user, password: pass } = r;
  const steps: string[] = [];
  const errors: string[] = [];

  async function tryStep(label: string, fn: () => Promise<unknown>) {
    try { await fn(); steps.push(`✓ ${label}`); }
    catch (e: any) { errors.push(`✗ ${label}: ${e.message}`); }
  }

  // 1. Assign IP address to hotspot interface
  await tryStep("Assign gateway IP to interface", () =>
    rosReq(ip, ssl ?? false, user, pass, "PUT", "/ip/address", {
      address: `${gateway}/${addressPool.split("/")[1]}`,
      interface: iface,
      comment: "Hotspot Gateway",
    })
  );

  // 2. Create IP pool
  await tryStep("Create hotspot IP pool", () =>
    rosReq(ip, ssl ?? false, user, pass, "PUT", "/ip/pool", {
      name: poolName,
      ranges: poolRange,
    })
  );

  // 3. Create hotspot server profile
  const loginPage = portalBaseUrl ? `${portalBaseUrl}/hotspot/${r.id}` : "";
  await tryStep("Create hotspot server profile", () =>
    rosReq(ip, ssl ?? false, user, pass, "PUT", "/ip/hotspot/profile", {
      name: serverProfileName,
      "hotspot-address": gateway,
      "dns-name": "",
      "html-directory": "hotspot",
      "http-proxy": "0.0.0.0:0",
      "login-by": "mac,http-pap,http-chap,https,mac-cookie",
      "use-radius": "no",
      "mac-auth-mode": "mac-as-username-and-password",
      "cookie-lifetime": cookieTimeout,
      "session-timeout": sessionTimeout,
      "idle-timeout": idleTimeout,
      "keepalive-timeout": keepaliveTimeout,
      "split-user-domain": "no",
      "trial-uptime": "0s",
      ...(loginPage ? { "login-page": loginPage } : {}),
    })
  );

  // 4. Create bandwidth-tier user profiles
  const tiers = [
    { name: "hs-1mbps", rateLimit: "512k/1m" },
    { name: "hs-2mbps", rateLimit: "1m/2m" },
    { name: "hs-5mbps", rateLimit: "2m/5m" },
    { name: "hs-10mbps", rateLimit: "5m/10m" },
    { name: "hs-unlimited", rateLimit: "" },
  ];
  for (const t of tiers) {
    await tryStep(`Create user profile: ${t.name}`, () =>
      rosReq(ip, ssl ?? false, user, pass, "PUT", "/ip/hotspot/user/profile", {
        name: t.name,
        "rate-limit": t.rateLimit,
        "shared-users": "1",
        "session-timeout": "0s",
        "idle-timeout": idleTimeout,
        "keepalive-timeout": keepaliveTimeout,
      })
    );
  }

  // 5. Create hotspot server
  await tryStep("Create hotspot server", () =>
    rosReq(ip, ssl ?? false, user, pass, "PUT", "/ip/hotspot", {
      name: serverName,
      interface: iface,
      profile: serverProfileName,
      "address-pool": poolName,
      disabled: "no",
    })
  );

  // 6. DNS servers (optional)
  if (dnsServers) {
    await tryStep("Configure DNS servers", () =>
      rosReq(ip, ssl ?? false, user, pass, "PATCH", "/ip/dns", {
        servers: dnsServers.split(",").map(s => s.trim()),
        "allow-remote-requests": "yes",
      })
    );
  }

  // 7. Walled garden entries (allow access to portal without login)
  const gardenEntries = [
    ...(portalBaseUrl ? [new URL(portalBaseUrl).hostname] : []),
    "safaricom.co.ke", "mpesa.co.ke",
    ...walledGarden,
  ];
  for (const host of gardenEntries) {
    await tryStep(`Walled garden: ${host}`, () =>
      rosReq(ip, ssl ?? false, user, pass, "PUT", "/ip/hotspot/walled-garden", {
        action: "allow",
        dst: host,
        comment: "Auto-added by NetPulse",
      })
    );
  }

  // 8. Walled garden IP for payment gateway
  await tryStep("Walled garden: Safaricom IPs", () =>
    rosReq(ip, ssl ?? false, user, pass, "PUT", "/ip/hotspot/walled-garden/ip", {
      action: "accept",
      "dst-address": "196.201.214.0/24",
      comment: "Safaricom/M-Pesa API",
    })
  );

  res.json({ success: errors.length === 0, steps, errors });
});

// ── GET /api/routers/:id/ros/hotspot/active ───────────────────────────────────
router.get("/routers/:id/ros/hotspot/active", async (req, res) => {
  const r = await getRouter(parseInt(req.params.id!));
  if (!r) { res.status(404).json({ error: "Router not found" }); return; }
  try {
    const active = await rosReq(r.ipAddress, r.apiSsl ?? false, r.username, r.password, "GET", "/ip/hotspot/active");
    res.json(active);
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// ── DELETE /api/routers/:id/ros/hotspot/active/:sessionId ─────────────────────
router.delete("/routers/:id/ros/hotspot/active/:sessionId", async (req, res) => {
  const r = await getRouter(parseInt(req.params.id!));
  if (!r) { res.status(404).json({ error: "Router not found" }); return; }
  try {
    await rosReq(r.ipAddress, r.apiSsl ?? false, r.username, r.password, "DELETE", `/ip/hotspot/active/${req.params.sessionId}`);
    res.json({ success: true });
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// ── GET /api/routers/:id/hotspot/packages ─────────────────────────────────────
router.get("/routers/:id/hotspot/packages", async (req, res) => {
  const packages = await db
    .select()
    .from(hotspotPackagesTable)
    .where(eq(hotspotPackagesTable.routerId, parseInt(req.params.id!)))
    .orderBy(hotspotPackagesTable.sortOrder, hotspotPackagesTable.id);
  res.json(packages);
});

// ── POST /api/routers/:id/hotspot/packages ────────────────────────────────────
router.post("/routers/:id/hotspot/packages", async (req, res) => {
  const routerId = parseInt(req.params.id!);
  const { name, description, durationMinutes, dataLimitMb, downloadSpeedKbps, uploadSpeedKbps, price, currency, sortOrder } = req.body as {
    name: string; description?: string; durationMinutes: number;
    dataLimitMb?: number; downloadSpeedKbps?: number; uploadSpeedKbps?: number;
    price: string; currency?: string; sortOrder?: number;
  };
  if (!name || !durationMinutes || !price) {
    res.status(400).json({ error: "name, durationMinutes, price required" }); return;
  }
  const [pkg] = await db.insert(hotspotPackagesTable).values({
    routerId, name, description: description ?? null,
    durationMinutes, dataLimitMb: dataLimitMb ?? null,
    downloadSpeedKbps: downloadSpeedKbps ?? null,
    uploadSpeedKbps: uploadSpeedKbps ?? null,
    price, currency: currency ?? "KES", sortOrder: sortOrder ?? 0,
  }).returning();
  res.status(201).json(pkg);
});

// ── PATCH /api/routers/:id/hotspot/packages/:pkgId ────────────────────────────
router.patch("/routers/:id/hotspot/packages/:pkgId", async (req, res) => {
  const [pkg] = await db
    .update(hotspotPackagesTable)
    .set(req.body)
    .where(eq(hotspotPackagesTable.id, parseInt(req.params.pkgId!)))
    .returning();
  if (!pkg) { res.status(404).json({ error: "Package not found" }); return; }
  res.json(pkg);
});

// ── DELETE /api/routers/:id/hotspot/packages/:pkgId ───────────────────────────
router.delete("/routers/:id/hotspot/packages/:pkgId", async (req, res) => {
  await db.delete(hotspotPackagesTable).where(eq(hotspotPackagesTable.id, parseInt(req.params.pkgId!)));
  res.json({ success: true });
});

// ── GET /api/routers/:id/hotspot/vouchers ─────────────────────────────────────
router.get("/routers/:id/hotspot/vouchers", async (req, res) => {
  const vouchers = await db
    .select()
    .from(hotspotVouchersTable)
    .where(eq(hotspotVouchersTable.routerId, parseInt(req.params.id!)))
    .orderBy(desc(hotspotVouchersTable.createdAt))
    .limit(100);
  res.json(vouchers);
});

// ── GET /api/routers/:id/ros/hotspot/users ────────────────────────────────────
router.get("/routers/:id/ros/hotspot/users", async (req, res) => {
  const r = await getRouter(parseInt(req.params.id!));
  if (!r) { res.status(404).json({ error: "Router not found" }); return; }
  try {
    const users = await rosReq(r.ipAddress, r.apiSsl ?? false, r.username, r.password, "GET", "/ip/hotspot/user");
    res.json(users);
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// ── DELETE /api/routers/:id/ros/hotspot/users/:rosId ─────────────────────────
router.delete("/routers/:id/ros/hotspot/users/:rosId", async (req, res) => {
  const r = await getRouter(parseInt(req.params.id!));
  if (!r) { res.status(404).json({ error: "Router not found" }); return; }
  try {
    await rosReq(r.ipAddress, r.apiSsl ?? false, r.username, r.password, "DELETE", `/ip/hotspot/user/${req.params.rosId}`);
    res.json({ success: true });
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

export default router;
