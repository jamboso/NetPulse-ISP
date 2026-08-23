import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  companiesTable,
  db,
  sessionsTable,
  staffInactivityDigestLogTable,
  usersTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const mockGetSettings = vi.hoisted(() => vi.fn());
const mockSendStaffInactivityDigestEmail = vi.hoisted(() => vi.fn());

vi.mock("../lib/sms.js", () => ({
  getSettings: mockGetSettings,
}));

vi.mock("../lib/mailer.js", () => ({
  sendStaffInactivityDigestEmail: mockSendStaffInactivityDigestEmail,
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn() },
}));

const { runStaffInactivityDigest } = await import("../lib/staffInactivityDigest.js");

const SMTP_SETTINGS = {
  smtpHost: "smtp.example.com",
  smtpUser: "mailer@example.com",
  smtpPass: "test-secret",
};
const NOW = new Date("2026-08-23T12:00:00.000Z");
const cutoff = new Date("2026-07-24T12:00:00.000Z");

type TestCompany = { id: number; name: string; ownerEmail: string };
let companyIds: number[] = [];
let userIds: string[] = [];

function id(suffix: string): string {
  return `test-inactivity-${suffix}-${crypto.randomUUID()}`;
}

async function createCompany(name: string): Promise<TestCompany> {
  const username = id("company").replaceAll("-", "").slice(-18);
  const ownerEmail = `${username}@example.test`;
  const [company] = await db
    .insert(companiesTable)
    .values({ name, username, ownerEmail })
    .returning({
      id: companiesTable.id,
      name: companiesTable.name,
      ownerEmail: companiesTable.ownerEmail,
    });
  companyIds.push(company!.id);
  return company!;
}

async function createStaff(
  companyId: number,
  options: { name: string; createdAt: Date; active?: boolean; role?: string; lastLoginAt?: Date },
): Promise<{ email: string }> {
  const userId = id("user");
  const email = `${userId}@example.test`;
  userIds.push(userId);
  await db.insert(usersTable).values({
    id: userId,
    email,
    name: options.name,
    role: options.role ?? "support",
    active: options.active ?? true,
    companyId,
    createdAt: options.createdAt,
    updatedAt: options.createdAt,
  });

  if (options.lastLoginAt) {
    await db.insert(sessionsTable).values({
      id: id("session"),
      userId,
      token: id("token"),
      expiresAt: new Date(options.lastLoginAt.getTime() + 24 * 60 * 60 * 1000),
      createdAt: options.lastLoginAt,
      updatedAt: options.lastLoginAt,
    });
  }

  return { email };
}

async function cleanup(): Promise<void> {
  if (userIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  }
  if (companyIds.length > 0) {
    await db.delete(companiesTable).where(inArray(companiesTable.id, companyIds));
  }
  userIds = [];
  companyIds = [];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("REPLIT_DOMAINS", "portal.example.com");
  mockGetSettings.mockResolvedValue(SMTP_SETTINGS);
  mockSendStaffInactivityDigestEmail.mockResolvedValue({
    success: true,
    message: "Staff inactivity digest sent",
  });
});

afterEach(async () => {
  await cleanup();
  vi.unstubAllEnvs();
});

