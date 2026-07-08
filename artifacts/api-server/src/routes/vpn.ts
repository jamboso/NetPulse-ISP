import { Router } from "express";
import { exec } from "child_process";
import { promisify } from "util";
import { readFile } from "fs/promises";
import { db } from "@workspace/db";
import { vpnConfigsTable } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { requireRole } from "../middlewares/requireRole";

const execAsync = promisify(exec);
const router = Router();

const VPN_ENABLED = process.env["OPENVPN_ENABLED"] !== "false";

const CN_RE = /^[a-z0-9][a-z0-9.\-]{0,61}[a-z0-9]$/;

function vpnUnavailable(res: any): void {
  res.status(503).json({
    error: "VPN server not configured on this host. Set OPENVPN_ENABLED=true after running the installer.",
  });
}

function genCN(customerId: number): string {
  return `np-${customerId}-${Date.now()}`;
}

function genRouterCN(routerId: number): string {
  return `nr-${routerId}-${Date.now()}`;
}

/** Parse /var/log/openvpn/status.log and return a map of CN → remoteIp */
async function parseStatusLog(): Promise<Map<string, string>> {
  const connected = new Map<string, string>();
  try {
    const text = await readFile("/var/log/openvpn/status.log", "utf8");
    let inClientList = false;
    for (const line of text.split("\n")) {
      if (line.startsWith("Common Name,")) { inClientList = true; continue; }
      if (line.startsWith("ROUTING TABLE")) { inClientList = false; continue; }
      if (inClientList && line.trim() && !line.startsWith("OpenVPN")) {
        const parts = line.split(",");
        const cn        = parts[0]?.trim();
        const rawAddr   = parts[1]?.trim();            // "1.2.3.4:12345"
        const remoteIp  = rawAddr?.split(":")[0] ?? ""; // strip port
        if (cn) connected.set(cn, remoteIp);
      }
    }
  } catch {
    // status.log doesn't exist in dev — return empty map
  }
  return connected;
}

function formatRow(
  r: typeof vpnConfigsTable.$inferSelect,
  sessions: Map<string, string>,
  vpnAvailable: boolean,
) {
  const remoteIp = r.revokedAt === null ? (sessions.get(r.commonName) ?? null) : null;
  return {
    id:           r.id,
    customerId:   r.customerId,
    routerId:     r.routerId,
    commonName:   r.commonName,
    issuedAt:     r.issuedAt.toISOString(),
    revokedAt:    r.revokedAt?.toISOString() ?? null,
    revokedBy:    r.revokedBy ?? null,
    connected:    r.revokedAt === null && sessions.has(r.commonName),
    remoteIp,
    vpnAvailable,
  };
}

// ── Customer VPN ───────────────────────────────────────────────────────────────

router.get("/customers/:id/vpn", async (req, res) => {
  const customerId = parseInt(req.params["id"] as string);
  if (isNaN(customerId)) { res.status(400).json({ error: "Invalid customer ID" }); return; }

  const rows = await db
    .select()
    .from(vpnConfigsTable)
    .where(eq(vpnConfigsTable.customerId, customerId))
    .orderBy(vpnConfigsTable.issuedAt);

  const sessions = VPN_ENABLED ? await parseStatusLog() : new Map<string, string>();

  res.json({
    vpnAvailable: VPN_ENABLED,
    configs: rows.map(r => formatRow(r, sessions, VPN_ENABLED)),
  });
});

