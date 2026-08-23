import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";

const mockExec = vi.hoisted(() => vi.fn());
const mockValues = vi.hoisted(() => vi.fn());
const mockDiscover = vi.hoisted(() => vi.fn());

vi.mock("@workspace/db", () => {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "insert", "update", "delete", "from", "set", "where", "orderBy"]) {
    chain[method] = () => chain;
  }
  chain["values"] = (value: unknown) => {
    mockValues(value);
    return chain;
  };
  chain["returning"] = () => mockExec();
  chain["then"] = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => mockExec().then(resolve, reject);
  chain["transaction"] = (callback: (transaction: typeof chain) => unknown) => callback(chain);

  const column = {};
  return {
    db: chain,
    oltsTable: { id: column, companyId: column, createdAt: column },
    oltPonPortsTable: { id: column, companyId: column, oltId: column, portNumber: column },
    onusTable: { id: column, companyId: column, oltId: column, loid: column, serialNumber: column, createdAt: column },
    oltServiceProfilesTable: { id: column, companyId: column, name: column },
    oltProvisioningJobsTable: { id: column, companyId: column, oltId: column, onuId: column, createdAt: column },
    companiesTable: { id: column },
  };
});

vi.mock("../lib/audit.js", () => ({ writeAuditLog: vi.fn() }));
vi.mock("../lib/oltTargetSecurity.js", () => ({
  OltTargetSecurityError: class OltTargetSecurityError extends Error {},
  resolveApprovedOltTarget: vi.fn().mockResolvedValue("10.12.4.8"),
}));
vi.mock("../lib/oltAdapters.js", () => ({
  getOltAdapter: () => ({ discover: mockDiscover }),
}));

const { default: oltsRouter } = await import("../routes/olts.js");
const { writeAuditLog } = await import("../lib/audit.js");

type MockUser = {
  id: string; email: string; name: string; role: string; companyId?: number;
  active: boolean; emailVerified: boolean; createdAt: Date; updatedAt: Date;
};

const technician: MockUser = {
  id: "tech-1", email: "tech@example.com", name: "Tech", role: "technician", companyId: 7,
  active: true, emailVerified: true, createdAt: new Date(), updatedAt: new Date(),
};

function buildApp(user: MockUser = technician) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { user: MockUser }).user = user;
    next();
  });
  app.use(oltsRouter);
  return app;
}

const activeCompany = { id: 7, accessStatus: "active", accessUntil: null, exempt: false };
const sampleOlt = {
  id: 11, companyId: 7, name: "POP A OLT", vendor: "HIOSO", model: "FD1208S",
  ponTechnology: "epon", managementHost: "10.0.0.10", managementPort: 161,
  managementProtocol: "snmp-v2c", encryptedManagementCredentials: "v1:opaque",
  location: null, enabled: true, healthState: "unknown", lastHealthCheckAt: null,
  lastDiscoveryAt: null, lastError: null, createdAt: new Date(), updatedAt: new Date(),
};

const validOltBody = {
  name: "POP A OLT", vendor: "HIOSO", model: "FD1208S", ponTechnology: "epon",
  managementHost: "10.0.0.10", managementProtocol: "snmp-v2c", managementSecret: "private-community",
};

beforeEach(() => {
  vi.resetAllMocks();
  mockDiscover.mockResolvedValue({
    healthState: "online",
    ports: [{ portNumber: "1", label: "PON 1", state: "up", opticalState: "normal" }],
    onus: [{ serialNumber: "HWTC12345678", portNumber: "1", vendor: "Huawei", provisioningState: "discovered" }],
  });
});

