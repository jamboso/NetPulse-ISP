import { Router } from "express";
import { and, eq } from "drizzle-orm";
import {
  db, onusTable, oltServiceProfilesTable, tr069AcsConfigsTable, tr069CommandsTable, tr069DevicesTable,
} from "@workspace/db";
import {
  CreateTr069CommandBody, EnrollTr069OnuBody, EnrollTr069OnuParams, GetTr069AcsConfigResponse,
  ListTr069CommandsResponse, ListTr069DevicesResponse, RefreshTr069DeviceParams, RetryTr069CommandParams,
  UpdateTr069AcsConfigBody, UpdateTr069AcsConfigResponse,
} from "@workspace/api-zod";
import { requireRole } from "../middlewares/requireRole";
import { resolveCompanyScope } from "../middlewares/companyScope";
import { writeAuditLog } from "../lib/audit";
import { decryptTr069AcsCredentials, encryptTr069AcsCredentials } from "../lib/tr069Credentials";
import { GenieAcsClient, GenieAcsError, resolveApprovedGenieAcsEndpoint } from "../lib/genieAcsClient";

const router = Router();
router.use(resolveCompanyScope);

const ONLINE_WINDOW_MS = 10 * 60 * 1000;
const RETRY_DELAY_MS = 5 * 60 * 1000;

function tenantId(req: import("express").Request, res: import("express").Response): number | null {
  if (req.companyId == null) {
    res.status(403).json({ error: "A company scope is required for TR-069 management." });
    return null;
  }
  return req.companyId;
}

function parseOr400<T>(
  schema: { safeParse: (input: unknown) => { success: true; data: T } | { success: false; error: { message: string } } },
  input: unknown,
  res: import("express").Response,
): T | null {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.message });
    return null;
  }
  return parsed.data;
}

function publicAcs(config: typeof tr069AcsConfigsTable.$inferSelect) {
  return {
    id: config.id,
    name: config.name,
    baseUrl: config.baseUrl,
    enabled: config.enabled,
    credentialsConfigured: Boolean(config.encryptedNbiCredentials),
    lastValidatedAt: config.lastValidatedAt,
    lastError: config.lastError,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };
}

function publicDevice(device: typeof tr069DevicesTable.$inferSelect) {
  return {
    id: device.id,
    onuId: device.onuId,
    acsConfigId: device.acsConfigId,
    acsDeviceId: device.acsDeviceId,
    dataModel: device.dataModel,
    status: device.status,
    deviceAuthenticationConfigured: device.deviceAuthenticationConfigured,
    deviceAuthenticationVerifiedAt: device.deviceAuthenticationVerifiedAt,
    dataModelVerifiedAt: device.dataModelVerifiedAt,
    lastInformAt: device.lastInformAt,
    lastManagedAt: device.lastManagedAt,
    lastRefreshAt: device.lastRefreshAt,
    reportedParameters: (device.reportedParameters ?? {}) as Record<string, unknown>,
    lastError: device.lastError,
    createdAt: device.createdAt,
    updatedAt: device.updatedAt,
  };
}

function publicCommand(command: typeof tr069CommandsTable.$inferSelect) {
  return {
    id: command.id,
    tr069DeviceId: command.tr069DeviceId,
    serviceProfileId: command.serviceProfileId,
    operation: command.operation,
    parameters: Array.isArray(command.parameters) ? command.parameters : [],
    status: command.status,
    attemptCount: command.attemptCount,
    nextAttemptAt: command.nextAttemptAt,
    acsTaskId: command.acsTaskId,
    result: command.result,
    error: command.error,
    recoveryGuidance: command.recoveryGuidance,
    requestedBy: command.requestedBy,
    startedAt: command.startedAt,
    completedAt: command.completedAt,
    createdAt: command.createdAt,
    updatedAt: command.updatedAt,
  };
}

async function createClient(config: typeof tr069AcsConfigsTable.$inferSelect): Promise<GenieAcsClient> {
  if (!config.enabled) throw new GenieAcsError("The ACS connector is disabled.");
  return GenieAcsClient.create(config.baseUrl, decryptTr069AcsCredentials(config.encryptedNbiCredentials));
}

