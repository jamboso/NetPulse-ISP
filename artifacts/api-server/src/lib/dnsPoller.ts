/**
 * DNS Poller — background job that runs every 5 minutes.
 *
 * For each online RouterOS device it fetches /ip/dns/cache and accumulates
 * domain hit counts into dns_observations (per-router, per-day buckets).
 * This powers the Network → Traffic Analysis tab.
 */

import { db } from "@workspace/db";
import { routersTable, dnsObservationsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger";

const POLL_INTERVAL_MS = 5 * 60 * 1000;

// ── Domain categorisation ─────────────────────────────────────────────────────

export function categorizeDomain(domain: string): string {
  const d = domain.toLowerCase();
  if (/youtube\.|netflix\.com|vimeo\.com|twitch\.tv|tiktok\.com|dailymotion|hulu\.com|disneyplus|primevideo|spotify\.com|soundcloud\.com|deezer\.com|boomplay\.com|audiomack\.com/.test(d)) return "streaming";
  if (/facebook\.com|instagram\.com|twitter\.com|x\.com|linkedin\.com|whatsapp\.com|snapchat\.com|telegram\.|t\.me|discord\.com|reddit\.com|pinterest\.com|tumblr\.com/.test(d)) return "social";
  if (/google\.com|bing\.com|yahoo\.com|duckduckgo\.com|baidu\.com|yandex\.com|ecosia\.org/.test(d)) return "search";
  if (/zoom\.us|meet\.google|teams\.microsoft|skype\.com|webex\.com|slack\.com|gotomeeting|ringcentral\.com/.test(d)) return "conferencing";
  if (/nordvpn\.com|expressvpn\.com|surfshark\.com|protonvpn\.com|tunnelbear\.com|cyberghost|ipvanish\.com|hotspotshield\.com|hide\.me|privateinternetaccess\.com/.test(d)) return "vpn";
  if (/amazonaws\.com|azure\.com|cloudflare\.com|akamai\.|fastly\.net|cloudfront\.net|googlecloud|firebase\.com|digitalocean\.com|linode\.com/.test(d)) return "cloud";
  if (/microsoft\.com|windows\.com|apple\.com|adobe\.com|ubuntu\.com|canonical\.com|debian\.org|windowsupdate|office365|office\.com/.test(d)) return "software";
  if (/mpesa|safaricom\.com|equity\.co\.ke|kcb\.co\.ke|cooperative\.co\.ke|ncba\.co\.ke|paypal\.com|stripe\.com|visa\.com|mastercard\.com|pesalink|pesapal/.test(d)) return "finance";
  if (/steam|epicgames\.com|ea\.com|blizzard\.com|roblox\.com|minecraft\.net|battle\.net|playstationnetwork|xbox\.com/.test(d)) return "gaming";
  if (/coursera\.com|udemy\.com|edx\.org|khanacademy\.org|wikipedia\.org|duolingo\.com|skillshare\.com/.test(d)) return "education";
  if (/github\.com|gitlab\.com|stackoverflow\.com|npmjs\.com|pypi\.org|docker\.com|kubernetes\.io|devops|bitbucket\.org/.test(d)) return "development";
  if (/bbc\.com|cnn\.com|aljazeera\.com|nation\.co\.ke|standardmedia\.co\.ke|the-star\.co\.ke|tuko\.co\.ke|nytimes\.com|theguardian\.com|reuters\.com/.test(d)) return "news";
  return "other";
}

// ── RouterOS REST helper ──────────────────────────────────────────────────────

async function rosGet(
  ip: string, ssl: boolean, user: string, pass: string, path: string,
): Promise<unknown[]> {
  const scheme = ssl ? "https" : "http";
  const url = `${scheme}://${ip}/rest${path}`;
  const creds = Buffer.from(`${user}:${pass}`).toString("base64");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Basic ${creds}`, Accept: "application/json" },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const text = await res.text();
    const data = text.trim() ? JSON.parse(text) : [];
    return Array.isArray(data) ? data : [];
  } catch {
    clearTimeout(timer);
    return [];
  }
}

// ── Poll a single router's DNS cache ──────────────────────────────────────────

async function pollRouterDns(router: {
  id: number; name: string; ipAddress: string;
  apiSsl: boolean | null; username: string; password: string;
}): Promise<void> {
  const entries = await rosGet(
    router.ipAddress, router.apiSsl ?? false, router.username, router.password,
    "/ip/dns/cache",
  );
  if (!entries.length) return;

  const today = new Date().toISOString().split("T")[0]!;
  const now = new Date();

  // Collect unique domain names (A/AAAA records) from this poll snapshot
  const domains = new Set<string>();
  for (const e of entries as Record<string, unknown>[]) {
    const name = (e["name"] ?? "") as string;
    if (!name || name.startsWith("*") || name.includes(" ")) continue;
    const clean = name.replace(/^\./, "").toLowerCase().trim();
    if (clean.length > 2 && clean.includes(".")) domains.add(clean);
  }
  if (domains.size === 0) return;

  // Upsert each domain — increment hit_count on conflict
  for (const domain of domains) {
    const category = categorizeDomain(domain);
    await db
      .insert(dnsObservationsTable)
      .values({ routerId: router.id, domain, category, hitCount: 1, recordedDate: today, lastSeen: now })
      .onConflictDoUpdate({
        target: [dnsObservationsTable.routerId, dnsObservationsTable.domain, dnsObservationsTable.recordedDate],
        set: {
          hitCount: sql`${dnsObservationsTable.hitCount} + 1`,
          lastSeen: now,
        },
      });
  }

  logger.debug({ router: router.name, domains: domains.size }, "DNS poller: domains observed");
}

// ── Poll all RouterOS routers ─────────────────────────────────────────────────

async function pollAllDns(): Promise<void> {
  const routers = await db
    .select({
      id: routersTable.id, name: routersTable.name,
      ipAddress: routersTable.ipAddress, apiSsl: routersTable.apiSsl,
      username: routersTable.username, password: routersTable.password,
      routerType: routersTable.routerType,
    })
    .from(routersTable)
    .where(eq(routersTable.enabled, true));

  const rosRouters = routers.filter(r => r.routerType === "routeros");
  if (rosRouters.length === 0) return;

  await Promise.allSettled(
    rosRouters.map(r =>
      pollRouterDns(r).catch(err =>
        logger.warn({ err, router: r.name }, "DNS poller: router failed"),
      ),
    ),
  );
}

// ── Start the poller ──────────────────────────────────────────────────────────

export function startDnsPoller(): void {
  pollAllDns().catch(err => logger.warn({ err }, "DNS poller: initial poll failed"));
  setInterval(() => {
    pollAllDns().catch(err => logger.warn({ err }, "DNS poller: poll failed"));
  }, POLL_INTERVAL_MS);
  logger.info({ intervalMs: POLL_INTERVAL_MS }, "DNS poller started");
}
