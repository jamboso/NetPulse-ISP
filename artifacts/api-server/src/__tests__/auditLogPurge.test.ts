/**
 * Integration tests for purgeAuditLogs().
 *
 * These tests run against the real database so we can verify actual deletion
 * semantics: old rows are removed, recent rows survive.
 *
 * Isolation strategy:
 *  - All seeded audit_log rows use userId = "__test_purge__" so they never
 *    clash with real data and are cleaned up in beforeEach / afterEach.
 *  - The `auditLogRetentionDays` setting is upserted before each test and
 *    restored to the original value afterward.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  db,
  auditLogsTable,
  settingsTable,
  auditPurgeLogTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";

vi.mock("../lib/logger.js", () => ({
  logger: {
    info:  vi.fn(),
    debug: vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
  },
}));

const { purgeAuditLogs } = await import("../lib/auditLogPurge.js");

const TEST_USER_ID = "__test_purge__";

async function seedAuditRow(daysAgo: number): Promise<number> {
  const ts = new Date();
  ts.setDate(ts.getDate() - daysAgo);

  const rows = await db
    .insert(auditLogsTable)
    .values({
      userId:     TEST_USER_ID,
      action:     "test.action",
      entityType: "test",
      createdAt:  ts,
    })
    .returning({ id: auditLogsTable.id });

  return rows[0]!.id;
}

async function setRetentionDays(days: number) {
  await db.execute(sql`
    INSERT INTO settings (key, value, updated_at)
    VALUES ('auditLogRetentionDays', ${String(days)}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = ${String(days)}, updated_at = NOW()
  `);
}

async function fetchAuditRow(id: number) {
  const rows = await db
    .select({ id: auditLogsTable.id })
    .from(auditLogsTable)
    .where(eq(auditLogsTable.id, id))
    .limit(1);
  return rows[0] ?? null;
}

async function cleanupTestRows() {
  await db
    .delete(auditLogsTable)
    .where(eq(auditLogsTable.userId, TEST_USER_ID));
}

let originalRetentionDays: string | null | undefined;

beforeEach(async () => {
  await cleanupTestRows();

  const rows = await db
    .select({ value: settingsTable.value })
    .from(settingsTable)
    .where(eq(settingsTable.key, "auditLogRetentionDays"))
    .limit(1);

  originalRetentionDays = rows[0]?.value;
});

afterEach(async () => {
  await cleanupTestRows();

  if (originalRetentionDays === undefined) {
    await db
      .delete(settingsTable)
      .where(eq(settingsTable.key, "auditLogRetentionDays"));
  } else {
    await db.execute(sql`
      INSERT INTO settings (key, value, updated_at)
      VALUES ('auditLogRetentionDays', ${originalRetentionDays}, NOW())
      ON CONFLICT (key) DO UPDATE SET value = ${originalRetentionDays}, updated_at = NOW()
    `);
  }
});

describe("purgeAuditLogs() — integration", () => {
  it("deletes rows older than the retention window and returns their count", async () => {
    await setRetentionDays(30);

    const oldId    = await seedAuditRow(40);
    const oldId2   = await seedAuditRow(35);

    const count = await purgeAuditLogs("test");

    expect(count).toBeGreaterThanOrEqual(2);

    expect(await fetchAuditRow(oldId)).toBeNull();
    expect(await fetchAuditRow(oldId2)).toBeNull();
  });

  it("preserves rows that are within the retention window", async () => {
    await setRetentionDays(30);

    const recentId  = await seedAuditRow(5);
    const recentId2 = await seedAuditRow(1);

    await purgeAuditLogs("test");

    expect(await fetchAuditRow(recentId)).not.toBeNull();
    expect(await fetchAuditRow(recentId2)).not.toBeNull();

    await db.delete(auditLogsTable).where(
      inArray(auditLogsTable.id, [recentId, recentId2]),
    );
  });

  it("deletes old rows but leaves recent rows intact in the same run", async () => {
    await setRetentionDays(30);

    const oldId    = await seedAuditRow(45);
    const recentId = await seedAuditRow(10);

    const count = await purgeAuditLogs("test");

    expect(count).toBeGreaterThanOrEqual(1);
    expect(await fetchAuditRow(oldId)).toBeNull();
    expect(await fetchAuditRow(recentId)).not.toBeNull();

    await db.delete(auditLogsTable).where(eq(auditLogsTable.id, recentId));
  });

  it("skips deletion entirely when retentionDays is 0 and rows remain untouched", async () => {
    await setRetentionDays(0);

    const id = await seedAuditRow(400);

    const count = await purgeAuditLogs("test");

    expect(count).toBe(0);
    expect(await fetchAuditRow(id)).not.toBeNull();
  });

  it("still writes a purge_log entry when retentionDays is 0", async () => {
    await setRetentionDays(0);

    const before = new Date();
    await purgeAuditLogs("test-zero");

    const rows = await db
      .select()
      .from(auditPurgeLogTable)
      .where(eq(auditPurgeLogTable.triggeredBy, "test-zero"));

    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[rows.length - 1]!.deletedCount).toBe(0);
    expect(rows[rows.length - 1]!.purgedAt.getTime()).toBeGreaterThanOrEqual(
      before.getTime() - 1000,
    );

    await db
      .delete(auditPurgeLogTable)
      .where(eq(auditPurgeLogTable.triggeredBy, "test-zero"));
  });

  it("writes a purge_log entry recording how many rows were deleted", async () => {
    await setRetentionDays(30);
    const oldId1 = await seedAuditRow(60);
    const oldId2 = await seedAuditRow(50);

    void oldId1; void oldId2;

    await purgeAuditLogs("test-log");

    const rows = await db
      .select()
      .from(auditPurgeLogTable)
      .where(eq(auditPurgeLogTable.triggeredBy, "test-log"));

    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[rows.length - 1]!.deletedCount).toBeGreaterThanOrEqual(2);

    await db
      .delete(auditPurgeLogTable)
      .where(eq(auditPurgeLogTable.triggeredBy, "test-log"));
  });

  it("returns 0 and leaves all rows when none exceed the retention window", async () => {
    await setRetentionDays(365);

    const recentId = await seedAuditRow(10);

    const count = await purgeAuditLogs("test");

    expect(count).toBe(0);
    expect(await fetchAuditRow(recentId)).not.toBeNull();

    await db.delete(auditLogsTable).where(eq(auditLogsTable.id, recentId));
  });
});