function supportedParameters(dataModel: string, informIntervalSeconds: number): Array<[string, boolean | number]> {
  const root = dataModel === "tr-098" ? "InternetGatewayDevice.ManagementServer" : "Device.ManagementServer";
  return [
    [`${root}.PeriodicInformEnable`, true],
    [`${root}.PeriodicInformInterval`, informIntervalSeconds],
  ];
}

function unsupportedProfileFields(profile: typeof oltServiceProfilesTable.$inferSelect): string[] {
  const fields = ["vlanId", "accessMode"];
  if (profile.downstreamKbps != null) fields.push("downstreamKbps");
  if (profile.upstreamKbps != null) fields.push("upstreamKbps");
  return fields;
}

function deviceStatus(lastInformAt: Date | null, found: boolean, dataModelConfirmed: boolean): "pending_inform" | "online" | "offline" | "unknown" {
  if (!found) return "pending_inform";
  if (!dataModelConfirmed) return "unknown";
  return lastInformAt && Date.now() - lastInformAt.getTime() <= ONLINE_WINDOW_MS ? "online" : "offline";
}

async function verifyDeviceAgainstAcs(
  companyId: number,
  device: typeof tr069DevicesTable.$inferSelect,
  config: typeof tr069AcsConfigsTable.$inferSelect,
) {
  const snapshot = await (await createClient(config)).getDevice(device.acsDeviceId);
  const modelConfirmed = device.dataModel === "tr-098" ? snapshot.hasTr098Root : snapshot.hasTr181Root;
  const verified = snapshot.found && snapshot.hasDeviceAuthenticationMarker && modelConfirmed;
  const status = deviceStatus(snapshot.lastInformAt, snapshot.found, modelConfirmed);
  const now = new Date();
  const [updated] = await db.update(tr069DevicesTable).set({
    status,
    lastInformAt: snapshot.lastInformAt,
    lastRefreshAt: now,
    reportedParameters: snapshot.reportedParameters,
    deviceAuthenticationConfigured: snapshot.hasDeviceAuthenticationMarker,
    deviceAuthenticationVerifiedAt: snapshot.hasDeviceAuthenticationMarker ? now : null,
    dataModelVerifiedAt: modelConfirmed ? now : null,
    lastError: !snapshot.found ? "The ACS has not received an Inform for this enrolled device." : !snapshot.hasDeviceAuthenticationMarker ? "The ACS device is missing the netpulse-auth-verified authentication marker." : !modelConfirmed ? `The ACS device does not expose ${device.dataModel.toUpperCase()}.` : null,
  }).where(and(eq(tr069DevicesTable.id, device.id), eq(tr069DevicesTable.companyId, companyId))).returning();
  return { device: updated!, verified, online: status === "online" };
}

router.get("/tr069/config", requireRole("admin", "technician"), async (req, res): Promise<void> => {
  const companyId = tenantId(req, res);
  if (companyId == null) return;
  const [config] = await db.select().from(tr069AcsConfigsTable)
    .where(eq(tr069AcsConfigsTable.companyId, companyId));
  if (!config) {
    res.status(404).json({ error: "No TR-069 ACS connector has been configured for this company." });
    return;
  }
  void writeAuditLog({
    companyId, userId: req.user!.id, userEmail: req.user!.email,
    action: "read", entityType: "tr069_acs_config", entityId: config.id, diff: { source: "tr069" },
  });
  res.json(GetTr069AcsConfigResponse.parse(publicAcs(config)));
});

