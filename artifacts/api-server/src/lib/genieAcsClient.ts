import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import type { Tr069AcsCredentials } from "./tr069Credentials";

type LookupResult = { address: string; family: number };
type Lookup = (hostname: string, options: { all: true; verbatim: true }) => Promise<LookupResult[]>;

export class GenieAcsError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export type GenieAcsDeviceSnapshot = {
  found: boolean;
  lastInformAt: Date | null;
  reportedParameters: Record<string, unknown>;
  hasTr098Root: boolean;
  hasTr181Root: boolean;
  hasDeviceAuthenticationMarker: boolean;
};

type ApprovedEndpoint = { url: URL; address: string };

function safeDate(value: unknown): Date | null {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function scalar(value: unknown): unknown {
  return Array.isArray(value) ? value[1] : value;
}

function cleanText(value: unknown): string | undefined {
  const candidate = scalar(value);
  return typeof candidate === "string" && candidate.length > 0 ? candidate.slice(0, 300) : undefined;
}

function isPublicIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  const [first, second] = octets;
  return first !== 0
    && first !== 10
    && first !== 127
    && !(first === 100 && second! >= 64 && second! <= 127)
    && !(first === 169 && second === 254)
    && !(first === 172 && second! >= 16 && second! <= 31)
    && !(first === 192 && second === 168)
    && !(first === 192 && second === 0)
    && !(first === 198 && (second === 18 || second === 19))
    && first! < 224;
}

function allowedHosts(): Set<string> {
  const configured = process.env["TR069_ACS_ALLOWED_HOSTS"]?.trim();
  if (!configured) {
    throw new GenieAcsError("TR-069 ACS requests are disabled until TR069_ACS_ALLOWED_HOSTS lists approved ACS hostnames.");
  }
  return new Set(configured.split(",").map((host) => host.trim().toLowerCase()).filter(Boolean));
}

export function validateGenieAcsBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new GenieAcsError("The ACS NBI endpoint must be a valid HTTPS URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.port && url.port !== "443") {
    throw new GenieAcsError("The ACS NBI endpoint must use HTTPS on port 443 and must not embed credentials or a fragment.");
  }
  if (!allowedHosts().has(url.hostname.toLowerCase())) {
    throw new GenieAcsError("The ACS hostname is not present in TR069_ACS_ALLOWED_HOSTS.");
  }
  return url;
}

export async function resolveApprovedGenieAcsEndpoint(value: string, lookup: Lookup = dnsLookup): Promise<ApprovedEndpoint> {
  const url = validateGenieAcsBaseUrl(value);
  const records = isIP(url.hostname)
    ? [{ address: url.hostname, family: isIP(url.hostname) }]
    : await lookup(url.hostname, { all: true, verbatim: true });
  if (!records.length || records.some((record) => record.family !== 4 || isIP(record.address) !== 4 || !isPublicIpv4(record.address))) {
    throw new GenieAcsError("The ACS hostname must resolve only to approved public IPv4 addresses.");
  }
  return { url, address: records[0]!.address };
}

export class GenieAcsClient {
  private constructor(
    private readonly baseUrl: URL,
    private readonly resolvedAddress: string,
    private readonly authorization: string,
  ) {}

  static async create(baseUrl: string, credentials: Tr069AcsCredentials): Promise<GenieAcsClient> {
    const endpoint = await resolveApprovedGenieAcsEndpoint(baseUrl);
    return new GenieAcsClient(
      endpoint.url,
      endpoint.address,
      `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}`,
    );
  }

