import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { and, eq } from "drizzle-orm";
import {
  db, oltsTable, oltPonPortsTable, onusTable, oltServiceProfilesTable, oltProvisioningJobsTable,
} from "@workspace/db";
import {
  ApproveOltProvisioningJobParams, CreateOltBody, CreateOltProvisioningJobBody,
  CreateOltServiceProfileBody, DeleteOltParams, DeleteOltServiceProfileParams,
  DiscoverOltInventoryParams, GetOltParams, ListOnusQueryParams, UpdateOltBody,
  UpdateOltParams, UpdateOltServiceProfileBody, UpdateOltServiceProfileParams,
} from "@workspace/api-zod";
import { requireRole } from "../middlewares/requireRole";
import { resolveCompanyScope } from "../middlewares/companyScope";
import { writeAuditLog } from "../lib/audit";
import { decryptOltCredentials, encryptOltCredentials } from "../lib/oltCredentials";
import { getOltAdapter, type OltAdapterInput } from "../lib/oltAdapters";
import { getOltCapability, getOltCompatibilityMatrix } from "../lib/oltCapabilities";
import { OltTargetSecurityError, resolveApprovedOltTarget } from "../lib/oltTargetSecurity";
import { persistOltDiscovery } from "../lib/oltDiscovery";

const router = Router();
router.use(resolveCompanyScope);

const discoveryLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many OLT discovery requests. Please wait a minute before trying again." },
});

const activeDiscoveryOltIds = new Set<number>();

function tenantId(req: import("express").Request, res: import("express").Response): number | null {
  if (req.companyId == null) {
    res.status(403).json({ error: "A company scope is required for fiber access management." });
    return null;
  }
  return req.companyId;
}

function parseOr400<T>(
  schema: { safeParse: (input: unknown) => { success: true; data: T } | { success: false; error: { message: string } } },
  input: unknown,
  res: import("express").Response,
): T | null {
  const result = schema.safeParse(input);
  if (!result.success) {
    res.status(400).json({ error: "Invalid request", details: result.error.message });
    return null;
  }
  return result.data;
}

function scopedWhere(table: { id: unknown; companyId: unknown }, id: number, companyId: number) {
  return and(eq(table.id as never, id), eq(table.companyId as never, companyId));
}

function publicOlt(olt: typeof oltsTable.$inferSelect) {
  const { encryptedManagementCredentials: _credentials, ...safe } = olt;
  return { ...safe, credentialsConfigured: Boolean(_credentials), capability: getOltCapability(asAdapterInput(olt)) };
}

function asAdapterInput(olt: typeof oltsTable.$inferSelect): OltAdapterInput {
  return {
    id: olt.id,
    vendor: olt.vendor,
    model: olt.model,
    firmwareVersion: olt.firmwareVersion,
    ponTechnology: olt.ponTechnology,
    managementHost: olt.managementHost,
    managementPort: olt.managementPort,
    managementProtocol: olt.managementProtocol,
  };
}

function auditRead(req: import("express").Request, companyId: number, entityType: "olt" | "onu" | "olt_service_profile" | "olt_provisioning_job", entityId?: number) {
  void writeAuditLog({
    companyId, userId: req.user!.id, userEmail: req.user!.email,
    action: "read", entityType, entityId, diff: { source: "fiber-access" },
  });
}

router.get("/olts", async (req, res): Promise<void> => {
  const companyId = tenantId(req, res);
  if (companyId == null) return;
  const rows = await db.select().from(oltsTable)
    .where(eq(oltsTable.companyId, companyId))
    .orderBy(oltsTable.createdAt);
  auditRead(req, companyId, "olt");
  res.json(rows.map(publicOlt));
});

router.get("/olt-compatibility", (_req, res): void => {
  res.json(getOltCompatibilityMatrix());
});

router.post("/olts", requireRole("admin", "technician"), async (req, res): Promise<void> => {
  const companyId = tenantId(req, res);
  if (companyId == null) return;
  const body = parseOr400(CreateOltBody, req.body, res);
  if (!body) return;

  const [created] = await db.insert(oltsTable).values({
    companyId,
    name: body.name,
    vendor: body.vendor,
    model: body.model,
    firmwareVersion: body.firmwareVersion ?? null,
    ponTechnology: body.ponTechnology,
    managementHost: body.managementHost,
    managementPort: body.managementPort,
    managementProtocol: body.managementProtocol,
    encryptedManagementCredentials: encryptOltCredentials({
      username: body.managementUsername,
      secret: body.managementSecret,
    }),
    location: body.location ?? null,
    enabled: body.enabled,
  }).returning();

  void writeAuditLog({
    companyId, userId: req.user!.id, userEmail: req.user!.email,
    action: "create", entityType: "olt", entityId: created!.id,
    diff: { name: created!.name, vendor: created!.vendor, model: created!.model },
  });
  res.status(201).json(publicOlt(created!));
});

