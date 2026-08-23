import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";

const mockExec = vi.hoisted(() => vi.fn());
const mockGetDevice = vi.hoisted(() => vi.fn());
const mockRetryTask = vi.hoisted(() => vi.fn());
const mockEnqueueTask = vi.hoisted(() => vi.fn());

vi.mock("@workspace/db", () => {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "insert", "update", "delete", "from", "set", "where", "orderBy"]) {
    chain[method] = () => chain;
  }
  chain["values"] = () => chain;
  chain["returning"] = () => mockExec();
  chain["then"] = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => mockExec().then(resolve, reject);
  const column = {};
  return {
    db: chain,
    companiesTable: { id: column },
    onusTable: { id: column, companyId: column },
    oltServiceProfilesTable: { id: column, companyId: column },
    tr069AcsConfigsTable: { id: column, companyId: column, enabled: column, createdAt: column },
    tr069DevicesTable: { id: column, companyId: column, onuId: column, acsConfigId: column, createdAt: column },
    tr069CommandsTable: { id: column, companyId: column, tr069DeviceId: column, createdAt: column },
  };
});

vi.mock("../lib/audit.js", () => ({ writeAuditLog: vi.fn() }));
vi.mock("../lib/tr069Credentials.js", () => ({
  decryptTr069AcsCredentials: vi.fn(() => ({ username: "nbi", password: "secret" })),
  encryptTr069AcsCredentials: vi.fn(() => "v1:re-encrypted"),
}));
vi.mock("../lib/genieAcsClient.js", () => ({
  GenieAcsError: class GenieAcsError extends Error {},
  GenieAcsClient: class GenieAcsClient {
    static create = async () => new this();
    getDevice = mockGetDevice;
    retryTask = mockRetryTask;
    enqueueSetParameterValues = mockEnqueueTask;
  },
  resolveApprovedGenieAcsEndpoint: vi.fn(async () => ({ url: new URL("https://acs.example.test"), address: "203.0.113.10" })),
}));

const { default: tr069Router } = await import("../routes/tr069.js");

type MockUser = {
  id: string; email: string; name: string; role: string; companyId?: number;
  active: boolean; emailVerified: boolean; createdAt: Date; updatedAt: Date;
};

const technician: MockUser = {
  id: "tech-1", email: "tech@example.com", name: "Tech", role: "technician", companyId: 7,
  active: true, emailVerified: true, createdAt: new Date(), updatedAt: new Date(),
};
const activeCompany = { id: 7, accessStatus: "active", accessUntil: null, exempt: false };

function buildApp(user: MockUser = technician) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { user: MockUser }).user = user;
    next();
  });
  app.use(tr069Router);
  return app;
}

