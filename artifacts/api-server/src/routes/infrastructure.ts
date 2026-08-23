import { Router } from "express";
import { eq } from "drizzle-orm";
import {
  db, vpnConfigTable, routerVpnCertsTable, routersTable,
  settingsTable, type RouterVpnCert,
} from "@workspace/db";
import { generateVpnServerCerts, generateClientCert, generateOpenVpnServerConf, generateRosScript } from "../lib/certGen";

const router = Router();

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

    const allRouters = await db.select().from(routersTable);
    const vpnCerts = await db.select().from(routerVpnCertsTable);

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
      .where(eq(subscriptionsTable.status, "active"));

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

    const nasRows = await db.select().from(routersTable);
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

    const existing = await db.select().from(vpnConfigTable).limit(1);
    const data = {
      serverPublicIp: String(serverPublicIp ?? ""),
      vpnPort: Number(vpnPort ?? 1194),
      vpnProtocol: String(vpnProtocol ?? "tcp"),
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
    const certs = await db.select().from(routerVpnCertsTable);
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
    const vpnRows = await db.select().from(vpnConfigTable).limit(1);
    const vpnCfg = vpnRows[0];
    if (!vpnCfg || !vpnCfg.caCert || !vpnCfg.caKey) {
      return res.status(400).json({ error: "VPN certificates not yet generated. Generate them first in Settings → Infrastructure." });
    }

    const routerRows = await db.select().from(routersTable).where(eq(routersTable.id, routerId));
    if (!routerRows.length) return res.status(404).json({ error: "Router not found" });
    const router_ = routerRows[0];

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
    const routerRows = await db.select().from(routersTable).where(eq(routersTable.id, routerId));
    if (!routerRows.length) return res.status(404).json({ error: "Router not found" });
    const router_ = routerRows[0];

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
