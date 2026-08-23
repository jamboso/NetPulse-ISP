import { vi } from "vitest";

const noop = async (): Promise<void> => undefined;

// Route handlers intentionally start these jobs after responding. Running the
// real implementations in unit tests lets work leak into subsequent test files.
vi.mock("../lib/radiusSync.js", () => ({
  syncPlanRadiusGroup: noop,
  syncSubscriptionCreate: noop,
  syncSubscriptionSuspend: noop,
  syncSubscriptionReactivate: noop,
  syncSubscriptionCancel: noop,
  syncStaffUserRadius: noop,
  syncAllSubscriptions: async () => ({ synced: 0, skipped: 0 }),
  upsertRadnas: noop,
  removeRadnas: noop,
}));

const log = vi.fn();

// Background jobs may report an expected test-double failure after the test
// response has completed. Keep test output focused on assertions instead.
vi.mock("../lib/logger.js", () => ({
  logger: {
    trace: log,
    debug: log,
    info: log,
    warn: log,
    error: log,
    fatal: log,
    child: () => ({
      trace: log,
      debug: log,
      info: log,
      warn: log,
      error: log,
      fatal: log,
    }),
  },
}));