describe("OLT fiber access routes", () => {
  it("fails closed when an owner has not selected a company scope", async () => {
    const response = await request(buildApp({ ...technician, role: "owner", companyId: undefined })).get("/olts");

    expect(response.status, response.text).toBe(403);
    expect(response.body.error).toMatch(/company scope/i);
    expect(mockExec).not.toHaveBeenCalled();
  });

  it("rejects a non-network role before it can register an OLT", async () => {
    mockExec.mockResolvedValueOnce([activeCompany]);
    const response = await request(buildApp({ ...technician, role: "billing" })).post("/olts").send(validOltBody);

    expect(response.status).toBe(403);
  });

  it("validates the protected management secret", async () => {
    mockExec.mockResolvedValueOnce([activeCompany]);
    const response = await request(buildApp()).post("/olts").send({ ...validOltBody, managementSecret: "" });

    expect(response.status, response.text).toBe(400);
    expect(vi.mocked(writeAuditLog)).not.toHaveBeenCalled();
  });

  it("requires management username and secret to rotate together", async () => {
    mockExec.mockResolvedValueOnce([activeCompany]);
    const response = await request(buildApp()).patch("/olts/11").send({ managementSecret: "new-community" });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/together/i);
  });

  it("persists discovered PON ports and ONUs under the active company", async () => {
    const job = { id: 88 };
    const completed = { ...job, companyId: 7, status: "completed", operation: "discovery", dryRun: true, requiresApproval: false, requestedBy: "tech-1", createdAt: new Date() };
    mockExec
      .mockResolvedValueOnce([activeCompany])
      .mockResolvedValueOnce([sampleOlt])
      .mockResolvedValueOnce([job])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 21 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([completed]);

    const response = await request(buildApp()).post("/olts/11/discover");

    expect(response.status, response.text).toBe(200);
    expect(mockValues).toHaveBeenCalledWith(expect.objectContaining({
      companyId: 7, oltId: 11, portNumber: "1",
    }));
    expect(mockValues).toHaveBeenCalledWith(expect.objectContaining({
      companyId: 7, oltId: 11, ponPortId: 21, serialNumber: "HWTC12345678",
    }));
    expect(response.body.status).toBe("completed");
  });

  it("updates existing inventory rather than duplicating it on a repeat discovery", async () => {
    const job = { id: 89 };
    const existingPort = { id: 21 };
    const existingOnu = { id: 34 };
    const completed = { ...job, companyId: 7, status: "completed", operation: "discovery", dryRun: true, requiresApproval: false, requestedBy: "tech-1", createdAt: new Date() };
    mockExec
      .mockResolvedValueOnce([activeCompany])
      .mockResolvedValueOnce([sampleOlt])
      .mockResolvedValueOnce([job])
      .mockResolvedValueOnce([existingPort])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([existingOnu])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([completed]);

    const response = await request(buildApp()).post("/olts/11/discover");

    expect(response.status, response.text).toBe(200);
    expect(mockValues).not.toHaveBeenCalledWith(expect.objectContaining({ serialNumber: "HWTC12345678" }));
    expect(mockValues).not.toHaveBeenCalledWith(expect.objectContaining({ portNumber: "1" }));
  });

  it("does not run discovery against a disabled OLT", async () => {
    mockExec.mockResolvedValueOnce([activeCompany]).mockResolvedValueOnce([{ ...sampleOlt, enabled: false }]);

    const response = await request(buildApp()).post("/olts/11/discover");

    expect(response.status, response.text).toBe(409);
    expect(mockDiscover).not.toHaveBeenCalled();
  });

  it("redacts encrypted credentials from API and audit responses", async () => {
    mockExec.mockResolvedValueOnce([activeCompany]).mockResolvedValueOnce([sampleOlt]);
    const response = await request(buildApp()).post("/olts").send(validOltBody);

    expect(response.status, response.text).toBe(201);
    expect(response.body).not.toHaveProperty("encryptedManagementCredentials");
    expect(response.body).not.toHaveProperty("managementSecret");
    expect(response.body.credentialsConfigured).toBe(true);
    expect(vi.mocked(writeAuditLog)).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "olt",
      diff: { name: "POP A OLT", vendor: "HIOSO", model: "FD1208S" },
    }));
  });
});