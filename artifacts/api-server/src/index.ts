import app from "./app";
import { logger } from "./lib/logger";
import { startSessionPoller } from "./lib/sessionPoller";
import { startSmsScheduler } from "./lib/smsScheduler";
import { startRouterMonitor } from "./lib/routerMonitor";
import { startAuditLogPurgeScheduler } from "./lib/auditLogPurge";
import { startAuditExportScheduler } from "./lib/auditExportScheduler";
import { startDnsPoller } from "./lib/dnsPoller";
import { ensureCompanyBackfill } from "./lib/companyBackfill";
import { migrateLegacyNotificationSettings } from "./lib/notificationSettingsMigration";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function prepareStartup(): Promise<void> {
  try {
    await ensureCompanyBackfill();
  } catch (err) {
    logger.error({ err }, "Company backfill failed — continuing startup");
  }

  const migratedNotificationSettings = await migrateLegacyNotificationSettings();
  if (migratedNotificationSettings > 0) {
    logger.info(
      { migratedNotificationSettings },
      "Encrypted existing notification settings",
    );
  }
}

prepareStartup()
  .then(() => {
    app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }

      logger.info({ port }, "Server listening");
      startSessionPoller();
      startSmsScheduler();
      startRouterMonitor();
      startAuditLogPurgeScheduler();
      startAuditExportScheduler();
      startDnsPoller();
    });
  })
  .catch((err) => {
    logger.fatal({ err }, "Notification settings migration failed — refusing to start");
    process.exitCode = 1;
  });
