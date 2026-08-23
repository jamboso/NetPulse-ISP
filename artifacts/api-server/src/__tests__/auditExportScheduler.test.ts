import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSendMail = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const mockCreateTransport = vi.hoisted(() => vi.fn().mockReturnValue({
  sendMail: mockSendMail,
}));
const mockGetSettings = vi.hoisted(() => vi.fn());
const mockInsertValues = vi.hoisted(() => vi.fn());
const mockAuditRows = vi.hoisted(() => vi.fn());
const mockLastSentRows = vi.hoisted(() => vi.fn());

vi.mock("nodemailer", () => ({
  default: { createTransport: mockCreateTransport },
}));

vi.mock("../lib/sms.js", () => ({
  getSettings: mockGetSettings,
}));

vi.mock("drizzle-orm", () => ({
  desc: vi.fn(),
  eq: vi.fn(),
}));

vi.mock("@workspace/db", () => {
  const auditLogsTable = { createdAt: {} };
  const settingsTable = { key: {} };

  const query = {
    from(table: unknown) {
      return {
        orderBy() {
          return {
            limit: () => Promise.resolve(table === auditLogsTable ? mockAuditRows() : mockLastSentRows()),
          };
        },
        where() {
          return {
            limit: () => Promise.resolve(mockLastSentRows()),
          };
        },
      };
    },
  };

  return {
    db: {
      select: () => query,
      insert: () => ({
        values: (value: unknown) => {
          mockInsertValues(value);
          return Promise.resolve();
        },
      }),
    },
    auditLogsTable,
    settingsTable,
  };
});

const { isAuditLogExportDue, runAuditLogExportIfDue } =
  await import("../lib/auditExportScheduler.js");

const NOW = Date.parse("2026-08-23T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const SCHEDULED_EXPORT_SETTINGS = {
  exportScheduleEnabled: "1",
  exportScheduleFrequency: "daily",
  exportScheduleEmail: "compliance@example.com",
  smtpHost: "smtp.example.com",
  smtpUser: "mailer@example.com",
  smtpPass: "smtp-password",
  smtpPort: "587",
  smtpFrom: "exports@example.com",
  companyName: "Acme ISP",
};

function settings(
  frequency: string,
  lastSentAt?: string,
): Parameters<typeof isAuditLogExportDue>[0] {
  return {
    exportScheduleEnabled: "1",
    exportScheduleFrequency: frequency,
    exportScheduleLastSentAt: lastSentAt,
  };
}

describe("isAuditLogExportDue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not schedule an export when the schedule is disabled", () => {
    expect(isAuditLogExportDue({
      exportScheduleEnabled: "0",
      exportScheduleFrequency: "daily",
    }, NOW)).toBe(false);
  });

  it("schedules the first enabled export when it has never been sent", () => {
    expect(isAuditLogExportDue(settings("weekly"), NOW)).toBe(true);
  });

  it.each([
    ["daily", 24],
    ["weekly", 24 * 7],
    ["monthly", 24 * 30],
  ])("waits for the full %s interval and becomes due at its boundary", (frequency, hours) => {
    const lastSentAt = new Date(NOW - hours * HOUR).toISOString();

    expect(isAuditLogExportDue(settings(frequency, lastSentAt), NOW - 1)).toBe(false);
    expect(isAuditLogExportDue(settings(frequency, lastSentAt), NOW)).toBe(true);
  });

  it("uses the weekly interval for an unknown frequency", () => {
    const lastSentAt = new Date(NOW - (24 * 7) * HOUR).toISOString();

    expect(isAuditLogExportDue(settings("unexpected-value", lastSentAt), NOW - 1)).toBe(false);
    expect(isAuditLogExportDue(settings("unexpected-value", lastSentAt), NOW)).toBe(true);
  });

  it("treats an invalid last-sent timestamp as due so a bad value cannot block exports", () => {
    expect(isAuditLogExportDue(settings("weekly", "not-a-timestamp"), NOW)).toBe(true);
  });
});

describe("runAuditLogExportIfDue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    mockAuditRows.mockReturnValue([]);
    mockLastSentRows.mockReturnValue([]);
    mockGetSettings.mockResolvedValue(SCHEDULED_EXPORT_SETTINGS);
    mockSendMail.mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("generates and emails a CSV export, then records when a due schedule succeeds", async () => {
    mockAuditRows.mockReturnValue([
      {
        createdAt: new Date("2026-08-22T08:30:00.000Z"),
        userEmail: "staff@example.com",
        userId: "staff-1",
        action: "customer.updated",
        entityType: "customer",
        entityId: 42,
        diff: { before: { plan: "Basic" }, after: { plan: "Pro" } },
      },
    ]);

    await runAuditLogExportIfDue();

    expect(mockCreateTransport).toHaveBeenCalledWith({
      host: "smtp.example.com",
      port: 587,
      secure: false,
      auth: { user: "mailer@example.com", pass: "smtp-password" },
    });
    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: "exports@example.com",
      to: "compliance@example.com",
      subject: "Acme ISP — Audit Log Export (2026-08-23)",
      text: expect.stringContaining("scheduled daily audit log export"),
    }));

    const mail = mockSendMail.mock.calls[0]![0] as {
      attachments: Array<{ filename: string; content: string; contentType: string }>;
    };
    expect(mail.attachments).toEqual([expect.objectContaining({
      filename: "audit-log-2026-08-23.csv",
      contentType: "text/csv",
    })]);
    expect(mail.attachments[0]!.content).toContain(
      "Timestamp,User Email,User ID,Action,Entity Type,Entity ID,Diff Summary",
    );
    expect(mail.attachments[0]!.content).toContain("customer.updated");
    expect(mail.attachments[0]!.content).toContain("\"plan: \"\"Basic\"\" → \"\"Pro\"\"\"");
    expect(mockInsertValues).toHaveBeenCalledWith({
      key: "exportScheduleLastSentAt",
      value: "2026-08-23T12:00:00.000Z",
    });
  });

  it.each([
    ["the schedule is disabled", { ...SCHEDULED_EXPORT_SETTINGS, exportScheduleEnabled: "0" }],
    [
      "the previous weekly export is still within its interval",
      {
        ...SCHEDULED_EXPORT_SETTINGS,
        exportScheduleFrequency: "weekly",
        exportScheduleLastSentAt: new Date(NOW - (24 * HOUR)).toISOString(),
      },
    ],
  ])("does not send an export when %s", async (_reason, scheduledSettings) => {
    mockGetSettings.mockResolvedValue(scheduledSettings);

    await runAuditLogExportIfDue();

    expect(mockCreateTransport).not.toHaveBeenCalled();
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it("does not advance the last-sent timestamp when the scheduled email fails", async () => {
    mockSendMail.mockRejectedValueOnce(new Error("SMTP unavailable"));

    await expect(runAuditLogExportIfDue()).rejects.toThrow("SMTP unavailable");

    expect(mockSendMail).toHaveBeenCalledOnce();
    expect(mockInsertValues).not.toHaveBeenCalled();
  });
});