router.put("/tr069/config", requireRole("admin"), async (req, res): Promise<void> => {
  const companyId = tenantId(req, res);
  if (companyId == null) return;
  const body = parseOr400(UpdateTr069AcsConfigBody, req.body, res);
  if (!body) return;
  const [existing] = await db.select().from(tr069AcsConfigsTable)
    .where(eq(tr069AcsConfigsTable.companyId, companyId));
  if (!existing && !body.nbiPassword) {
    res.status(400).json({ error: "An NBI password is required when creating the first ACS connector." });
    return;
  }
  try {
    await resolveApprovedGenieAcsEndpoint(body.baseUrl);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid ACS endpoint." });
    return;
  }
  const password = body.nbiPassword || (existing ? decryptTr069AcsCredentials(existing.encryptedNbiCredentials).password : "");
  const update = {
    name: body.name,
    baseUrl: body.baseUrl.replace(/\/+$/, ""),
    encryptedNbiCredentials: encryptTr069AcsCredentials({ username: body.nbiUsername, password }),
    enabled: body.enabled,
    lastError: null,
  };
  const [saved] = existing
    ? await db.update(tr069AcsConfigsTable).set(update)
      .where(and(eq(tr069AcsConfigsTable.id, existing.id), eq(tr069AcsConfigsTable.companyId, companyId))).returning()
    : await db.insert(tr069AcsConfigsTable).values({ companyId, ...update }).returning();
  void writeAuditLog({
    companyId, userId: req.user!.id, userEmail: req.user!.email,
    action: existing ? "update" : "create", entityType: "tr069_acs_config", entityId: saved!.id,
    diff: { name: saved!.name, baseUrl: saved!.baseUrl, enabled: saved!.enabled, credentialsRotated: true },
  });
  res.json(UpdateTr069AcsConfigResponse.parse(publicAcs(saved!)));
});

router.get("/tr069/devices", requireRole("admin", "technician"), async (req, res): Promise<void> => {
  const companyId = tenantId(req, res);
  if (companyId == null) return;
  const rows = await db.select().from(tr069DevicesTable)
    .where(eq(tr069DevicesTable.companyId, companyId)).orderBy(tr069DevicesTable.createdAt);
  void writeAuditLog({
    companyId, userId: req.user!.id, userEmail: req.user!.email,
    action: "read", entityType: "tr069_device", diff: { source: "tr069" },
  });
  res.json(ListTr069DevicesResponse.parse(rows.map(publicDevice)));
});

router.put("/tr069/onus/:onuId/device", requireRole("admin", "technician"), async (req, res): Promise<void> => {
  const companyId = tenantId(req, res);
  if (companyId == null) return;
  const params = parseOr400(EnrollTr069OnuParams, req.params, res);
  const body = parseOr400(EnrollTr069OnuBody, req.body, res);
  if (!params || !body) return;
  const [onu] = await db.select({ id: onusTable.id }).from(onusTable)
    .where(and(eq(onusTable.id, params.onuId), eq(onusTable.companyId, companyId)));
  const [config] = await db.select().from(tr069AcsConfigsTable)
    .where(eq(tr069AcsConfigsTable.companyId, companyId));
  if (!onu || !config) {
    res.status(404).json({ error: !onu ? "ONU not found in the active company." : "Configure the company ACS connector before enrolling a CPE." });
    return;
  }
  if (!config.enabled) {
    res.status(409).json({ error: "The ACS connector is disabled. Enable it before enrolling a CPE." });
    return;
  }
  let snapshot;
  try {
    snapshot = await (await createClient(config)).getDevice(body.acsDeviceId);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Could not verify the ACS device." });
    return;
  }
  const dataModelConfirmed = body.dataModel === "tr-098" ? snapshot.hasTr098Root : snapshot.hasTr181Root;
  if (!snapshot.found || !snapshot.hasDeviceAuthenticationMarker || !dataModelConfirmed) {
    res.status(400).json({
      error: !snapshot.found
        ? "The ACS has not received an Inform from this CPE yet."
        : !snapshot.hasDeviceAuthenticationMarker
          ? "The ACS device is missing the required netpulse-auth-verified marker. Configure the per-device CWMP authentication policy in GenieACS, then refresh."
          : `The ACS device does not expose the selected ${body.dataModel.toUpperCase()} data model.`,
    });
    return;
  }
  const verifiedAt = new Date();
  const [existing] = await db.select().from(tr069DevicesTable)
    .where(and(eq(tr069DevicesTable.companyId, companyId), eq(tr069DevicesTable.onuId, onu.id)));
  const values = {
    acsConfigId: config.id,
    acsDeviceId: body.acsDeviceId,
    dataModel: body.dataModel,
    deviceAuthenticationConfigured: true,
    deviceAuthenticationVerifiedAt: verifiedAt,
    dataModelVerifiedAt: verifiedAt,
    status: deviceStatus(snapshot.lastInformAt, true, true),
    lastInformAt: snapshot.lastInformAt,
    lastRefreshAt: verifiedAt,
    reportedParameters: snapshot.reportedParameters,
    lastError: null,
  };
  const [saved] = existing
    ? await db.update(tr069DevicesTable).set(values)
      .where(and(eq(tr069DevicesTable.id, existing.id), eq(tr069DevicesTable.companyId, companyId))).returning()
    : await db.insert(tr069DevicesTable).values({ companyId, onuId: onu.id, ...values }).returning();
  void writeAuditLog({
    companyId, userId: req.user!.id, userEmail: req.user!.email,
    action: existing ? "update" : "create", entityType: "tr069_device", entityId: saved!.id,
    diff: { onuId: saved!.onuId, dataModel: saved!.dataModel, acsDeviceAuthenticationVerified: true },
  });
  res.json(publicDevice(saved!));
});