  private endpoint(path: string): URL {
    return new URL(path.replace(/^\//, ""), this.baseUrl.href.endsWith("/") ? this.baseUrl.href : `${this.baseUrl.href}/`);
  }

  private async request(path: string, init?: { method?: string; body?: string }): Promise<{ status: number; body: unknown }> {
    const url = this.endpoint(path);
    return await new Promise((resolve, reject) => {
      const req = httpsRequest(url, {
        method: init?.method ?? "GET",
        servername: this.baseUrl.hostname,
        lookup: (_hostname, _options, callback) => callback(null, this.resolvedAddress, 4),
        headers: {
          authorization: this.authorization,
          accept: "application/json",
          ...(init?.body ? { "content-type": "application/json", "content-length": Buffer.byteLength(init.body) } : {}),
        },
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const status = res.statusCode ?? 502;
          if (status >= 300 && status < 400) {
            reject(new GenieAcsError("GenieACS NBI redirects are not permitted.", status));
            return;
          }
          if (status < 200 || status >= 300) {
            reject(new GenieAcsError(`GenieACS NBI returned HTTP ${status}.`, status));
            return;
          }
          try {
            const text = Buffer.concat(chunks).toString("utf8");
            resolve({ status, body: text ? JSON.parse(text) : {} });
          } catch {
            reject(new GenieAcsError("GenieACS NBI returned an invalid JSON response.", status));
          }
        });
      });
      req.setTimeout(10_000, () => req.destroy(new GenieAcsError("GenieACS NBI request timed out.")));
      req.on("error", () => reject(new GenieAcsError("Could not reach the GenieACS NBI endpoint.")));
      if (init?.body) req.write(init.body);
      req.end();
    });
  }

  async getDevice(deviceId: string): Promise<GenieAcsDeviceSnapshot> {
    const params = new URLSearchParams({
      query: JSON.stringify({ _id: deviceId }),
      projection: ["_id", "_lastInform", "_tags", "Device.DeviceInfo.Manufacturer", "Device.DeviceInfo.ModelName", "Device.DeviceInfo.SerialNumber", "InternetGatewayDevice.DeviceInfo.Manufacturer", "InternetGatewayDevice.DeviceInfo.ModelName", "InternetGatewayDevice.DeviceInfo.SerialNumber"].join(","),
    });
    const { body } = await this.request(`devices/?${params.toString()}`);
    if (!Array.isArray(body) || !body[0] || typeof body[0] !== "object") {
      return { found: false, lastInformAt: null, reportedParameters: {}, hasTr098Root: false, hasTr181Root: false, hasDeviceAuthenticationMarker: false };
    }
    const row = body[0] as Record<string, unknown>;
    const tr181 = row["Device"] as Record<string, unknown> | undefined;
    const tr098 = row["InternetGatewayDevice"] as Record<string, unknown> | undefined;
    const info = (tr181?.["DeviceInfo"] ?? tr098?.["DeviceInfo"]) as Record<string, unknown> | undefined;
    return {
      found: true,
      lastInformAt: safeDate(scalar(row["_lastInform"])),
      reportedParameters: Object.fromEntries(Object.entries({
        manufacturer: cleanText(info?.["Manufacturer"]), modelName: cleanText(info?.["ModelName"]),
        serialNumber: cleanText(info?.["SerialNumber"]), dataModelRoots: [tr181 ? "tr-181" : null, tr098 ? "tr-098" : null].filter(Boolean),
      }).filter(([, value]) => value !== undefined)),
      hasTr098Root: Boolean(tr098),
      hasTr181Root: Boolean(tr181),
      hasDeviceAuthenticationMarker: Array.isArray(row["_tags"]) && row["_tags"].includes("netpulse-auth-verified"),
    };
  }

  async enqueueSetParameterValues(deviceId: string, parameterValues: Array<[string, string | number | boolean]>, requestConnection: boolean): Promise<{ taskId: string | null; executedImmediately: boolean }> {
    const result = await this.request(`devices/${encodeURIComponent(deviceId)}/tasks${requestConnection ? "?timeout=10000&connection_request" : ""}`, {
      method: "POST", body: JSON.stringify({ name: "setParameterValues", parameterValues }),
    });
    const task = result.body as { _id?: unknown };
    return { taskId: typeof task?._id === "string" ? task._id : null, executedImmediately: result.status === 200 };
  }

  async retryTask(taskId: string): Promise<void> {
    await this.request(`tasks/${encodeURIComponent(taskId)}/retry`, { method: "POST" });
  }
}