describe("TR-069 management routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("never returns the encrypted ACS NBI credential payload", async () => {
    const config = {
      id: 4, companyId: 7, name: "Production GenieACS", baseUrl: "https://acs.example.test/nbi",
      encryptedNbiCredentials: "v1:opaque:credential:payload", enabled: true,
      lastValidatedAt: null, lastError: null, createdAt: new Date(), updatedAt: new Date(),
    };
    mockExec.mockResolvedValueOnce([activeCompany]).mockResolvedValueOnce([config]);

    const response = await request(buildApp()).get("/tr069/config");

    expect(response.status, response.text).toBe(200);
    expect(response.body).toMatchObject({
      id: 4, baseUrl: "https://acs.example.test/nbi", credentialsConfigured: true,
    });
    expect(JSON.stringify(response.body)).not.toContain("opaque:credential");
    expect(response.body).not.toHaveProperty("encryptedNbiCredentials");
  });

  it("refuses CPE enrollment when the ACS has not verified per-device authentication", async () => {
    const config = {
      id: 4, companyId: 7, name: "Production GenieACS", baseUrl: "https://acs.example.test/nbi",
      encryptedNbiCredentials: "v1:opaque", enabled: true, lastValidatedAt: null, lastError: null,
      createdAt: new Date(), updatedAt: new Date(),
    };
    mockExec.mockResolvedValueOnce([activeCompany]).mockResolvedValueOnce([{ id: 22 }]).mockResolvedValueOnce([config]);
    mockGetDevice.mockResolvedValueOnce({
      found: true, lastInformAt: new Date(), reportedParameters: {}, hasTr098Root: false, hasTr181Root: true,
      hasDeviceAuthenticationMarker: false,
    });

    const response = await request(buildApp())
      .put("/tr069/onus/22/device")
      .send({
        acsDeviceId: "VENDOR-ONT-123",
        dataModel: "tr-181",
      });

    expect(response.status, response.text).toBe(400);
    expect(response.body.error).toMatch(/netpulse-auth-verified/i);
    expect(mockGetDevice).toHaveBeenCalledWith("VENDOR-ONT-123");
  });

  it("holds a retry when ACS verification has been revoked without calling GenieACS", async () => {
    const command = {
      id: 9, companyId: 7, tr069DeviceId: 5, serviceProfileId: 2, operation: "apply_service_profile",
      parameters: [], status: "failed", attemptCount: 1, nextAttemptAt: null, acsTaskId: "task-9",
      result: null, error: "previous failure", recoveryGuidance: null, requestedBy: "tech-1",
      startedAt: null, completedAt: null, createdAt: new Date(), updatedAt: new Date(),
    };
    const device = {
      id: 5, companyId: 7, acsConfigId: 4, status: "online", deviceAuthenticationConfigured: false,
      deviceAuthenticationVerifiedAt: null, dataModelVerifiedAt: new Date(),
    };
    const config = { id: 4, companyId: 7, enabled: true };
    mockExec.mockResolvedValueOnce([activeCompany]).mockResolvedValueOnce([command]).mockResolvedValueOnce([device]).mockResolvedValueOnce([config]).mockResolvedValueOnce([device]);
    mockGetDevice.mockResolvedValueOnce({
      found: true, lastInformAt: new Date(), reportedParameters: {}, hasTr098Root: false, hasTr181Root: true,
      hasDeviceAuthenticationMarker: false,
    });

    const response = await request(buildApp()).post("/tr069/commands/9/retry");

    expect(response.status, response.text).toBe(409);
    expect(response.body.error).toMatch(/authentication marker/i);
    expect(mockRetryTask).not.toHaveBeenCalled();
  });

  it("denies non-network staff access to TR-069 connector metadata", async () => {
    mockExec.mockResolvedValueOnce([activeCompany]);

    const response = await request(buildApp({ ...technician, role: "billing" })).get("/tr069/config");

    expect(response.status).toBe(403);
  });

  it("retains an existing encrypted password when an admin saves connector edits without one", async () => {
    const existing = {
      id: 4, companyId: 7, name: "Old name", baseUrl: "https://acs.example.test", encryptedNbiCredentials: "v1:opaque",
      enabled: true, lastValidatedAt: null, lastError: null, createdAt: new Date(), updatedAt: new Date(),
    };
    const saved = { ...existing, name: "Updated name" };
    mockExec.mockResolvedValueOnce([activeCompany]).mockResolvedValueOnce([existing]).mockResolvedValueOnce([saved]);

    const response = await request(buildApp({ ...technician, role: "admin" })).put("/tr069/config").send({
      name: "Updated name", baseUrl: "https://acs.example.test", nbiUsername: "nbi", enabled: true,
    });

    expect(response.status, response.text).toBe(200);
    expect(response.body.name).toBe("Updated name");
  });

  it("holds a new command when the live ACS marker has been revoked", async () => {
    const profile = { id: 2, companyId: 7, vlanId: 100, accessMode: "bridge", downstreamKbps: null, upstreamKbps: null, tr069InformIntervalSeconds: 900 };
    const device = { id: 5, companyId: 7, onuId: 22, acsConfigId: 4, acsDeviceId: "VENDOR-ONT-123", dataModel: "tr-181", status: "online" };
    const config = { id: 4, companyId: 7, enabled: true };
    mockExec
      .mockResolvedValueOnce([activeCompany]).mockResolvedValueOnce([{ id: 22 }]).mockResolvedValueOnce([profile])
      .mockResolvedValueOnce([device]).mockResolvedValueOnce([config]).mockResolvedValueOnce([device]);
    mockGetDevice.mockResolvedValueOnce({
      found: true, lastInformAt: new Date(), reportedParameters: {}, hasTr098Root: false, hasTr181Root: true,
      hasDeviceAuthenticationMarker: false,
    });

    const response = await request(buildApp()).post("/tr069/commands").send({ onuId: 22, serviceProfileId: 2, applyImmediately: true });

    expect(response.status, response.text).toBe(409);
    expect(response.body.error).toMatch(/marker.*no longer matches/i);
    expect(mockEnqueueTask).not.toHaveBeenCalled();
  });
});