router.post("/customers/:id/vpn", requireRole("admin"), async (req, res) => {
  if (!VPN_ENABLED) { vpnUnavailable(res); return; }

  const customerId = parseInt(req.params["id"] as string);
  if (isNaN(customerId)) { res.status(400).json({ error: "Invalid customer ID" }); return; }

  const cn = genCN(customerId);
  if (!CN_RE.test(cn)) { res.status(400).json({ error: "Generated CN failed allowlist check" }); return; }

  let ovpnContent: string;
  try {
    const { stdout } = await execAsync(`/usr/local/bin/netpulse-vpn-issue ${cn}`, { timeout: 30_000 });
    ovpnContent = stdout.trim();
    if (!ovpnContent || !ovpnContent.includes("client")) {
      throw new Error("Issue script returned unexpected output");
    }
  } catch (err: any) {
    req.log.error({ err: err.message, cn }, "VPN issue failed");
    res.status(500).json({ error: `VPN issue failed: ${err.message}` });
    return;
  }

  const [row] = await db.insert(vpnConfigsTable).values({
    customerId,
    commonName:   cn,
    ovpnConfig:   ovpnContent,
  }).returning();

  req.log.info({ customerId, cn }, "VPN config issued");
  res.status(201).json({
    id:           row!.id,
    customerId:   row!.customerId,
    commonName:   row!.commonName,
    issuedAt:     row!.issuedAt.toISOString(),
    revokedAt:    null,
    revokedBy:    null,
    connected:    false,
    remoteIp:     null,
    vpnAvailable: true,
    ovpnConfig:   row!.ovpnConfig,
  });
});

router.get("/customers/:id/vpn/:configId/download", requireRole("admin"), async (req, res) => {
  const customerId = parseInt(req.params["id"] as string);
  const configId   = parseInt(req.params["configId"] as string);

  const [row] = await db
    .select()
    .from(vpnConfigsTable)
    .where(and(
      eq(vpnConfigsTable.id, configId),
      eq(vpnConfigsTable.customerId, customerId),
      isNull(vpnConfigsTable.revokedAt),
    ));

  if (!row) { res.status(404).json({ error: "VPN config not found or revoked" }); return; }

  res.setHeader("Content-Type", "application/x-openvpn-profile");
  res.setHeader("Content-Disposition", `attachment; filename="${row.commonName}.ovpn"`);
  res.send(row.ovpnConfig);
});

router.delete("/customers/:id/vpn/:configId", requireRole("admin"), async (req, res) => {
  if (!VPN_ENABLED) { vpnUnavailable(res); return; }

  const customerId = parseInt(req.params["id"] as string);
  const configId   = parseInt(req.params["configId"] as string);

  const [row] = await db
    .select()
    .from(vpnConfigsTable)
    .where(and(
      eq(vpnConfigsTable.id, configId),
      eq(vpnConfigsTable.customerId, customerId),
    ));

  if (!row) { res.status(404).json({ error: "VPN config not found" }); return; }
  if (row.revokedAt !== null) { res.status(409).json({ error: "Already revoked" }); return; }

  const cn = row.commonName;
  if (!CN_RE.test(cn)) { res.status(400).json({ error: "CN failed allowlist check" }); return; }

  try {
    await execAsync(`/usr/local/bin/netpulse-vpn-revoke ${cn}`, { timeout: 30_000 });
  } catch (err: any) {
    req.log.error({ err: err.message, cn }, "VPN revoke failed");
    res.status(500).json({ error: `VPN revoke failed: ${err.message}` });
    return;
  }

  const [updated] = await db
    .update(vpnConfigsTable)
    .set({ revokedAt: new Date(), revokedBy: req.user!.email })
    .where(eq(vpnConfigsTable.id, configId))
    .returning();

  req.log.info({ customerId, cn }, "VPN config revoked");
  res.json({
    id:           updated!.id,
    customerId:   updated!.customerId,
    commonName:   updated!.commonName,
    issuedAt:     updated!.issuedAt.toISOString(),
    revokedAt:    updated!.revokedAt?.toISOString() ?? null,
    revokedBy:    updated!.revokedBy ?? null,
    connected:    false,
    remoteIp:     null,
    vpnAvailable: true,
  });
});

// ── Router VPN ─────────────────────────────────────────────────────────────────

router.get("/routers/:id/vpn", async (req, res) => {
  const routerId = parseInt(req.params["id"] as string);
  if (isNaN(routerId)) { res.status(400).json({ error: "Invalid router ID" }); return; }

  const rows = await db
    .select()
    .from(vpnConfigsTable)
    .where(eq(vpnConfigsTable.routerId, routerId))
    .orderBy(vpnConfigsTable.issuedAt);

  const sessions = VPN_ENABLED ? await parseStatusLog() : new Map<string, string>();

  res.json({
    vpnAvailable: VPN_ENABLED,
    configs: rows.map(r => formatRow(r, sessions, VPN_ENABLED)),
  });
});

