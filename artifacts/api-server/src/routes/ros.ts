import { Router } from "express";
import { db } from "@workspace/db";
import { routersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getRouterManagementHost, routerManagementUnavailableMessage } from "../lib/routerManagement";

const router = Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

function rosUrl(ip: string, ssl: boolean, path: string): string {
  const scheme = ssl ? "https" : "http";
  return `${scheme}://${ip}/rest${path}`;
}

async function rosGet(ip: string, ssl: boolean, username: string, password: string, path: string): Promise<unknown> {
  const url = rosUrl(ip, ssl, path);
  const creds = Buffer.from(`${username}:${password}`).toString("base64");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Basic ${creds}`,
        Accept: "application/json",
      },
      signal: ctrl.signal,
      // allow self-signed TLS certs common on MikroTik devices
      // @ts-ignore
      ...(ssl ? { rejectUnauthorized: false } : {}),
    });
    clearTimeout(timer);
    if (res.status === 401) throw new Error("Authentication failed — check username/password");
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`RouterOS returned HTTP ${res.status} for ${path}`);
    const text = await res.text();
    if (!text.trim()) return [];
    return JSON.parse(text);
  } catch (err: any) {
    clearTimeout(timer);
    if (err.name === "AbortError") throw new Error(`Timeout connecting to ${ip}`);
    throw err;
  }
}

async function safeGet(ip: string, ssl: boolean, user: string, pass: string, path: string): Promise<unknown> {
  try {
    return await rosGet(ip, ssl, user, pass, path);
  } catch {
    return null;
  }
}

// ── Parse helpers ─────────────────────────────────────────────────────────────

function parseBytes(s: string | undefined): number {
  return s ? parseInt(s, 10) || 0 : 0;
}

function enrichInterface(iface: Record<string, any>): Record<string, unknown> {
  return {
    ...iface,
    txBytes: parseBytes(iface["tx-byte"]),
    rxBytes: parseBytes(iface["rx-byte"]),
    txPackets: parseBytes(iface["tx-packet"]),
    rxPackets: parseBytes(iface["rx-packet"]),
    running: iface.running === true || iface.running === "true",
    disabled: iface.disabled === true || iface.disabled === "true",
    comment: iface.comment || "",
  };
}

function enrichPppoe(session: Record<string, string>): Record<string, unknown> {
  return {
    ...session,
    txBytes: parseBytes(session["bytes-out"]),
    rxBytes: parseBytes(session["bytes-in"]),
    txPackets: parseBytes(session["packets-out"]),
    rxPackets: parseBytes(session["packets-in"]),
  };
}

// ── Route ─────────────────────────────────────────────────────────────────────

router.get("/routers/:id/ros/live", async (req, res) => {
  const id = parseInt(req.params.id!);
  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) {
    res.status(404).json({ error: "Router not found" });
    return;
  }

  if (r.routerType !== "routeros") {
    res.status(400).json({ error: "RouterOS live data only supported for RouterOS devices" });
    return;
  }

  const ipAddress = getRouterManagementHost(r);
  if (!ipAddress) {
    res.status(409).json({ error: routerManagementUnavailableMessage() });
    return;
  }
  const { username, password } = r;
  const ssl = r.apiSsl ?? false;
  const fetchedAt = new Date().toISOString();

  // Test connectivity first
  let identityRaw: unknown;
  try {
    identityRaw = await rosGet(ipAddress, ssl, username, password, "/system/identity");
  } catch (err: any) {
    res.status(502).json({
      routerId: id,
      fetchedAt,
      error: err.message ?? "Cannot reach RouterOS REST API",
      identity: null, resources: null, interfaces: [], pppoeActive: [],
      dhcpLeases: [], ipAddresses: [], queues: [], logs: [],
      wirelessClients: [], bgpPeers: [], ospfNeighbors: [],
    });
    return;
  }

  // Fetch all sections in parallel
  const [
    resourcesRaw, interfacesRaw, pppoeRaw, dhcpRaw,
    ipAddrRaw, queuesRaw, logsRaw, wirelessRaw,
    bgpRaw, ospfRaw, etherStatsRaw,
  ] = await Promise.all([
    safeGet(ipAddress, ssl, username, password, "/system/resource"),
    safeGet(ipAddress, ssl, username, password, "/interface"),
    safeGet(ipAddress, ssl, username, password, "/ppp/active"),
    safeGet(ipAddress, ssl, username, password, "/ip/dhcp-server/lease"),
    safeGet(ipAddress, ssl, username, password, "/ip/address"),
    safeGet(ipAddress, ssl, username, password, "/queue/simple"),
    safeGet(ipAddress, ssl, username, password, "/log?limit=50"),
    safeGet(ipAddress, ssl, username, password, "/interface/wireless/registration-table"),
    safeGet(ipAddress, ssl, username, password, "/routing/bgp/peer"),
    safeGet(ipAddress, ssl, username, password, "/routing/ospf/neighbor"),
    safeGet(ipAddress, ssl, username, password, "/interface/ethernet/print stats"),
  ]);

  const ifaces = Array.isArray(interfacesRaw) ? (interfacesRaw as Record<string, string>[]).map(enrichInterface) : [];

  // Build a map of interface name → bytes for fallback (RouterOS /ppp/active often returns 0 for bytes)
  const ifaceByName = new Map<string, Record<string, string>>();
  if (Array.isArray(interfacesRaw)) {
    for (const iface of interfacesRaw as Record<string, string>[]) {
      if (iface.name) ifaceByName.set(iface.name, iface);
    }
  }

  const pppoe = Array.isArray(pppoeRaw)
    ? (pppoeRaw as Record<string, string>[]).map(session => {
        const base = enrichPppoe(session);
        // If /ppp/active gave 0 bytes, try the matching PPPoE virtual interface
        if ((base.txBytes as number) === 0 && (base.rxBytes as number) === 0) {
          const ifaceName = session.interface || session.name; // e.g. "<pppoe-KS2153>" or username
          const matched = ifaceByName.get(ifaceName) ?? ifaceByName.get(`<pppoe-${session.name}>`);
          if (matched) {
            return {
              ...base,
              txBytes: parseBytes(matched["tx-byte"]),
              rxBytes: parseBytes(matched["rx-byte"]),
            };
          }
        }
        return base;
      })
    : [];

  res.json({
    routerId: id,
    fetchedAt,
    error: null,
    identity: identityRaw,
    resources: resourcesRaw,
    interfaces: ifaces,
    pppoeActive: pppoe,
    dhcpLeases: Array.isArray(dhcpRaw) ? dhcpRaw : [],
    ipAddresses: Array.isArray(ipAddrRaw) ? ipAddrRaw : [],
    queues: Array.isArray(queuesRaw) ? queuesRaw : [],
    logs: Array.isArray(logsRaw) ? logsRaw : [],
    wirelessClients: Array.isArray(wirelessRaw) ? wirelessRaw : [],
    bgpPeers: Array.isArray(bgpRaw) ? bgpRaw : [],
    ospfNeighbors: Array.isArray(ospfRaw) ? ospfRaw : [],
    etherStats: Array.isArray(etherStatsRaw) ? etherStatsRaw : [],
  });
});

// ── Lightweight traffic snapshot (dashboard widget) ───────────────────────────

router.get("/routers/:id/ros/traffic", async (req, res) => {
  const id = parseInt(req.params.id!);
  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Router not found" }); return; }
  if (r.routerType !== "routeros") {
    res.status(400).json({ error: "RouterOS only" });
    return;
  }

  const ipAddress = getRouterManagementHost(r);
  if (!ipAddress) {
    res.status(409).json({ error: routerManagementUnavailableMessage() });
    return;
  }
  const { username, password } = r;
  const ssl = r.apiSsl ?? false;

  try {
    const ifacesRaw = await rosGet(ipAddress, ssl, username, password, "/interface");
    const interfaces = Array.isArray(ifacesRaw)
      ? (ifacesRaw as Record<string, any>[]).map(i => ({
          name: i.name as string,
          type: (i.type as string) || "ether",
          running: i.running === true || i.running === "true",
          disabled: i.disabled === true || i.disabled === "true",
          txBytes: parseBytes(i["tx-byte"]),
          rxBytes: parseBytes(i["rx-byte"]),
        }))
      : [];
    res.json({ routerId: id, fetchedAt: new Date().toISOString(), error: null, interfaces });
  } catch (err: any) {
    res.json({ routerId: id, fetchedAt: new Date().toISOString(), error: err.message as string, interfaces: [] });
  }
});

export default router;
