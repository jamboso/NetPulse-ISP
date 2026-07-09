import { db, pool, routersTable, ticketsTable, paymentsTable } from "@workspace/db";
import { sql, eq, gte, and } from "drizzle-orm";
import { execSync } from "child_process";
import path from "path";
import fs from "fs";

export interface DiagnosticsSnapshot {
  generatedAt: string;
  database: { connected: boolean; error?: string };
  schemaDrift: { hasDrift: boolean; missingColumns: string[] };
  routers: { total: number; online: number; offline: number };
  version: { commit: string; branch: string; updateAvailable: boolean };
  openTickets: number;
  failedPaymentsLast7Days: number;
}

function gitExec(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { cwd, encoding: "utf8", timeout: 15_000 }).trim();
  } catch {
    return "";
  }
}

/**
 * Compares live DB columns against the checked-in deploy/schema.sql to catch the
 * class of bug where a Drizzle migration adds a column that never made it into
 * schema.sql (the file the self-hosted "Update Now" script uses for fresh installs).
 * Only flags columns that exist in the live DB but are referenced nowhere in schema.sql.
 */
async function checkSchemaDrift(): Promise<{ hasDrift: boolean; missingColumns: string[] }> {
  try {
    const APP_DIR = process.env["NETPULSE_DIR"] ?? path.join(__dirname, "../../../..");
    const schemaSqlPath = path.join(APP_DIR, "deploy/schema.sql");
    if (!fs.existsSync(schemaSqlPath)) {
      return { hasDrift: false, missingColumns: [] };
    }
    const schemaSql = fs.readFileSync(schemaSqlPath, "utf8");

    const rows = await db.execute<{ table_name: string; column_name: string }>(sql`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, column_name
    `);

    const missing: string[] = [];
    for (const row of rows.rows) {
      const col = row.column_name;
      const table = row.table_name;
      // A column is "covered" if schema.sql mentions it anywhere in a CREATE TABLE
      // for that table or in an ADD COLUMN statement referencing that column name.
      const colPattern = new RegExp(`"${col}"`, "i");
      if (!colPattern.test(schemaSql)) {
        missing.push(`${table}.${col}`);
      }
    }

    return { hasDrift: missing.length > 0, missingColumns: missing.slice(0, 25) };
  } catch (err) {
    return { hasDrift: false, missingColumns: [] };
  }
}

export async function getDiagnosticsSnapshot(): Promise<DiagnosticsSnapshot> {
  const generatedAt = new Date().toISOString();

  let dbConnected = true;
  let dbError: string | undefined;
  try {
    await pool.query("SELECT 1");
  } catch (err) {
    dbConnected = false;
    dbError = err instanceof Error ? err.message : String(err);
  }

  const schemaDrift = dbConnected
    ? await checkSchemaDrift()
    : { hasDrift: false, missingColumns: [] };

  let routers = { total: 0, online: 0, offline: 0 };
  let openTickets = 0;
  let failedPaymentsLast7Days = 0;

  if (dbConnected) {
    try {
      const allRouters = await db.select().from(routersTable);
      const online = allRouters.filter((r) => r.monitorState === "online").length;
      routers = { total: allRouters.length, online, offline: allRouters.length - online };
    } catch {
      // leave defaults
    }

    try {
      const open = await db
        .select()
        .from(ticketsTable)
        .where(eq(ticketsTable.status, "open"));
      openTickets = open.length;
    } catch {
      // leave default
    }

    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const failed = await db
        .select()
        .from(paymentsTable)
        .where(and(eq(paymentsTable.status, "failed"), gte(paymentsTable.createdAt, sevenDaysAgo)));
      failedPaymentsLast7Days = failed.length;
    } catch {
      // leave default
    }
  }

  const APP_DIR = process.env["NETPULSE_DIR"] ?? "/opt/netpulse";
  const localCommit = gitExec("git rev-parse HEAD", APP_DIR);
  const branch = gitExec("git rev-parse --abbrev-ref HEAD", APP_DIR) || "main";
  const remoteCommit = gitExec("git rev-parse origin/main 2>/dev/null || true", APP_DIR);
  const updateAvailable = !!(remoteCommit && localCommit && remoteCommit !== localCommit);

  return {
    generatedAt,
    database: { connected: dbConnected, ...(dbError ? { error: dbError } : {}) },
    schemaDrift,
    routers,
    version: {
      commit: localCommit ? localCommit.slice(0, 7) : "unknown",
      branch,
      updateAvailable,
    },
    openTickets,
    failedPaymentsLast7Days,
  };
}

export function formatSnapshotForPrompt(snap: DiagnosticsSnapshot): string {
  const lines = [
    `Snapshot generated: ${snap.generatedAt}`,
    `Database: ${snap.database.connected ? "connected" : `DISCONNECTED (${snap.database.error})`}`,
    `Schema drift: ${
      snap.schemaDrift.hasDrift
        ? `POSSIBLE DRIFT — columns in DB not referenced in deploy/schema.sql: ${snap.schemaDrift.missingColumns.join(", ")}`
        : "none detected"
    }`,
    `Routers: ${snap.routers.total} total, ${snap.routers.online} online, ${snap.routers.offline} offline`,
    `Open support tickets: ${snap.openTickets}`,
    `Failed payments (last 7 days): ${snap.failedPaymentsLast7Days}`,
    `App version: commit ${snap.version.commit} on branch ${snap.version.branch}${
      snap.version.updateAvailable ? " (update available on origin/main)" : " (up to date)"
    }`,
  ];
  return lines.join("\n");
}
