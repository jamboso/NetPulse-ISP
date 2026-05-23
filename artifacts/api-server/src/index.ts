import app from "./app";
import { logger } from "./lib/logger";
import { startSessionPoller } from "./lib/sessionPoller";
import { startSmsScheduler } from "./lib/smsScheduler";
import { startRouterMonitor } from "./lib/routerMonitor";
import { startAuditLogPurgeScheduler } from "./lib/auditLogPurge";
import { startAuditExportScheduler } from "./lib/auditExportScheduler";
import { startDnsPoller } from "./lib/dnsPoller";

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
