import { and, eq } from "drizzle-orm";
import { db, tr069AcsConfigsTable, tr069CommandsTable, tr069DevicesTable } from "@workspace/db";
import { writeAuditLog } from "./audit";
import { decryptTr069AcsCredentials } from "./tr069Credentials";
import { GenieAcsClient } from "./genieAcsClient";
import { logger } from "./logger";

const INTERVAL_MS = 60_000;
const RETRY_DELAY_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const ONLINE_WINDOW_MS = 10 * 60 * 1000;
let reconciling = false;

function parameterValues(value: unknown): Array<[string, string | number | boolean]> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as { name?: unknown; value?: unknown };
    if (typeof candidate.name !== "string" || !["string", "number", "boolean"].includes(typeof candidate.value)) return [];
    return [[candidate.name, candidate.value as string | number | boolean]];
  });
}

function online(lastInformAt: Date | null): boolean {
  return Boolean(lastInformAt && Date.now() - lastInformAt.getTime() <= ONLINE_WINDOW_MS);
}

async function reconcileCompany(config: typeof tr069AcsConfigsTable.$inferSelect): Promise<void> {
  if (!config.enabled) return;
  const client = await GenieAcsClient.create(config.baseUrl, decryptTr069AcsCredentials(config.encryptedNbiCredentials));
  const devices = await db.select().from(tr069DevicesTable)
    .where(and(eq(tr069DevicesTable.companyId, config.companyId), eq(tr069DevicesTable.acsConfigId, config.id)));
  const commands = await db.select().from(tr069CommandsTable)
    .where(eq(tr069CommandsTable.companyId, config.companyId));
  const now = new Date();

  for (const device of devices) {
    try {
      const snapshot = await client.getDevice(device.acsDeviceId);
      const expectedRoot = device.dataModel === "tr-098" ? snapshot.hasTr098Root : snapshot.hasTr181Root;
      const status = !snapshot.found ? "pending_inform" : !expectedRoot ? "unknown" : online(snapshot.lastInformAt) ? "online" : "offline";
      await db.update(tr069DevicesTable).set({
        status,
        lastInformAt: snapshot.lastInformAt,
        lastRefreshAt: now,
        reportedParameters: snapshot.reportedParameters,
        deviceAuthenticationConfigured: snapshot.hasDeviceAuthenticationMarker,
        deviceAuthenticationVerifiedAt: snapshot.hasDeviceAuthenticationMarker ? now : null,
        dataModelVerifiedAt: expectedRoot ? now : null,
        lastError: !snapshot.found ? "The ACS has not received an Inform for this enrolled device." : !snapshot.hasDeviceAuthenticationMarker ? "The ACS device is missing the netpulse-auth-verified authentication marker." : !expectedRoot ? `The ACS device does not expose ${device.dataModel.toUpperCase()}.` : null,
      }).where(and(eq(tr069DevicesTable.id, device.id), eq(tr069DevicesTable.companyId, config.companyId)));

      const related = commands.filter((command) => command.tr069DeviceId === device.id);
      for (const command of related) {
        const due = command.nextAttemptAt == null || command.nextAttemptAt.getTime() <= now.getTime();
        if (["waiting_for_inform", "queued"].includes(command.status) && status === "offline") {
          await db.update(tr069CommandsTable).set({
            status: "offline", nextAttemptAt: command.acsTaskId ? null : new Date(now.getTime() + RETRY_DELAY_MS),
            error: "The CPE is offline; the ACS task is waiting for its next Inform.",
            recoveryGuidance: "Restore CPE connectivity and wait for an Inform. Do not create a duplicate task while the existing ACS task is queued.",
          }).where(and(eq(tr069CommandsTable.id, command.id), eq(tr069CommandsTable.companyId, config.companyId)));
          continue;
        }
        if (!["offline", "retry_scheduled", "failed"].includes(command.status) || !due || command.attemptCount >= MAX_ATTEMPTS || status !== "online" || !snapshot.hasDeviceAuthenticationMarker || !expectedRoot) {
          continue;
        }
        const values = parameterValues(command.parameters);
        if (values.length === 0) continue;
        try {
          const task = command.acsTaskId
            ? (await client.retryTask(command.acsTaskId), { taskId: command.acsTaskId, executedImmediately: false })
            : await client.enqueueSetParameterValues(device.acsDeviceId, values, true);
          const completedAt = task.executedImmediately ? now : null;
          await db.update(tr069CommandsTable).set({
            status: task.executedImmediately ? "completed" : "waiting_for_inform",
            attemptCount: command.attemptCount + 1,
            acsTaskId: task.taskId,
            nextAttemptAt: null,
            error: null,
            startedAt: now,
            completedAt,
            recoveryGuidance: task.executedImmediately ? null : "GenieACS accepted the retry and will complete it on the CPE’s next Inform.",
          }).where(and(eq(tr069CommandsTable.id, command.id), eq(tr069CommandsTable.companyId, config.companyId)));
          if (task.executedImmediately) {
            await db.update(tr069DevicesTable).set({ lastManagedAt: now })
              .where(and(eq(tr069DevicesTable.id, device.id), eq(tr069DevicesTable.companyId, config.companyId)));
          }
          void writeAuditLog({
            companyId: config.companyId, userId: "system:tr069-reconciler", action: "provision",
            entityType: "tr069_command", entityId: command.id,
            diff: { automatedRetry: true, status: task.executedImmediately ? "completed" : "waiting_for_inform", attempt: command.attemptCount + 1 },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Automated ACS retry failed.";
          await db.update(tr069CommandsTable).set({
            status: "failed", attemptCount: command.attemptCount + 1,
            nextAttemptAt: command.attemptCount + 1 < MAX_ATTEMPTS ? new Date(now.getTime() + RETRY_DELAY_MS) : null,
            error: message,
            recoveryGuidance: command.attemptCount + 1 < MAX_ATTEMPTS
              ? "The reconciler will retry after the backoff window if the CPE remains online."
              : "Automatic retries are exhausted. Review ACS health and the CPE’s CWMP authentication marker before a manual retry.",
          }).where(and(eq(tr069CommandsTable.id, command.id), eq(tr069CommandsTable.companyId, config.companyId)));
        }
      }
    } catch (error) {
      logger.warn({ companyId: config.companyId, tr069DeviceId: device.id, err: error }, "TR-069 device reconciliation failed");
    }
  }
}

export async function reconcileTr069Commands(): Promise<void> {
  if (reconciling) return;
  reconciling = true;
  try {
    const configs = await db.select().from(tr069AcsConfigsTable).where(eq(tr069AcsConfigsTable.enabled, true));
    for (const config of configs) await reconcileCompany(config);
  } catch (error) {
    logger.error({ err: error }, "TR-069 command reconciler failed");
  } finally {
    reconciling = false;
  }
}

export function startTr069CommandReconciler(): void {
  void reconcileTr069Commands();
  setInterval(() => void reconcileTr069Commands(), INTERVAL_MS);
  logger.info({ intervalMs: INTERVAL_MS }, "TR-069 command reconciler started");
}