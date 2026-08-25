import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, routersTable, routerVpnCertsTable, vpnConfigTable, settingsTable } from "@workspace/db";
import { generateStage1Bootstrap, generateRosScript } from "../lib/certGen";
import type { RouterVpnCert } from "@workspace/db";

const router = Router();

// Helper: derive the public server URL from request or settings
async function resolveServerUrl(req: { headers: Record<string, string | string[] | undefined>; protocol: string }): Promise<string> {
  const host = req.headers["x-forwarded-host"] ?? req.headers["host"] ?? "localhost";
  const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? req.protocol ?? "https";
  return `${proto}://${host}`;
}

// ── GET /api/provision/:token/info ────────────────────────────────────────────
// Authenticated status check used by the UI (polled every 5s)
router.get("/provision/:token/info", async (req, res) => {
  try {
    const [row] = await db
      .select({
        id: routersTable.id,
        name: routersTable.name,
        provisionStatus: routersTable.provisionStatus,
        macAddress: routersTable.macAddress,
        rosVersion: routersTable.rosVersion,
        vpnConnected: routersTable.vpnConnected,
        vpnIp: routersTable.vpnIp,
        lastCallbackAt: routersTable.lastCallbackAt,
      })
      .from(routersTable)
      .where(eq(routersTable.provisionToken, req.params.token));

    if (!row) return res.status(404).json({ error: "Token not found" });
    return res.json(row);
  } catch (err) {
    req.log.error(err, "provision info error");
    return res.status(500).json({ error: "Failed" });
  }
});