router.post("/tr069/devices/:id/refresh", requireRole("admin", "technician"), async (req, res): Promise<void> => {
  const companyId = tenantId(req, res);
  if (companyId == null) return;
  const params = parseOr400(RefreshTr069DeviceParams, req.params, res);
  if (!params) return;
  const [device] = await db.select().from(tr069DevicesTable)
    .where(and(eq(tr069DevicesTable.id, params.id), eq(tr069DevicesTable.companyId, companyId)));
  if (!device) {
    res.status(404).json({ error: "TR-069 CPE not found." });
    return;
  }
  const [config] = await db.select().from(tr069AcsConfigsTable)
    .where(and(eq(tr069AcsConfigsTable.id, device.acsConfigId), eq(tr069AcsConfigsTable.companyId, companyId)));
  if (!config || !config.enabled) {
    res.status(409).json({ error: "The CPE’s ACS connector is not configured or is disabled." });
    return;
  }
  try {
    const snapshot = await (await createClient(config)).getDevice(device.acsDeviceId);
    const expectedRootFound = device.dataModel === "tr-098" ? snapshot.hasTr098Root : snapshot.hasTr181Root;
    const status = deviceStatus(snapshot.lastInformAt, snapshot.found, expectedRootFound);
    const error = !snapshot.found
      ? "The ACS has not received an Inform for this enrolled device."
      : !snapshot.hasDeviceAuthenticationMarker
        ? "The ACS device no longer has the required netpulse-auth-verified authentication marker."
      : !expectedRootFound
        ? `The ACS device does not expose the enrolled ${device.dataModel.toUpperCase()} data model.`
        : null;
    const [updated] = await db.update(tr069DevicesTable).set({
      status, lastInformAt: snapshot.lastInformAt, lastRefreshAt: new Date(),
      reportedParameters: snapshot.reportedParameters,
      deviceAuthenticationConfigured: snapshot.hasDeviceAuthenticationMarker,
      deviceAuthenticationVerifiedAt: snapshot.hasDeviceAuthenticationMarker ? new Date() : null,
      dataModelVerifiedAt: expectedRootFound ? new Date() : null,
      lastError: error,
    }).where(and(eq(tr069DevicesTable.id, device.id), eq(tr069DevicesTable.companyId, companyId))).returning();
    await db.update(tr069AcsConfigsTable).set({ lastValidatedAt: new Date(), lastError: null })
      .where(and(eq(tr069AcsConfigsTable.id, config.id), eq(tr069AcsConfigsTable.companyId, companyId)));
    void writeAuditLog({
      companyId, userId: req.user!.id, userEmail: req.user!.email,
      action: "read", entityType: "tr069_device", entityId: device.id, diff: { status, dataModelConfirmed: expectedRootFound },
    });
    res.json(publicDevice(updated!));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not refresh the ACS device.";
    const [updated] = await db.update(tr069DevicesTable).set({ status: "unknown", lastRefreshAt: new Date(), lastError: message })
      .where(and(eq(tr069DevicesTable.id, device.id), eq(tr069DevicesTable.companyId, companyId))).returning();
    await db.update(tr069AcsConfigsTable).set({ lastError: message })
      .where(and(eq(tr069AcsConfigsTable.id, config.id), eq(tr069AcsConfigsTable.companyId, companyId)));
    res.status(502).json(updated ? publicDevice(updated) : { error: message });
  }
});