router.get("/olts/:id", async (req, res): Promise<void> => {
  const companyId = tenantId(req, res);
  if (companyId == null) return;
  const params = parseOr400(GetOltParams, req.params, res);
  if (!params) return;
  const [olt] = await db.select().from(oltsTable).where(scopedWhere(oltsTable, params.id, companyId));
  if (!olt) {
    res.status(404).json({ error: "OLT not found" });
    return;
  }
  const ponPorts = await db.select().from(oltPonPortsTable)
    .where(and(eq(oltPonPortsTable.companyId, companyId), eq(oltPonPortsTable.oltId, olt.id)))
    .orderBy(oltPonPortsTable.portNumber);
  auditRead(req, companyId, "olt", olt.id);
  res.json({ ...publicOlt(olt), ponPorts });
});

router.patch("/olts/:id", requireRole("admin", "technician"), async (req, res): Promise<void> => {
  const companyId = tenantId(req, res);
  if (companyId == null) return;
  const params = parseOr400(UpdateOltParams, req.params, res);
  const body = parseOr400(UpdateOltBody, req.body, res);
  if (!params || !body) return;
  if ((body.managementUsername === undefined) !== (body.managementSecret === undefined)) {
    res.status(400).json({ error: "Rotate managementUsername and managementSecret together to avoid losing the configured credential identity." });
    return;
  }

  const update: Record<string, unknown> = {};
  for (const key of ["name", "vendor", "model", "firmwareVersion", "ponTechnology", "managementHost", "managementPort", "managementProtocol", "location", "enabled"] as const) {
    if (body[key] !== undefined) update[key] = body[key];
  }
  if (body.managementSecret !== undefined) {
    update.encryptedManagementCredentials = encryptOltCredentials({
      username: body.managementUsername,
      secret: body.managementSecret,
    });
  }
  const [updated] = await db.update(oltsTable).set(update).where(scopedWhere(oltsTable, params.id, companyId)).returning();
  if (!updated) {
    res.status(404).json({ error: "OLT not found" });
    return;
  }
  void writeAuditLog({
    companyId, userId: req.user!.id, userEmail: req.user!.email,
    action: "update", entityType: "olt", entityId: updated.id,
    diff: { ...update, encryptedManagementCredentials: undefined },
  });
  res.json(publicOlt(updated));
});

router.delete("/olts/:id", requireRole("admin"), async (req, res): Promise<void> => {
  const companyId = tenantId(req, res);
  if (companyId == null) return;
  const params = parseOr400(DeleteOltParams, req.params, res);
  if (!params) return;
  const [existing] = await db.select({ id: oltsTable.id }).from(oltsTable).where(scopedWhere(oltsTable, params.id, companyId));
  if (!existing) {
    res.status(404).json({ error: "OLT not found" });
    return;
  }
  await db.delete(oltProvisioningJobsTable).where(and(eq(oltProvisioningJobsTable.companyId, companyId), eq(oltProvisioningJobsTable.oltId, params.id)));
  await db.delete(onusTable).where(and(eq(onusTable.companyId, companyId), eq(onusTable.oltId, params.id)));
  await db.delete(oltPonPortsTable).where(and(eq(oltPonPortsTable.companyId, companyId), eq(oltPonPortsTable.oltId, params.id)));
  await db.delete(oltsTable).where(scopedWhere(oltsTable, params.id, companyId));
  void writeAuditLog({
    companyId, userId: req.user!.id, userEmail: req.user!.email,
    action: "delete", entityType: "olt", entityId: params.id,
  });
  res.status(204).send();
});

