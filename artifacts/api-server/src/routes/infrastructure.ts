import { Router } from "express";
import { eq, and } from "drizzle-orm";
import {
  db, vpnConfigTable, routerVpnCertsTable, routersTable,
  settingsTable, type RouterVpnCert,
} from "@workspace/db";
import { generateVpnServerCerts, generateClientCert, generateOpenVpnServerConf, generateRosScript } from "../lib/certGen";
import { requireRole } from "../middlewares/requireRole";
import { loadInstalledOpenVpnCertificatesWithHelper } from "../lib/systemVpnCerts";
import { repairOpenVpnService } from "../lib/openVpnRepair";
import { resolveCompanyScope } from "../middlewares/companyScope";

const router = Router();
router.use(resolveCompanyScope);

// Confirms `routerId` belongs to the requesting company. Returns the router
// row on success, or null after already writing a 403/404 response.
async function requireOwnedRouter(req: import("express").Request, res: import("express").Response, routerId: number) {
  if (req.companyId == null) {
    res.status(403).json({ error: "Forbidden: no company scope for this account" });
    return null;
  }
  const [router_] = await db.select().from(routersTable)
    .where(and(eq(routersTable.id, routerId), eq(routersTable.companyId, req.companyId)));
  if (!router_) {
    res.status(404).json({ error: "Router not found" });
    return null;
  }
  return router_;
}

// ── GET /api/infrastructure/status ──────────────────────────────────────────
router.get("/infrastructure/status", async (req, res) => {
  try {
    const vpn = await db.select().from(vpnConfigTable).limit(1);
    const vpnCfg = vpn[0] ?? null;

    const radiusRows = await db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.key, "radiusServer"));
    const radiusServer = radiusRows[0]?.value ?? null;

    const radiusSecretRows = await db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.key, "radiusSecret"));
    const radiusSecret = radiusSecretRows[0]?.value ?? null;

    // Router/cert counts are per-tenant data — never show cross-company
    // rows, and show nothing (not everything) when an owner hasn't picked
    // a company yet.
    const allRouters = req.companyId != null
      ? await db.select().from(routersTable).where(eq(routersTable.companyId, req.companyId))
      : [];
    const vpnCerts = req.companyId != null
      ? await db.select({ cert: routerVpnCertsTable })
          .from(routerVpnCertsTable)
          .innerJoin(routersTable, eq(routerVpnCertsTable.routerId, routersTable.id))
          .where(eq(routersTable.companyId, req.companyId))
          .then(rows => rows.map(r => r.cert))
      : [];

    return res.json({
      radius: {
        configured: !!(radiusServer && radiusSecret),
        server: radiusServer,
      },
      vpn: {
        configured: vpnCfg?.isConfigured ?? false,
        certsGenerated: !!(vpnCfg?.caCert),
        serverIp: vpnCfg?.serverPublicIp ?? null,
        vpnPort: vpnCfg?.vpnPort ?? 1194,
        vpnProtocol: vpnCfg?.vpnProtocol ?? "tcp",
        vpnSubnet: vpnCfg?.vpnSubnet ?? "10.8.0.0",
        vpnSubnetMask: vpnCfg?.vpnSubnetMask ?? "255.255.255.0",
        vpnDns: vpnCfg?.vpnDns ?? "8.8.8.8",
        certsGeneratedAt: vpnCfg?.certsGeneratedAt ?? null,
      },
      routerCerts: vpnCerts.map((c: RouterVpnCert) => ({
        id: c.id,
        routerId: c.routerId,
        routerName: c.routerName,
        vpnIp: c.vpnIp,
        createdAt: c.createdAt,
        revoked: !!c.revokedAt,
      })),
      routerCount: allRouters.length,
    });
  } catch (err) {
    req.log.error(err, "infrastructure status error");
    return res.status(500).json({ error: "Failed to get infrastructure status" });
  }
});