router.post("/routers/:id/vpn", requireRole("admin"), async (req, res) => {
  if (!VPN_ENABLED) { vpnUnavailable(res); return; }

  const routerId = parseInt(req.params["id"] as string);
  if (isNaN(routerId)) { res.status(400).json({ error: "Invalid router ID" }); return; }

  const cn = genRouterCN(routerId);
  if (!CN_RE.test(cn)) { res.status(400).json({ error: "Generated CN failed allowlist check" }); return; }

  let ovpnContent: string;
  try {
    const { stdout } = await execAsync(`/usr/local/bin/netpulse-vpn-issue ${cn}`, { timeout: 30_000 });
    ovpnContent = stdout.trim();
    if (!ovpnContent || !ovpnContent.includes("client")) {
      throw new Error("Issue script returned unexpected output");
    }
  } catch (err: any) {
    req.log.error({ err: err.message, cn }, "Router VPN issue failed");
    res.status(500).json({ error: `VPN issue failed: ${err.message}` });
    return;
  }

  const [row] = await db.insert(vpnConfigsTable).values({
    routerId,
    commonName:   cn,
    ovpnConfig:   ovpnContent,
  }).returning();

  req.log.info({ routerId, cn }, "Router VPN config issued");
  res.status(201).json({
    id:           row!.id,
    routerId:     row!.routerId,
    commonName:   row!.commonName,
    issuedAt:     row!.issuedAt.toISOString(),
    revokedAt:    null,
    revokedBy:    null,
    connected:    false,
    remoteIp:     null,
    vpnAvailable: true,
    ovpnConfig:   row!.ovpnConfig,
  });
});

router.get("/routers/:id/vpn/:configId/download", requireRole("admin"), async (req, res) => {
  const routerId = parseInt(req.params["id"] as string);
  const configId = parseInt(req.params["configId"] as string);

  const [row] = await db
    .select()
    .from(vpnConfigsTable)
    .where(and(
      eq(vpnConfigsTable.id, configId),
      eq(vpnConfigsTable.routerId, routerId),
      isNull(vpnConfigsTable.revokedAt),
    ));

  if (!row) { res.status(404).json({ error: "VPN config not found or revoked" }); return; }

  res.setHeader("Content-Type", "application/x-openvpn-profile");
  res.setHeader("Content-Disposition", `attachment; filename="${row.commonName}.ovpn"`);
  res.send(row.ovpnConfig);
});

router.delete("/routers/:id/vpn/:configId", requireRole("admin"), async (req, res) => {
  if (!VPN_ENABLED) { vpnUnavailable(res); return; }

  const routerId = parseInt(req.params["id"] as string);
  const configId = parseInt(req.params["configId"] as string);

  const [row] = await db
    .select()
    .from(vpnConfigsTable)
    .where(and(
      eq(vpnConfigsTable.id, configId),
      eq(vpnConfigsTable.routerId, routerId),
    ));

  if (!row) { res.status(404).json({ error: "VPN config not found" }); return; }
  if (row.revokedAt !== null) { res.status(409).json({ error: "Already revoked" }); return; }

  const cn = row.commonName;
  if (!CN_RE.test(cn)) { res.status(400).json({ error: "CN failed allowlist check" }); return; }

  try {
    await execAsync(`/usr/local/bin/netpulse-vpn-revoke ${cn}`, { timeout: 30_000 });
  } catch (err: any) {
    req.log.error({ err: err.message, cn }, "Router VPN revoke failed");
    res.status(500).json({ error: `VPN revoke failed: ${err.message}` });
    return;
  }

  const [updated] = await db
    .update(vpnConfigsTable)
    .set({ revokedAt: new Date(), revokedBy: req.user!.email })
    .where(eq(vpnConfigsTable.id, configId))
    .returning();

  req.log.info({ routerId, cn }, "Router VPN config revoked");
  res.json({
    id:           updated!.id,
    routerId:     updated!.routerId,
    commonName:   updated!.commonName,
    issuedAt:     updated!.issuedAt.toISOString(),
    revokedAt:    updated!.revokedAt?.toISOString() ?? null,
    revokedBy:    updated!.revokedBy ?? null,
    connected:    false,
    remoteIp:     null,
    vpnAvailable: true,
  });
});

export default router;