describe("runStaffInactivityDigest", () => {
  it("sends each tenant only its own dormant active staff, including accounts at the 30-day boundary", async () => {
    const alpha = await createCompany("Alpha Networks");
    const beta = await createCompany("Beta Broadband");

    const alphaAdmin = await createStaff(alpha.id, { name: "Alpha admin", role: "admin", createdAt: new Date("2026-06-01"), lastLoginAt: new Date("2026-08-20") });
    const alphaSecondAdmin = await createStaff(alpha.id, { name: "Alpha second admin", role: "admin", createdAt: new Date("2026-06-01"), lastLoginAt: new Date("2026-08-20") });
    const betaAdmin = await createStaff(beta.id, { name: "Beta admin", role: "admin", createdAt: new Date("2026-06-01"), lastLoginAt: new Date("2026-08-20") });
    await createStaff(alpha.id, { name: "Alpha stale", createdAt: new Date("2026-06-01"), lastLoginAt: new Date("2026-07-01") });
    await createStaff(alpha.id, { name: "Alpha boundary", createdAt: new Date("2026-06-01"), lastLoginAt: cutoff });
    await createStaff(alpha.id, { name: "Alpha never", createdAt: new Date("2026-06-01") });
    await createStaff(alpha.id, { name: "Alpha recent", createdAt: new Date("2026-06-01"), lastLoginAt: new Date("2026-07-26") });
    await createStaff(alpha.id, { name: "Alpha new", createdAt: new Date("2026-08-20") });
    await createStaff(alpha.id, { name: "Alpha inactive", createdAt: new Date("2026-06-01"), active: false, lastLoginAt: new Date("2026-07-01") });
    await createStaff(beta.id, { name: "Beta stale", createdAt: new Date("2026-06-01"), lastLoginAt: new Date("2026-07-01") });

    await expect(runStaffInactivityDigest(NOW)).resolves.toBe(2);

    expect(mockSendStaffInactivityDigestEmail).toHaveBeenCalledTimes(2);
    expect(mockSendStaffInactivityDigestEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: [alphaAdmin.email, alphaSecondAdmin.email],
      companyName: alpha.name,
      staffPageUrl: "https://portal.example.com/staff",
      inactiveUsers: expect.arrayContaining([
        expect.objectContaining({ name: "Alpha stale" }),
        expect.objectContaining({ name: "Alpha boundary" }),
        expect.objectContaining({ name: "Alpha never", lastActiveAt: null }),
      ]),
      settings: SMTP_SETTINGS,
    }));
    expect(mockSendStaffInactivityDigestEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: [betaAdmin.email],
      companyName: beta.name,
      inactiveUsers: [expect.objectContaining({ name: "Beta stale" })],
    }));

    const alphaCall = mockSendStaffInactivityDigestEmail.mock.calls.find(
      ([options]) => Array.isArray(options.to) && options.to.includes(alphaAdmin.email),
    )![0];
    expect(alphaCall.inactiveUsers.map((user: { name: string }) => user.name)).not.toContain("Beta stale");
    expect(alphaCall.inactiveUsers.map((user: { name: string }) => user.name)).not.toContain("Alpha recent");
    expect(alphaCall.inactiveUsers.map((user: { name: string }) => user.name)).not.toContain("Alpha new");
    expect(alphaCall.inactiveUsers.map((user: { name: string }) => user.name)).not.toContain("Alpha inactive");

    mockSendStaffInactivityDigestEmail.mockClear();
    await expect(runStaffInactivityDigest(NOW)).resolves.toBe(0);
    expect(mockSendStaffInactivityDigestEmail).not.toHaveBeenCalled();

    const rows = await db
      .select({ status: staffInactivityDigestLogTable.status })
      .from(staffInactivityDigestLogTable)
      .where(inArray(staffInactivityDigestLogTable.companyId, [alpha.id, beta.id]));
    expect(rows).toEqual([{ status: "sent" }, { status: "sent" }]);
  });

  it("records a failure as retryable and delivers it on the next check", async () => {
    const company = await createCompany("Retry Networks");
    await createStaff(company.id, { name: "Retry admin", role: "admin", createdAt: new Date("2026-06-01"), lastLoginAt: new Date("2026-08-20") });
    await createStaff(company.id, { name: "Needs retry", createdAt: new Date("2026-06-01"), lastLoginAt: new Date("2026-07-01") });
    mockSendStaffInactivityDigestEmail
      .mockResolvedValueOnce({ success: false, message: "SMTP timeout" })
      .mockResolvedValueOnce({ success: true, message: "Staff inactivity digest sent" });

    await expect(runStaffInactivityDigest(NOW)).resolves.toBe(0);
    await expect(runStaffInactivityDigest(NOW)).resolves.toBe(1);

    expect(mockSendStaffInactivityDigestEmail).toHaveBeenCalledTimes(2);
    const [row] = await db
      .select({ status: staffInactivityDigestLogTable.status, error: staffInactivityDigestLogTable.error })
      .from(staffInactivityDigestLogTable)
      .where(eq(staffInactivityDigestLogTable.companyId, company.id));
    expect(row).toEqual({ status: "sent", error: null });
  });
});