// ── POST /api/infrastructure/radius/test ────────────────────────────────────
router.post("/infrastructure/radius/test", async (req, res) => {
  try {
    const rows = await db.select().from(settingsTable).where(eq(settingsTable.key, "radiusServer"));
    const radiusServer = rows[0]?.value ?? null;
    if (!radiusServer) {
      return res.status(400).json({ success: false, message: "RADIUS server not configured in Settings → Network." });
    }

    const { createConnection } = await import("net");
    const portRows = await db.select().from(settingsTable).where(eq(settingsTable.key, "radiusPort"));
    const port = parseInt(portRows[0]?.value ?? "1812", 10);
    const host = radiusServer;

    await new Promise<void>((resolve, reject) => {
      const sock = createConnection({ host, port, timeout: 4000 });
      sock.on("connect", () => { sock.destroy(); resolve(); });
      sock.on("timeout", () => { sock.destroy(); reject(new Error("Connection timed out")); });
      sock.on("error", (e) => reject(e));
    });

    return res.json({ success: true, message: `Reached ${host}:${port} — RADIUS port is open.` });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return res.json({ success: false, message: `Cannot reach RADIUS server: ${msg}` });
  }
});

// ── POST /api/infrastructure/radius/export-users ────────────────────────────
router.post("/infrastructure/radius/export-users", async (req, res) => {
  try {
    if (req.companyId == null) {
      return res.status(403).json({ error: "Forbidden: no company scope for this account" });
    }
    const companyId = req.companyId;

    const { subscriptionsTable, customersTable, plansTable } = await import("@workspace/db");

    const subs = await db
      .select({
        username: customersTable.email,
        password: subscriptionsTable.id,
        planName: plansTable.name,
        speedDown: plansTable.downloadSpeed,
        speedUp: plansTable.uploadSpeed,
        status: subscriptionsTable.status,
      })
      .from(subscriptionsTable)
      .innerJoin(customersTable, eq(subscriptionsTable.customerId, customersTable.id))
      .innerJoin(plansTable, eq(subscriptionsTable.planId, plansTable.id))
      .where(and(eq(subscriptionsTable.status, "active"), eq(subscriptionsTable.companyId, companyId)));

    const lines: string[] = [
      "-- NetPulse RADIUS User Export",
      `-- Generated: ${new Date().toISOString()}`,
      "-- Run in your FreeRADIUS PostgreSQL database",
      "",
      "BEGIN;",
      "",
    ];

    for (const sub of subs) {
      const user = sub.username ?? `user-${sub.password}`;
      const pass = `np-${sub.password}`;
      const dl = sub.speedDown ? `${sub.speedDown}k` : "10240k";
      const ul = sub.speedUp ? `${sub.speedUp}k` : "5120k";
      lines.push(`-- ${sub.planName ?? "Plan"} — ${user}`);
      lines.push(`INSERT INTO radcheck (username, attribute, op, value)`);
      lines.push(`  VALUES ('${user}', 'Cleartext-Password', ':=', '${pass}')`);
      lines.push(`  ON CONFLICT (username, attribute) DO UPDATE SET value = EXCLUDED.value;`);
      lines.push(`INSERT INTO radreply (username, attribute, op, value)`);
      lines.push(`  VALUES ('${user}', 'Mikrotik-Rate-Limit', ':=', '${dl}/${ul}')`);
      lines.push(`  ON CONFLICT (username, attribute) DO UPDATE SET value = EXCLUDED.value;`);
      lines.push("");
    }

    lines.push("COMMIT;");

    const secretRows = await db.select().from(settingsTable).where(eq(settingsTable.key, "radiusSecret"));
    const secret = secretRows[0]?.value ?? "change-me";

    const nasRows = await db.select().from(routersTable).where(eq(routersTable.companyId, companyId));
    lines.push("", "-- NAS (Router) entries");
    for (const r of nasRows) {
      lines.push(`INSERT INTO nas (nasname, shortname, type, secret, description)`);
      lines.push(`  VALUES ('${r.ipAddress}', '${r.name}', 'other', '${secret}', 'NetPulse router')`);
      lines.push(`  ON CONFLICT (nasname) DO UPDATE SET secret = EXCLUDED.secret;`);
      lines.push("");
    }

    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Content-Disposition", "attachment; filename=netpulse-radius-users.sql");
    return res.send(lines.join("\n"));
  } catch (err) {
    req.log.error(err, "radius export error");
    return res.status(500).json({ error: "Export failed" });
  }
});