router.post("/olts/:id/discover", requireRole("admin", "technician"), discoveryLimiter, async (req, res): Promise<void> => {
  const companyId = tenantId(req, res);
  if (companyId == null) return;
  const params = parseOr400(DiscoverOltInventoryParams, req.params, res);
  if (!params) return;
  const [olt] = await db.select().from(oltsTable).where(scopedWhere(oltsTable, params.id, companyId));
  if (!olt) {
    res.status(404).json({ error: "OLT not found" });
    return;
  }
  if (!olt.enabled) {
    res.status(409).json({ error: "Discovery is disabled for this OLT. Enable it before starting a discovery job." });
    return;
  }
  if (activeDiscoveryOltIds.has(olt.id)) {
    res.status(409).json({ error: "A discovery job is already running for this OLT." });
    return;
  }

  activeDiscoveryOltIds.add(olt.id);
  const [job] = await db.insert(oltProvisioningJobsTable).values({
    companyId, oltId: olt.id, operation: "discovery", status: "running",
    dryRun: true, requiresApproval: false, requestedBy: req.user!.id, startedAt: new Date(),
  }).returning();
  try {
    const adapterInput = asAdapterInput(olt);
    const approvedAddress = await resolveApprovedOltTarget(adapterInput);
    // Never give adapters a hostname after validation; using the resolved IP
    // prevents DNS rebinding between the policy check and the network request.
    const credentials = decryptOltCredentials(olt.encryptedManagementCredentials);
    const result = await getOltAdapter(adapterInput).discover({
      ...adapterInput,
      managementHost: approvedAddress,
      snmpCommunity: credentials.secret,
    });
    const inventory = await persistOltDiscovery(companyId, olt.id, result);
    await db.update(oltsTable).set({
      healthState: result.healthState,
      lastHealthCheckAt: new Date(),
      lastDiscoveryAt: new Date(),
      lastError: result.healthState === "offline" ? result.note ?? "Discovery failed" : null,
    }).where(scopedWhere(oltsTable, olt.id, companyId));
    const [completed] = await db.update(oltProvisioningJobsTable).set({
      status: "completed", result: JSON.stringify({ note: result.note, ...inventory }),
      completedAt: new Date(),
    }).where(scopedWhere(oltProvisioningJobsTable, job!.id, companyId)).returning();
    void writeAuditLog({
      companyId, userId: req.user!.id, userEmail: req.user!.email,
      action: "read", entityType: "olt_provisioning_job", entityId: job!.id,
      diff: { operation: "discovery", healthState: result.healthState, note: result.note, ...inventory },
    });
    res.json(completed);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Discovery failed";
    const [failed] = await db.update(oltProvisioningJobsTable).set({
      status: "failed", error: message, completedAt: new Date(),
    }).where(scopedWhere(oltProvisioningJobsTable, job!.id, companyId)).returning();
    await db.update(oltsTable).set({ healthState: "unknown", lastError: message, lastHealthCheckAt: new Date() })
      .where(scopedWhere(oltsTable, olt.id, companyId));
    void writeAuditLog({
      companyId, userId: req.user!.id, userEmail: req.user!.email,
      action: "failure", entityType: "olt_provisioning_job", entityId: job!.id,
      diff: { operation: "discovery", error: message },
    });
    res.status(error instanceof OltTargetSecurityError ? 422 : 502).json(failed);
  } finally {
    activeDiscoveryOltIds.delete(olt.id);
  }
});

router.get("/onus", async (req, res): Promise<void> => {
  const companyId = tenantId(req, res);
  if (companyId == null) return;
  const query = parseOr400(ListOnusQueryParams, req.query, res);
  if (!query) return;
  const rows = await db.select().from(onusTable).where(eq(onusTable.companyId, companyId)).orderBy(onusTable.createdAt);
  const filtered = query.oltId == null ? rows : rows.filter((onu) => onu.oltId === query.oltId);
  auditRead(req, companyId, "onu");
  res.json(filtered);
});

router.get("/olt-service-profiles", async (req, res): Promise<void> => {
  const companyId = tenantId(req, res);
  if (companyId == null) return;
  const rows = await db.select().from(oltServiceProfilesTable)
    .where(eq(oltServiceProfilesTable.companyId, companyId)).orderBy(oltServiceProfilesTable.name);
  auditRead(req, companyId, "olt_service_profile");
  res.json(rows);
});

router.post("/olt-service-profiles", requireRole("admin", "technician"), async (req, res): Promise<void> => {
  const companyId = tenantId(req, res);
  if (companyId == null) return;
  const body = parseOr400(CreateOltServiceProfileBody, req.body, res);
  if (!body) return;
  const [created] = await db.insert(oltServiceProfilesTable).values({ companyId, ...body }).returning();
  void writeAuditLog({
    companyId, userId: req.user!.id, userEmail: req.user!.email,
    action: "create", entityType: "olt_service_profile", entityId: created!.id, diff: created,
  });
  res.status(201).json(created);
});

router.patch("/olt-service-profiles/:id", requireRole("admin", "technician"), async (req, res): Promise<void> => {
  const companyId = tenantId(req, res);
  if (companyId == null) return;
  const params = parseOr400(UpdateOltServiceProfileParams, req.params, res);
  const body = parseOr400(UpdateOltServiceProfileBody, req.body, res);
  if (!params || !body) return;
  const [updated] = await db.update(oltServiceProfilesTable).set(body)
    .where(scopedWhere(oltServiceProfilesTable, params.id, companyId)).returning();
  if (!updated) {
    res.status(404).json({ error: "Service profile not found" });
    return;
  }
  void writeAuditLog({
    companyId, userId: req.user!.id, userEmail: req.user!.email,
    action: "update", entityType: "olt_service_profile", entityId: updated.id, diff: body,
  });
  res.json(updated);
});

