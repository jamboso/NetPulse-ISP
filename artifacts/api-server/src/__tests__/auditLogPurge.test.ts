/**
 * Tests for auditLogPurge module.
 *
 * Integration tests for purgeAuditLogs() run against the real database to
 * verify actual deletion semantics.
 *
 * Unit tests for startAuditLogPurgeScheduler() use fake timers and spies to
 * confirm: (a) the initial purge fires on startup, (b) setInterval is
 * registered with the correct 24-hour interval, and (c) errors are caught
 * and logged rather than thrown.
 *
 * Isolation strategy (integration tests):
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

const { purgeAuditLogs, startAuditLogPurgeScheduler } = await import("../lib/auditLogPurge.js");
const { logger } = await import("../lib/logger.js");

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

  it('writes a purge_log row with triggeredBy set to "scheduler"', async () => {
    await setRetentionDays(30);

    await purgeAuditLogs("scheduler");

    const rows = await db
      .select()
      .from(auditPurgeLogTable)
      .where(eq(auditPurgeLogTable.triggeredBy, "scheduler"));

    expect(rows.length).toBeGreaterThanOrEqual(1);
    const last = rows[rows.length - 1]!;
    expect(last.triggeredBy).toBe("scheduler");
    expect(typeof last.deletedCount).toBe("number");
    expect(last.purgedAt).toBeInstanceOf(Date);

    await db
      .delete(auditPurgeLogTable)
      .where(eq(auditPurgeLogTable.triggeredBy, "scheduler"));
  });

  it('writes a purge_log row with triggeredBy set to "manual"', async () => {
    await setRetentionDays(30);

    await purgeAuditLogs("manual");

    const rows = await db
      .select()
      .from(auditPurgeLogTable)
      .where(eq(auditPurgeLogTable.triggeredBy, "manual"));

    expect(rows.length).toBeGreaterThanOrEqual(1);
    const last = rows[rows.length - 1]!;
    expect(last.triggeredBy).toBe("manual");

    await db
      .delete(auditPurgeLogTable)
      .where(eq(auditPurgeLogTable.triggeredBy, "manual"));
  });

  it("each run appends a new row — two runs produce two purge_log entries", async () => {
    await setRetentionDays(30);
    const marker = "test-two-runs";

    await purgeAuditLogs(marker);
    await purgeAuditLogs(marker);

    const rows = await db
      .select()
      .from(auditPurgeLogTable)
      .where(eq(auditPurgeLogTable.triggeredBy, marker));

    expect(rows.length).toBeGreaterThanOrEqual(2);

    await db
      .delete(auditPurgeLogTable)
      .where(eq(auditPurgeLogTable.triggeredBy, marker));
  });

  it("purge_log rows are stored in ascending insertion order (most recent last by purgedAt)", async () => {
    await setRetentionDays(30);
    const marker = "test-order";

    await purgeAuditLogs(marker);
    await purgeAuditLogs(marker);

    const rows = await db
      .select()
      .from(auditPurgeLogTable)
      .where(eq(auditPurgeLogTable.triggeredBy, marker));

    expect(rows.length).toBeGreaterThanOrEqual(2);

    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.purgedAt.getTime()).toBeGreaterThanOrEqual(
        rows[i - 1]!.purgedAt.getTime(),
      );
    }

    await db
      .delete(auditPurgeLogTable)
      .where(eq(auditPurgeLogTable.triggeredBy, marker));
  });

  it("purge_log entry has the expected shape (id, purgedAt, deletedCount, triggeredBy)", async () => {
    await setRetentionDays(30);
    const marker = "test-shape";

    await purgeAuditLogs(marker);

    const rows = await db
      .select()
      .from(auditPurgeLogTable)
      .where(eq(auditPurgeLogTable.triggeredBy, marker));

    expect(rows.length).toBeGreaterThanOrEqual(1);
    const row = rows[0]!;
    expect(typeof row.id).toBe("number");
    expect(row.purgedAt).toBeInstanceOf(Date);
    expect(typeof row.deletedCount).toBe("number");
    expect(row.triggeredBy).toBe(marker);

    await db
      .delete(auditPurgeLogTable)
      .where(eq(auditPurgeLogTable.triggeredBy, marker));
  });
});

// ---------------------------------------------------------------------------
// startAuditLogPurgeScheduler() — unit tests
// ---------------------------------------------------------------------------

describe("startAuditLogPurgeScheduler() — scheduler behaviour", () => {
  const INTERVAL_MS = 24 * 60 * 60 * 1000;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * `purgeAuditLogs` is async and calls `db.select()` synchronously (before its
   * first `await`) as part of building the Drizzle query chain.  Checking that
   * `db.select` was called immediately — without advancing any timers — proves
   * that `purgeAuditLogs` was invoked on startup, before the first interval tick.
   */
  it("calls purgeAuditLogs immediately on startup before any interval tick", () => {
    const selectSpy = vi.spyOn(db, "select");

    startAuditLogPurgeScheduler();

    expect(selectSpy).toHaveBeenCalled();

    selectSpy.mockRestore();
  });

  it("registers setInterval with exactly 24 hours (86 400 000 ms)", () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

    startAuditLogPurgeScheduler();

    expect(setIntervalSpy).toHaveBeenCalledWith(
      expect.any(Function),
      INTERVAL_MS,
    );

    setIntervalSpy.mockRestore();
  });

  it("fires purgeAuditLogs again after advancing exactly 24 hours", async () => {
    const selectSpy = vi.spyOn(db, "select");

    startAuditLogPurgeScheduler();

    const selectCallsAfterStartup = selectSpy.mock.calls.length;
    expect(selectCallsAfterStartup).toBeGreaterThanOrEqual(1);

    await vi.advanceTimersByTimeAsync(INTERVAL_MS);

    expect(selectSpy.mock.calls.length).toBeGreaterThan(selectCallsAfterStartup);

    selectSpy.mockRestore();
  });

  it("does not fire the interval callback before 24 hours have elapsed", async () => {
    const selectSpy = vi.spyOn(db, "select");

    startAuditLogPurgeScheduler();

    const selectCallsAfterStartup = selectSpy.mock.calls.length;

    await vi.advanceTimersByTimeAsync(INTERVAL_MS - 1);

    expect(selectSpy.mock.calls.length).toBe(selectCallsAfterStartup);

    selectSpy.mockRestore();
  });

  it("catches errors from the initial purge run and logs a warning instead of throwing", async () => {
    vi.spyOn(db, "select").mockImplementationOnce(() => {
      throw new Error("DB connection refused");
    });

    expect(() => startAuditLogPurgeScheduler()).not.toThrow();

    await vi.advanceTimersByTimeAsync(0);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "Audit log purge: initial run failed",
    );
  });

  it("catches errors from interval purge runs and logs a warning instead of throwing", async () => {
    startAuditLogPurgeScheduler();

    vi.spyOn(db, "select").mockImplementationOnce(() => {
      throw new Error("connection timeout");
    });

    await vi.advanceTimersByTimeAsync(INTERVAL_MS);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "Audit log purge: scheduled run failed",
    );
  });
});