router.get("/tr069/commands", requireRole("admin", "technician"), async (req, res): Promise<void> => {
  const companyId = tenantId(req, res);
  if (companyId == null) return;
  const rows = await db.select().from(tr069CommandsTable)
    .where(eq(tr069CommandsTable.companyId, companyId)).orderBy(tr069CommandsTable.createdAt);
  res.json(ListTr069CommandsResponse.parse(rows.map(publicCommand)));
});

router.post("/tr069/commands", requireRole("admin", "technician"), async (req, res): Promise<void> => {
  const companyId = tenantId(req, res);
  if (companyId == null) return;
  const body = parseOr400(CreateTr069CommandBody, req.body, res);
  if (!body) return;
  const [onu] = await db.select({ id: onusTable.id }).from(onusTable)
    .where(and(eq(onusTable.id, body.onuId), eq(onusTable.companyId, companyId)));
  const [profile] = await db.select().from(oltServiceProfilesTable)
    .where(and(eq(oltServiceProfilesTable.id, body.serviceProfileId), eq(oltServiceProfilesTable.companyId, companyId)));
  const [device] = await db.select().from(tr069DevicesTable)
    .where(and(eq(tr069DevicesTable.companyId, companyId), eq(tr069DevicesTable.onuId, body.onuId)));
  if (!onu || !profile || !device) {
    res.status(400).json({ error: "The ONU, service profile, and enrolled TR-069 CPE must all belong to the active company." });
    return;
  }
  const [config] = await db.select().from(tr069AcsConfigsTable)
    .where(and(eq(tr069AcsConfigsTable.id, device.acsConfigId), eq(tr069AcsConfigsTable.companyId, companyId)));
  if (!config || !config.enabled) {
    res.status(409).json({ error: "The CPE’s ACS connector is not configured or is disabled." });
    return;
  }
  let verifiedDevice: typeof tr069DevicesTable.$inferSelect;
  let currentlyOnline: boolean;
  try {
    const verification = await verifyDeviceAgainstAcs(companyId, device, config);
    verifiedDevice = verification.device;
    currentlyOnline = verification.online;
    if (!verification.verified) {
      res.status(409).json({ error: "The ACS authentication marker or reported data model no longer matches this CPE. Management was held without sending a task." });
      return;
    }
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Could not verify the ACS device before management." });
    return;
  }
  const unsupportedFields = unsupportedProfileFields(profile);
  if (profile.tr069InformIntervalSeconds == null) {
    const [unsupported] = await db.insert(tr069CommandsTable).values({
      companyId, tr069DeviceId: verifiedDevice.id, serviceProfileId: profile.id, requestedBy: req.user!.id,
      status: "unsupported", parameters: [], attemptCount: 0, completedAt: new Date(),
      error: "This service profile has no validated TR-069 management parameter.",
      recoveryGuidance: "Set a periodic inform interval on the profile, or complete lab validation for a model-specific VLAN/access/QoS mapping before retrying.",
      result: { unsupportedServiceFields: unsupportedFields },
    }).returning();
    void writeAuditLog({
      companyId, userId: req.user!.id, userEmail: req.user!.email,
      action: "failure", entityType: "tr069_command", entityId: unsupported!.id,
      diff: { status: "unsupported", serviceProfileId: profile.id, unsupportedServiceFields: unsupportedFields },
    });
    res.status(422).json(publicCommand(unsupported!));
    return;
  }
  const parameterValues = supportedParameters(verifiedDevice.dataModel, profile.tr069InformIntervalSeconds);
  if (body.applyImmediately && !currentlyOnline) {
    const [offline] = await db.insert(tr069CommandsTable).values({
      companyId, tr069DeviceId: verifiedDevice.id, serviceProfileId: profile.id, requestedBy: req.user!.id,
      parameters: parameterValues.map(([name, value]) => ({ name, value })), status: "offline",
      nextAttemptAt: new Date(Date.now() + RETRY_DELAY_MS),
      error: "The CPE is not currently online, so an immediate connection request was not sent.",
      recoveryGuidance: "Wait for the next Inform or refresh the CPE state, then retry. The task remains unexecuted until the ACS reports the device online.",
      result: { unsupportedServiceFields: unsupportedFields },
    }).returning();
    res.status(201).json(publicCommand(offline!));
    return;
  }
  const [command] = await db.insert(tr069CommandsTable).values({
    companyId, tr069DeviceId: verifiedDevice.id, serviceProfileId: profile.id, requestedBy: req.user!.id,
    parameters: parameterValues.map(([name, value]) => ({ name, value })), status: "queued",
    result: { unsupportedServiceFields: unsupportedFields },
  }).returning();
  try {
    const queued = await (await createClient(config)).enqueueSetParameterValues(verifiedDevice.acsDeviceId, parameterValues, body.applyImmediately);
    const status = queued.executedImmediately ? "completed" : "waiting_for_inform";
    const now = new Date();
    const [updated] = await db.update(tr069CommandsTable).set({
      status, attemptCount: 1, acsTaskId: queued.taskId, startedAt: now,
      completedAt: queued.executedImmediately ? now : null,
      recoveryGuidance: queued.executedImmediately
        ? (unsupportedFields.length ? `Network fields not applied: ${unsupportedFields.join(", ")}. Validate a model-specific mapping before changing them.` : null)
        : "The task is queued for the next successful Inform. Confirm the CPE is online and that the ACS connection-request policy is configured.",
    }).where(and(eq(tr069CommandsTable.id, command!.id), eq(tr069CommandsTable.companyId, companyId))).returning();
    if (queued.executedImmediately) {
      await db.update(tr069DevicesTable).set({ lastManagedAt: now, lastError: null })
        .where(and(eq(tr069DevicesTable.id, verifiedDevice.id), eq(tr069DevicesTable.companyId, companyId)));
    }
    void writeAuditLog({
      companyId, userId: req.user!.id, userEmail: req.user!.email,
      action: "provision", entityType: "tr069_command", entityId: command!.id,
      diff: { status, serviceProfileId: profile.id, unsupportedServiceFields: unsupportedFields },
    });
    res.status(201).json(publicCommand(updated!));
  } catch (error) {
    const message = error instanceof Error ? error.message : "The ACS task could not be queued.";
    const [failed] = await db.update(tr069CommandsTable).set({
      status: "failed", attemptCount: 1, error: message, nextAttemptAt: new Date(Date.now() + RETRY_DELAY_MS),
      recoveryGuidance: "Check the ACS HTTPS endpoint and NBI credentials, then retry. Do not change device credentials in NetPulse.",
      completedAt: new Date(),
    }).where(and(eq(tr069CommandsTable.id, command!.id), eq(tr069CommandsTable.companyId, companyId))).returning();
    res.status(502).json(publicCommand(failed!));
  }
});