// ── GET /api/provision/:token/bootstrap.rsc ───────────────────────────────────
// PUBLIC — Stage 1 tiny bootstrap. Router downloads and imports this first.
// Returns a tiny .rsc that fetches Stage 2 from this server.
router.get("/provision/:token/bootstrap.rsc", async (req, res) => {
  try {
    const [router_] = await db
      .select()
      .from(routersTable)
      .where(eq(routersTable.provisionToken, req.params.token));

    if (!router_) return res.status(404).type("text/plain").send("# Token not found");

    const serverUrl = await resolveServerUrl(req as Parameters<typeof resolveServerUrl>[0]);

    const script = generateStage1Bootstrap({
      routerName: router_.name,
      token: req.params.token,
      serverUrl,
    });

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=np-boot-${router_.id}.rsc`);
    return res.send(script);
  } catch (err) {
    req.log.error(err, "bootstrap.rsc error");
    return res.status(500).type("text/plain").send("# Error generating bootstrap");
  }
});

// ── GET /api/provision/:token/register ───────────────────────────────────────
// PUBLIC — Called by Stage 1 before fetching Stage 2. Records MAC + ROS version.
router.get("/provision/:token/register", async (req, res) => {
  try {
    const mac = String(req.query.mac ?? "").trim();
    const ver = String(req.query.ver ?? "").trim();
    const name = String(req.query.name ?? "").trim();

    await db
      .update(routersTable)
      .set({
        macAddress: mac || undefined,
        rosVersion: ver || undefined,
        provisionStatus: "provisioned",
        lastCallbackAt: new Date(),
      })
      .where(eq(routersTable.provisionToken, req.params.token));

    req.log.info({ mac, ver, name }, "provision register");
    return res.type("text/plain").send("ok");
  } catch (err) {
    req.log.error(err, "provision register error");
    return res.status(500).type("text/plain").send("error");
  }
});

// ── GET /api/provision/:token/setup.rsc ──────────────────────────────────────
// PUBLIC — Stage 2 full config. Served fresh each time; retrieves certs + callback.
router.get("/provision/:token/certificate/:file", async (req, res) => {
  try {
    const [router_] = await db
      .select({ id: routersTable.id })
      .from(routersTable)
      .where(eq(routersTable.provisionToken, req.params.token));
    if (!router_) return res.status(404).type("text/plain").send("Not found");

    const [vpnCfg] = await db.select({ caCert: vpnConfigTable.caCert }).from(vpnConfigTable).limit(1);
    const [certRow] = await db
      .select({
        clientCert: routerVpnCertsTable.clientCert,
        clientKey: routerVpnCertsTable.clientKey,
        revokedAt: routerVpnCertsTable.revokedAt,
      })
      .from(routerVpnCertsTable)
      .where(eq(routerVpnCertsTable.routerId, router_.id));

    if (!vpnCfg?.caCert || !certRow?.clientCert || !certRow.clientKey || certRow.revokedAt) {
      return res.status(503).type("text/plain").send("VPN credentials unavailable");
    }

    const files = {
      "ca.pem": vpnCfg.caCert,
      "client.pem": certRow.clientCert,
      "client.key": certRow.clientKey,
      "client-private": certRow.clientKey,
    } as const;
    const contents = files[req.params.file as keyof typeof files];
    if (!contents) return res.status(404).type("text/plain").send("Not found");

    res.setHeader("Cache-Control", "no-store");
    return res.type("application/x-pem-file").send(contents);
  } catch (err) {
    req.log.error(err, "provision certificate download error");
    return res.status(500).type("text/plain").send("Unable to retrieve credential");
  }
});

router.get("/provision/:token/setup.rsc", async (req, res) => {
  try {
    const mac = String(req.query.mac ?? "").trim();
    const ver = String(req.query.ver ?? "").trim();

    const [router_] = await db
      .select()
      .from(routersTable)
      .where(eq(routersTable.provisionToken, req.params.token));

    if (!router_) return res.status(404).type("text/plain").send("# Token not found");

    const [vpnCfg] = await db.select().from(vpnConfigTable).limit(1);
    if (!vpnCfg?.caCert) {
      return res
        .status(503)
        .type("text/plain")
        .send("# VPN not configured on server — set up OpenVPN in Settings → Infrastructure first");
    }

    const [certRow] = await db
      .select()
      .from(routerVpnCertsTable)
      .where(eq(routerVpnCertsTable.routerId, router_.id));

    if (!certRow?.clientCert || certRow.revokedAt) {
      return res
        .status(503)
        .type("text/plain")
        .send("# No VPN certificate for this router — it may not have been generated yet");
    }

    const [secretRow] = await db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.key, "radiusSecret"));
    const radiusSecret = secretRow?.value ?? "change-me-in-settings";

    const serverUrl = await resolveServerUrl(req as Parameters<typeof resolveServerUrl>[0]);

    if (mac) {
      await db
        .update(routersTable)
        .set({ macAddress: mac, rosVersion: ver || undefined, lastCallbackAt: new Date() })
        .where(eq(routersTable.provisionToken, req.params.token));
    }

    const routerOsVersion = ver || router_.rosVersion || undefined;
    const script = generateRosScript({
      routerName: router_.name,
      serverIp: vpnCfg.serverPublicIp ?? "YOUR_SERVER_IP",
      vpnPort: vpnCfg.vpnPort ?? 1194,
      vpnProtocol: vpnCfg.vpnProtocol ?? "tcp",
      routerOsVersion,
      vpnSubnet: vpnCfg.vpnSubnet ?? "10.8.0.0",
      caCertPem: vpnCfg.caCert!,
      clientCertPem: certRow.clientCert!,
      clientKeyPem: certRow.clientKey!,
      radiusSecret,
      token: req.params.token,
      serverUrl,
      vpnIp: certRow.vpnIp ?? router_.vpnIp ?? undefined,
    });

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=netpulse-setup.rsc`);
    return res.send(script);
  } catch (err) {
    req.log.error(err, "setup.rsc error");
    return res.status(500).type("text/plain").send("# Internal error");
  }
});

// ── POST /api/provision/:token/callback ──────────────────────────────────────
// PUBLIC — Router calls this after completing setup to signal tunnel is active.
router.post("/provision/:token/callback", async (req, res) => {
  try {
    const mac = String(req.body?.mac ?? req.query.mac ?? "").trim();
    const ver = String(req.body?.ver ?? req.query.ver ?? "").trim();

    const [row] = await db
      .select()
      .from(routersTable)
      .where(eq(routersTable.provisionToken, req.params.token));

    if (!row) return res.status(404).type("text/plain").send("not found");

    await db
      .update(routersTable)
      .set({
        macAddress: mac || row.macAddress,
        rosVersion: ver || row.rosVersion,
        provisionStatus: "connected",
        vpnConnected: true,
        lastCallbackAt: new Date(),
        lastSeen: new Date(),
      })
      .where(eq(routersTable.provisionToken, req.params.token));

    req.log.info({ routerId: row.id, mac, ver }, "provision callback — router connected");
    return res.type("text/plain").send("ok");
  } catch (err) {
    req.log.error(err, "provision callback error");
    return res.status(500).type("text/plain").send("error");
  }
});

export default router;
