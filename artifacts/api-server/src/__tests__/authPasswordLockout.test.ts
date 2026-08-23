import { beforeEach, describe, expect, it, vi } from "vitest";

const capturedConfig = vi.hoisted(() => ({ value: undefined as Record<string, unknown> | undefined }));
const mockGetSession = vi.hoisted(() => vi.fn());
const mockIsLocked = vi.hoisted(() => vi.fn());
const mockRecordFailure = vi.hoisted(() => vi.fn());
const mockResetAttempts = vi.hoisted(() => vi.fn());
const mockRadiusSync = vi.hoisted(() => vi.fn());

vi.mock("better-auth", () => ({
  betterAuth: vi.fn((config) => {
    capturedConfig.value = config;
    return { api: { getSession: mockGetSession } };
  }),
}));

vi.mock("better-auth/api", () => ({
  createAuthMiddleware: <T>(handler: T) => handler,
  APIError: {
    fromStatus: (status: string, body: { message: string }) => ({ status, ...body }),
  },
}));

vi.mock("better-auth/adapters/drizzle", () => ({
  drizzleAdapter: vi.fn(() => ({})),
}));

vi.mock("@workspace/db", () => ({
  db: {},
  usersTable: {},
  sessionsTable: {},
  accountsTable: {},
  verificationsTable: {},
}));

vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn() },
}));

vi.mock("../lib/passwordChangeLockout.js", () => ({
  getPasswordChangeMaxAttempts: vi.fn(() => 5),
  isInvalidPasswordError: (result: unknown) =>
    (result as { body?: { code?: string } } | undefined)?.body?.code === "INVALID_PASSWORD",
  isPasswordChangeLocked: mockIsLocked,
  isSuccessfulPasswordChange: (result: unknown) =>
    typeof result === "object"
    && result !== null
    && "token" in result
    && "user" in result,
  recordInvalidPasswordAttempt: mockRecordFailure,
  resetPasswordChangeAttempts: mockResetAttempts,
  TOO_MANY_PASSWORD_ATTEMPTS_MESSAGE:
    "Too many incorrect password attempts. Your account has been locked. Please contact an administrator.",
}));

vi.mock("../lib/radiusSync.js", () => ({ syncStaffUserRadius: mockRadiusSync }));
vi.mock("../lib/logger.js", () => ({ logger: { error: vi.fn() } }));
vi.mock("../lib/impersonatePlugin.js", () => ({ impersonatePlugin: vi.fn(() => ({})) }));
vi.mock("../lib/sms.js", () => ({ getSettings: vi.fn() }));

await import("../lib/auth.js");

function hooks() {
  const config = capturedConfig.value as {
    hooks: {
      before: (ctx: unknown) => Promise<void>;
      after: (ctx: unknown) => Promise<void>;
    };
  };
  return config.hooks;
}

function changePasswordContext(returned: unknown) {
  return {
    path: "/change-password",
    body: { newPassword: "NewPass123!" },
    context: {
      returned,
      session: { user: { id: "user-1", email: "staff@example.com" } },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue({ user: { id: "user-1" } });
});

describe("change-password lockout hooks", () => {
  it("blocks an account already locked by failed password attempts", async () => {
    mockIsLocked.mockResolvedValue(true);

    await expect(hooks().before({
      path: "/change-password",
      headers: new Headers(),
    })).rejects.toMatchObject({
      status: "TOO_MANY_REQUESTS",
      message: /too many incorrect password attempts/i,
    });

    expect(mockGetSession).toHaveBeenCalledOnce();
    expect(mockIsLocked).toHaveBeenCalledWith("user-1");
  });

  it("counts an invalid password without resetting the counter before the threshold", async () => {
    mockRecordFailure.mockResolvedValue(4);

    await hooks().after(changePasswordContext({ body: { code: "INVALID_PASSWORD" } }));

    expect(mockRecordFailure).toHaveBeenCalledWith("user-1", 5);
    expect(mockResetAttempts).not.toHaveBeenCalled();
    expect(mockRadiusSync).not.toHaveBeenCalled();
  });

  it("returns an HTTP 429 response on the configured threshold failure", async () => {
    mockRecordFailure.mockResolvedValue(5);

    const result = await hooks().after(
      changePasswordContext({ body: { code: "INVALID_PASSWORD" } }),
    ) as unknown as { response: Response };

    expect(result.response.status).toBe(429);
    await expect(result.response.json()).resolves.toMatchObject({
      code: "TOO_MANY_PASSWORD_ATTEMPTS",
      message: /too many incorrect password attempts/i,
    });
  });

  it("resets the consecutive-failure counter only after a successful password change", async () => {
    await hooks().after(changePasswordContext({ token: null, user: { id: "user-1" } }));

    expect(mockResetAttempts).toHaveBeenCalledWith("user-1");
    expect(mockRadiusSync).toHaveBeenCalledWith("staff@example.com", "NewPass123!");
    expect(mockRecordFailure).not.toHaveBeenCalled();
  });

  it("does not reset attempts or sync RADIUS for another Better Auth error", async () => {
    await hooks().after(changePasswordContext({ body: { code: "PASSWORD_TOO_SHORT" } }));

    expect(mockResetAttempts).not.toHaveBeenCalled();
    expect(mockRadiusSync).not.toHaveBeenCalled();
    expect(mockRecordFailure).not.toHaveBeenCalled();
  });
});