// ── GET /api/infrastructure/vpn/config ──────────────────────────────────────
router.get("/infrastructure/vpn/config", async (req, res) => {
  try {
    const rows = await db.select().from(vpnConfigTable).limit(1);
    const cfg = rows[0];
    if (!cfg) return res.json(null);
    return res.json({
      id: cfg.id,
      serverPublicIp: cfg.serverPublicIp,
      vpnPort: cfg.vpnPort,
      vpnProtocol: cfg.vpnProtocol,
      vpnSubnet: cfg.vpnSubnet,
      vpnSubnetMask: cfg.vpnSubnetMask,
      vpnDns: cfg.vpnDns,
      isConfigured: cfg.isConfigured,
      certsGenerated: !!(cfg.caCert),
      certsGeneratedAt: cfg.certsGeneratedAt,
    });
  } catch (err) {
    req.log.error(err, "vpn config get error");
    return res.status(500).json({ error: "Failed to get VPN config" });
  }
});

// ── POST /api/infrastructure/vpn/config ─────────────────────────────────────
router.post("/infrastructure/vpn/config", async (req, res) => {
  try {
    const { serverPublicIp, vpnPort, vpnProtocol, vpnSubnet, vpnSubnetMask, vpnDns } = req.body as Record<string, string | number>;
    const port = Number(vpnPort ?? 1194);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return res.status(400).json({ error: "VPN port must be between 1 and 65535." });
    }
    if (String(vpnProtocol ?? "tcp").toLowerCase() !== "tcp") {
      return res.status(400).json({ error: "RouterOS management VPN supports TCP only." });
    }

    const existing = await db.select().from(vpnConfigTable).limit(1);
    const data = {
      serverPublicIp: String(serverPublicIp ?? ""),
      vpnPort: port,
      vpnProtocol: "tcp",
      vpnSubnet: String(vpnSubnet ?? "10.8.0.0"),
      vpnSubnetMask: String(vpnSubnetMask ?? "255.255.255.0"),
      vpnDns: String(vpnDns ?? "8.8.8.8"),
      isConfigured: true,
      updatedAt: new Date(),
    };

    if (existing.length > 0) {
      await db.update(vpnConfigTable).set(data).where(eq(vpnConfigTable.id, existing[0].id));
    } else {
      await db.insert(vpnConfigTable).values(data);
    }

    return res.json({ success: true });
  } catch (err) {
    req.log.error(err, "vpn config save error");
    return res.status(500).json({ error: "Failed to save VPN config" });
  }
});