router.post("/tr069/commands/:id/retry", requireRole("admin", "technician"), async (req, res): Promise<void> => {
  const companyId = tenantId(req, res);
  if (companyId == null) return;
  const params = parseOr400(RetryTr069CommandParams, req.params, res);
  if (!params) return;
  const [command] = await db.select().from(tr069CommandsTable)
    .where(and(eq(tr069CommandsTable.id, params.id), eq(tr069CommandsTable.companyId, companyId)));
  if (!command) {
    res.status(404).json({ error: "TR-069 command not found." });
    return;
  }
  if (!["failed", "offline", "waiting_for_inform", "queued", "retry_scheduled"].includes(command.status)) {
    res.status(409).json({ error: "This command cannot be retried in its current state." });
    return;
  }
  const [device] = await db.select().from(tr069DevicesTable)
    .where(and(eq(tr069DevicesTable.id, command.tr069DeviceId), eq(tr069DevicesTable.companyId, companyId)));
  const [config] = device ? await db.select().from(tr069AcsConfigsTable)
    .where(and(eq(tr069AcsConfigsTable.id, device.acsConfigId), eq(tr069AcsConfigsTable.companyId, companyId))) : [];
  if (!device || !config || !config.enabled) {
    res.status(409).json({ error: "The CPE or its ACS connector is unavailable for retry." });
    return;
  }
  let verifiedDevice: typeof tr069DevicesTable.$inferSelect;
  let currentlyOnline: boolean;
  try {
    const verification = await verifyDeviceAgainstAcs(companyId, device, config);
    verifiedDevice = verification.device;
    currentlyOnline = verification.online;
    if (!verification.verified) {
      res.status(409).json({ error: "The ACS authentication marker or reported data model no longer matches this CPE. Retry was held without sending a task." });
      return;
    }
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Could not verify the ACS device before retrying." });
    return;
  }
  if (!currentlyOnline) {
    const [held] = await db.update(tr069CommandsTable).set({
      status: "offline", nextAttemptAt: new Date(Date.now() + RETRY_DELAY_MS),
      error: "The CPE is offline, so the retry was held without sending a connection request.",
      recoveryGuidance: "Wait for the CPE to check in and refresh its state before retrying.",
    }).where(and(eq(tr069CommandsTable.id, command.id), eq(tr069CommandsTable.companyId, companyId))).returning();
    res.status(409).json(publicCommand(held!));
    return;
  }
  try {
    const client = await createClient(config);
    if (command.acsTaskId) {
      await client.retryTask(command.acsTaskId);
      const [updated] = await db.update(tr069CommandsTable).set({
        status: "retry_scheduled", attemptCount: command.attemptCount + 1, nextAttemptAt: null,
        error: null, recoveryGuidance: "GenieACS will retry the task on the next Inform.",
      }).where(and(eq(tr069CommandsTable.id, command.id), eq(tr069CommandsTable.companyId, companyId))).returning();
      res.json(publicCommand(updated!));
      return;
    }
    const values = Array.isArray(command.parameters)
      ? command.parameters
        .filter((value): value is { name: string; value: string | number | boolean } => Boolean(value) && typeof value === "object" && typeof (value as { name?: unknown }).name === "string" && ["string", "number", "boolean"].includes(typeof (value as { value?: unknown }).value))
        .map((value) => [value.name, value.value] as [string, string | number | boolean])
      : [];
    if (values.length === 0) {
      res.status(409).json({ error: "This command has no validated parameters to retry." });
      return;
    }
    const queued = await client.enqueueSetParameterValues(verifiedDevice.acsDeviceId, values, true);
    const now = new Date();
    const [updated] = await db.update(tr069CommandsTable).set({
      status: queued.executedImmediately ? "completed" : "waiting_for_inform",
      attemptCount: command.attemptCount + 1, acsTaskId: queued.taskId, startedAt: now,
      completedAt: queued.executedImmediately ? now : null, nextAttemptAt: null, error: null,
      recoveryGuidance: queued.executedImmediately ? null : "The replacement task is queued for the next successful Inform.",
    }).where(and(eq(tr069CommandsTable.id, command.id), eq(tr069CommandsTable.companyId, companyId))).returning();
    if (queued.executedImmediately) {
      await db.update(tr069DevicesTable).set({ lastManagedAt: now, lastError: null })
        .where(and(eq(tr069DevicesTable.id, verifiedDevice.id), eq(tr069DevicesTable.companyId, companyId)));
    }
    res.json(publicCommand(updated!));
  } catch (error) {
    const message = error instanceof Error ? error.message : "The ACS retry failed.";
    const [failed] = await db.update(tr069CommandsTable).set({
      status: "failed", attemptCount: command.attemptCount + 1, error: message,
      nextAttemptAt: new Date(Date.now() + RETRY_DELAY_MS),
      recoveryGuidance: "Check ACS health and the CPE’s next Inform time before retrying again.",
    }).where(and(eq(tr069CommandsTable.id, command.id), eq(tr069CommandsTable.companyId, companyId))).returning();
    res.status(502).json(publicCommand(failed!));
  }
});

export default router;