router.delete("/olt-service-profiles/:id", requireRole("admin"), async (req, res): Promise<void> => {
  const companyId = tenantId(req, res);
  if (companyId == null) return;
  const params = parseOr400(DeleteOltServiceProfileParams, req.params, res);
  if (!params) return;
  const [deleted] = await db.delete(oltServiceProfilesTable)
    .where(scopedWhere(oltServiceProfilesTable, params.id, companyId)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Service profile not found" });
    return;
  }
  void writeAuditLog({
    companyId, userId: req.user!.id, userEmail: req.user!.email,
    action: "delete", entityType: "olt_service_profile", entityId: params.id,
  });
  res.status(204).send();
});

router.get("/olt-provisioning-jobs", async (req, res): Promise<void> => {
  const companyId = tenantId(req, res);
  if (companyId == null) return;
  const rows = await db.select().from(oltProvisioningJobsTable)
    .where(eq(oltProvisioningJobsTable.companyId, companyId)).orderBy(oltProvisioningJobsTable.createdAt);
  auditRead(req, companyId, "olt_provisioning_job");
  res.json(rows);
});

router.post("/olt-provisioning-jobs", requireRole("admin", "technician"), async (req, res): Promise<void> => {
  const companyId = tenantId(req, res);
  if (companyId == null) return;
  const body = parseOr400(CreateOltProvisioningJobBody, req.body, res);
  if (!body) return;
  const [olt] = await db.select().from(oltsTable).where(scopedWhere(oltsTable, body.oltId, companyId));
  const [onu] = await db.select().from(onusTable).where(scopedWhere(onusTable, body.onuId, companyId));
  const [profile] = await db.select().from(oltServiceProfilesTable).where(scopedWhere(oltServiceProfilesTable, body.serviceProfileId, companyId));
  if (!olt || !onu || !profile || onu.oltId !== olt.id) {
    res.status(400).json({ error: "OLT, ONU, and service profile must exist in the active company and the ONU must belong to the OLT." });
    return;
  }
  const adapter = getOltAdapter(asAdapterInput(olt));
  const validation = adapter.validateServiceProfile(profile);
  const dryRun = body.dryRun;
  const [job] = await db.insert(oltProvisioningJobsTable).values({
    companyId, oltId: olt.id, onuId: onu.id, serviceProfileId: profile.id,
    operation: body.operation, dryRun, requiresApproval: true, requestedBy: req.user!.id,
    status: dryRun && validation.valid ? "dry_run_complete" : "failed",
    result: dryRun && validation.valid ? JSON.stringify({ dryRun: true, adapter: adapter.id, profileValid: true }) : null,
    error: validation.valid ? (dryRun ? null : "No vendor write adapter is enabled. Use this approved dry run after a verified adapter is installed.") : validation.reason ?? "Service profile validation failed",
    startedAt: new Date(), completedAt: new Date(),
  }).returning();
  void writeAuditLog({
    companyId, userId: req.user!.id, userEmail: req.user!.email,
    action: dryRun && validation.valid ? "provision" : "failure",
    entityType: "olt_provisioning_job", entityId: job!.id,
    diff: { operation: body.operation, dryRun, profileId: profile.id, validation },
  });
  if (!dryRun && validation.valid) {
    res.status(422).json(job);
    return;
  }
  res.status(201).json(job);
});

router.post("/olt-provisioning-jobs/:id/approve", requireRole("admin"), async (req, res): Promise<void> => {
  const companyId = tenantId(req, res);
  if (companyId == null) return;
  const params = parseOr400(ApproveOltProvisioningJobParams, req.params, res);
  if (!params) return;
  const [job] = await db.select().from(oltProvisioningJobsTable)
    .where(scopedWhere(oltProvisioningJobsTable, params.id, companyId));
  if (!job) {
    res.status(404).json({ error: "Provisioning job not found" });
    return;
  }
  if (!job.dryRun || job.status !== "dry_run_complete") {
    res.status(409).json({ error: "Only completed dry-run jobs can be approved." });
    return;
  }
  const [approved] = await db.update(oltProvisioningJobsTable).set({
    status: "approved", approvedAt: new Date(), approvedBy: req.user!.id,
  }).where(scopedWhere(oltProvisioningJobsTable, job.id, companyId)).returning();
  void writeAuditLog({
    companyId, userId: req.user!.id, userEmail: req.user!.email,
    action: "approve", entityType: "olt_provisioning_job", entityId: job.id,
    diff: { dryRun: true },
  });
  res.json(approved);
});

export default router;