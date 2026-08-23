import { and, eq, lt, sql } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";

const DEFAULT_MAX_ATTEMPTS = 5;
const MAX_CONFIGURED_ATTEMPTS = 100;
const DEFAULT_LOCKOUT_MINUTES = 15;
const MAX_LOCKOUT_MINUTES = 24 * 60;

export const TOO_MANY_PASSWORD_ATTEMPTS_MESSAGE =
  "Too many incorrect password attempts. Your account is temporarily locked. Please try again later.";

/**
 * Reads the account lockout threshold at request time. The legacy variable is
 * retained so existing deployments can keep their current configuration.
 */
export function getPasswordLockoutMaxAttempts(
  value = process.env["PASSWORD_LOCKOUT_MAX_ATTEMPTS"]
    ?? process.env["PASSWORD_CHANGE_MAX_ATTEMPTS"],
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_CONFIGURED_ATTEMPTS
    ? parsed
    : DEFAULT_MAX_ATTEMPTS;
}

export function getPasswordLockoutDurationMs(
  value = process.env["PASSWORD_LOCKOUT_MINUTES"],
): number {
  const parsed = Number(value);
  const minutes = Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_LOCKOUT_MINUTES
    ? parsed
    : DEFAULT_LOCKOUT_MINUTES;
  return minutes * 60 * 1000;
}

function getErrorCode(result: unknown): unknown {
  if (typeof result !== "object" || result === null) return undefined;
  const error = result as { code?: unknown; body?: { code?: unknown } };
  return error.code ?? error.body?.code;
}

export function isInvalidPasswordError(result: unknown): boolean {
  return getErrorCode(result) === "INVALID_PASSWORD";
}

export function isInvalidSignInError(result: unknown): boolean {
  return getErrorCode(result) === "INVALID_EMAIL_OR_PASSWORD";
}

export function isSuccessfulPasswordResponse(result: unknown): boolean {
  return typeof result === "object"
    && result !== null
    && "token" in result
    && "user" in result;
}

export async function findPasswordLockoutUser(email: string): Promise<{ id: string } | null> {
  const [user] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email));
  return user ?? null;
}

export async function isPasswordLocked(userId: string): Promise<boolean> {
  const [user] = await db
    .select({ lockedAt: usersTable.passwordLockedAt })
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  if (!user?.lockedAt) return false;

  const lockoutDurationMs = getPasswordLockoutDurationMs();
  const lockExpiresAt = new Date(user.lockedAt.getTime() + lockoutDurationMs);
  if (lockExpiresAt > new Date()) return true;

  // Only clear a lock that was already expired. This condition prevents a
  // stale request from clearing a newer concurrent lock.
  await db
    .update(usersTable)
    .set({
      failedPasswordAttempts: 0,
      passwordLockedAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(usersTable.id, userId),
        lt(usersTable.passwordLockedAt, new Date(Date.now() - lockoutDurationMs)),
      ),
    );

  return false;
}

/**
 * Atomically increments the failed-attempt count. PostgreSQL evaluates the
 * lock condition from the incremented value, so concurrent requests cannot
 * lose attempts through a read/modify/write race.
 */
export async function recordFailedPasswordAttempt(
  userId: string,
  maxAttempts = getPasswordLockoutMaxAttempts(),
): Promise<number | null> {
  const [updated] = await db
    .update(usersTable)
    .set({
      failedPasswordAttempts: sql`${usersTable.failedPasswordAttempts} + 1`,
      passwordLockedAt: sql`
        CASE
          WHEN ${usersTable.failedPasswordAttempts} + 1 >= ${maxAttempts} THEN NOW()
          ELSE ${usersTable.passwordLockedAt}
        END
      `,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(usersTable.id, userId),
        sql`${usersTable.passwordLockedAt} IS NULL`,
      ),
    )
    .returning({ attempts: usersTable.failedPasswordAttempts });

  return updated?.attempts ?? null;
}

export async function resetPasswordLockout(userId: string): Promise<void> {
  await db
    .update(usersTable)
    .set({
      failedPasswordAttempts: 0,
      passwordLockedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(usersTable.id, userId));
}