// ── POST /api/infrastructure/vpn/generate-certs ─────────────────────────────
// Generates CA + server certificates (takes ~10-20 seconds)
router.post("/infrastructure/vpn/generate-certs", async (req, res) => {
  try {
    const existing = await db.select().from(vpnConfigTable).limit(1);
    if (existing.length === 0) {
      return res.status(400).json({ error: "Save VPN configuration before generating certificates." });
    }

    req.log.info("Generating VPN certificates (CA + server)...");
    const certs = await generateVpnServerCerts();
    req.log.info("VPN certificate generation complete");

    await db
      .update(vpnConfigTable)
      .set({
        caCert: certs.ca.cert,
        caKey: certs.ca.key,
        serverCert: certs.server.cert,
        serverKey: certs.server.key,
        certsGeneratedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(vpnConfigTable.id, existing[0].id));

    return res.json({ success: true, message: "CA and server certificates generated successfully." });
  } catch (err) {
    req.log.error(err, "vpn cert gen error");
    return res.status(500).json({ error: "Certificate generation failed" });
  }
});

// ── POST /api/infrastructure/vpn/sync-installed-certs ────────────────────────
// Imports the OpenVPN PKI produced by NetPulse's Ubuntu installer. This route is
// deliberately owner-only: it reads the CA signing key from the server filesystem
// but never includes private key material in its response.
router.post("/infrastructure/vpn/sync-installed-certs", requireRole("owner"), async (req, res) => {
  try {
    const existing = await db.select().from(vpnConfigTable).limit(1);
    if (existing.length === 0) {
      return res.status(400).json({ error: "Save VPN configuration before syncing installed certificates." });
    }

    const installed = await loadInstalledOpenVpnCertificatesWithHelper();
    await db
      .update(vpnConfigTable)
      .set({
        ...installed,
        certsGeneratedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(vpnConfigTable.id, existing[0].id));

    req.log.info("Synced the installed OpenVPN certificate authority into NetPulse");
    return res.json({
      success: true,
      message: "Installed OpenVPN certificates synced. Reprovision routers that received certificates before this sync.",
    });
  } catch (err) {
    req.log.error(err, "installed OpenVPN certificate sync error");
    return res.status(400).json({
      error: "Could not sync the installed OpenVPN certificates. Confirm OpenVPN was installed with NetPulse's deployment script.",
    });
  }
});

// ── POST /api/infrastructure/vpn/repair-service ───────────────────────────────
// The root-owned helper only handles NetPulse's exact OpenVPN service/config.
// This stays owner-only because it can restart a shared system service.
router.post("/infrastructure/vpn/repair-service", requireRole("owner"), async (req, res) => {
  const result = await repairOpenVpnService();
  req.log.info(
    { state: result.state, success: result.success, eventCount: result.events.length },
    "OpenVPN repair helper completed",
  );

  if (result.success) {
    return res.json(result);
  }

  return res.status(result.state === "unavailable" ? 503 : 409).json(result);
});

// ── GET /api/infrastructure/vpn/server-conf ─────────────────────────────────
// Download the OpenVPN server.conf file
router.get("/infrastructure/vpn/server-conf", async (req, res) => {
  try {
    const rows = await db.select().from(vpnConfigTable).limit(1);
    const cfg = rows[0];
    if (!cfg || !cfg.caCert) {
      return res.status(400).json({ error: "Generate certificates first." });
    }

    const conf = generateOpenVpnServerConf({
      port: cfg.vpnPort ?? 1194,
      protocol: cfg.vpnProtocol ?? "tcp",
      subnet: cfg.vpnSubnet ?? "10.8.0.0",
      subnetMask: cfg.vpnSubnetMask ?? "255.255.255.0",
      dns: cfg.vpnDns ?? "8.8.8.8",
      caCert: cfg.caCert!,
      serverCert: cfg.serverCert!,
      serverKey: cfg.serverKey!,
    });

    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Content-Disposition", "attachment; filename=netpulse-vpn-server.conf");
    return res.send(conf);
  } catch (err) {
    req.log.error(err, "vpn server conf error");
    return res.status(500).json({ error: "Failed to generate server config" });
  }
});

// ── GET /api/infrastructure/vpn/clients ─────────────────────────────────────
router.get("/infrastructure/vpn/clients", async (req, res) => {
  try {
    const certs = req.companyId != null
      ? await db.select({ cert: routerVpnCertsTable })
          .from(routerVpnCertsTable)
          .innerJoin(routersTable, eq(routerVpnCertsTable.routerId, routersTable.id))
          .where(eq(routersTable.companyId, req.companyId))
          .then(rows => rows.map(r => r.cert))
      : [];
    return res.json(
      certs.map((c: RouterVpnCert) => ({
        id: c.id,
        routerId: c.routerId,
        routerName: c.routerName,
        vpnIp: c.vpnIp,
        createdAt: c.createdAt,
        revoked: !!c.revokedAt,
      }))
    );
  } catch (err) {
    req.log.error(err, "vpn clients error");
    return res.status(500).json({ error: "Failed to list VPN clients" });
  }
});

// ── POST /api/infrastructure/vpn/client/:routerId/generate ──────────────────
router.post("/infrastructure/vpn/client/:routerId/generate", async (req, res) => {
  const routerId = parseInt(req.params.routerId, 10);
  try {
    const router_ = await requireOwnedRouter(req, res, routerId);
    if (!router_) return;

    const vpnRows = await db.select().from(vpnConfigTable).limit(1);
    const vpnCfg = vpnRows[0];
    if (!vpnCfg || !vpnCfg.caCert || !vpnCfg.caKey) {
      return res.status(400).json({ error: "VPN certificates not yet generated. Generate them first in Settings → Infrastructure." });
    }

    const cn = `netpulse-${router_.name.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase()}`;
    req.log.info(`Generating client cert for router ${routerId} (${cn})`);
    const clientCert = await generateClientCert(cn, vpnCfg.caCert, vpnCfg.caKey);

    // Assign next available VPN IP
    const existing = await db.select().from(routerVpnCertsTable).where(eq(routerVpnCertsTable.routerId, routerId));
    const allCerts = await db.select().from(routerVpnCertsTable);
    const usedIps = new Set(allCerts.map((c: RouterVpnCert) => c.vpnIp).filter(Boolean));

    const subnet = vpnCfg.vpnSubnet ?? "10.8.0.0";
    const base = subnet.split(".").slice(0, 3).join(".");
    let vpnIp = "";
    for (let i = 2; i <= 254; i++) {
      const candidate = `${base}.${i}`;
      if (!usedIps.has(candidate)) { vpnIp = candidate; break; }
    }

    if (existing.length > 0) {
      await db
        .update(routerVpnCertsTable)
        .set({
          clientCert: clientCert.cert,
          clientKey: clientCert.key,
          vpnIp,
          routerName: router_.name,
          revokedAt: null,
          createdAt: new Date(),
        })
        .where(eq(routerVpnCertsTable.routerId, routerId));
    } else {
      await db.insert(routerVpnCertsTable).values({
        routerId,
        routerName: router_.name,
        clientCert: clientCert.cert,
        clientKey: clientCert.key,
        vpnIp,
      });
    }

    return res.json({ success: true, vpnIp, message: `Client certificate generated. VPN IP: ${vpnIp}` });
  } catch (err) {
    req.log.error(err, "client cert gen error");
    return res.status(500).json({ error: "Client certificate generation failed" });
  }
});

// ── DELETE /api/infrastructure/vpn/client/:routerId ─────────────────────────
router.delete("/infrastructure/vpn/client/:routerId", async (req, res) => {
  const routerId = parseInt(req.params.routerId, 10);
  try {
    const router_ = await requireOwnedRouter(req, res, routerId);
    if (!router_) return;

    await db
      .update(routerVpnCertsTable)
      .set({ revokedAt: new Date() })
      .where(eq(routerVpnCertsTable.routerId, routerId));
    return res.json({ success: true });
  } catch (err) {
    req.log.error(err, "revoke cert error");
    return res.status(500).json({ error: "Failed to revoke certificate" });
  }
});

// ── GET /api/routers/:id/ros-script ─────────────────────────────────────────
router.get("/routers/:id/ros-script", async (req, res) => {
  const routerId = parseInt(req.params.id, 10);
  try {
    const router_ = await requireOwnedRouter(req, res, routerId);
    if (!router_) return;

    const vpnRows = await db.select().from(vpnConfigTable).limit(1);
    const vpnCfg = vpnRows[0];
    if (!vpnCfg?.caCert) {
      return res.status(400).json({ error: "VPN not configured. Set up OpenVPN in Settings → Infrastructure first." });
    }

    const certRows = await db
      .select()
      .from(routerVpnCertsTable)
      .where(eq(routerVpnCertsTable.routerId, routerId));
    const certEntry = certRows[0];
    if (!certEntry?.clientCert || certEntry.revokedAt) {
      return res.status(400).json({ error: "No active VPN certificate for this router. Generate one first." });
    }

    const secretRows = await db.select().from(settingsTable).where(eq(settingsTable.key, "radiusSecret"));
    const radiusSecret = secretRows[0]?.value ?? "change-me-in-settings";
    const protocol = req.get("x-forwarded-proto") ?? req.protocol;
    const host = req.get("x-forwarded-host") ?? req.get("host") ?? "localhost";

    const script = generateRosScript({
      routerName: router_.name,
      serverIp: vpnCfg.serverPublicIp ?? "YOUR_SERVER_IP",
      vpnPort: vpnCfg.vpnPort ?? 1194,
      vpnProtocol: vpnCfg.vpnProtocol ?? "tcp",
      vpnSubnet: vpnCfg.vpnSubnet ?? "10.8.0.0",
      caCertPem: vpnCfg.caCert!,
      clientCertPem: certEntry.clientCert!,
      clientKeyPem: certEntry.clientKey!,
      radiusSecret,
      token: router_.provisionToken ?? undefined,
      serverUrl: `${protocol}://${host}`,
    });

    const safeName = router_.name.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=netpulse-vpn-${safeName}.rsc`);
    return res.send(script);
  } catch (err) {
    req.log.error(err, "ros-script error");
    return res.status(500).json({ error: "Failed to generate script" });
  }
});

export default router;
