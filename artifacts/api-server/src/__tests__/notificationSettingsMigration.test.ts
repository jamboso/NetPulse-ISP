import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExec = vi.hoisted(() => vi.fn());
const mockSet = vi.hoisted(() => vi.fn());

vi.mock("@workspace/db", () => {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "from", "update", "where"]) {
    chain[method] = () => chain;
  }
  chain["set"] = (value: unknown) => {
    mockSet(value);
    return chain;
  };
  chain["then"] = (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
    mockExec().then(resolve, reject);

  return {
    db: chain,
    settingsTable: { key: {}, value: {}, updatedAt: {} },
  };
});

const { migrateLegacyNotificationSettings } = await import("../lib/notificationSettingsMigration.js");

describe("migrateLegacyNotificationSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env["SESSION_SECRET"] = "notification-settings-migration-test-secret";
  });

  it("encrypts only legacy notification settings without returning their values", async () => {
    mockExec
      .mockResolvedValueOnce([
        { key: "companyName", value: "ACME ISP" },
        { key: "smtpPass", value: "legacy-app-password" },
        { key: "alertSlackWebhook", value: "https://hooks.slack.com/services/T000/B000/secret" },
        { key: "alertEmail", value: null },
        { key: "smtpHost", value: "v1:already:encrypted:value" },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await expect(migrateLegacyNotificationSettings()).resolves.toBe(2);

    expect(mockSet).toHaveBeenCalledTimes(2);
    for (const [update] of mockSet.mock.calls) {
      expect(update.value).toMatch(/^v1:[^:]+:[^:]+:[^:]+$/);
      expect(update.value).not.toContain("legacy-app-password");
      expect(update.value).not.toContain("hooks.slack.com");
    }
  });
});