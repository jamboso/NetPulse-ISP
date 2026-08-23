import { and, eq, sql } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";

const DEFAULT_MAX_ATTEMPTS = 5;
const MAX_CONFIGURED_ATTEMPTS = 100;

export const TOO_MANY_PASSWORD_ATTEMPTS_MESSAGE =
  "Too many incorrect password attempts. Your account has been locked. Please contact an administrator.";

/**
 * Reads the lockout threshold at request time so deployments can configure it
 * with PASSWORD_CHANGE_MAX_ATTEMPTS without a code change. Invalid values use
 * the conservative five-attempt default.
 */
export function getPasswordChangeMaxAttempts(
  value = process.env["PASSWORD_CHANGE_MAX_ATTEMPTS"],
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_CONFIGURED_ATTEMPTS
    ? parsed
    : DEFAULT_MAX_ATTEMPTS;
}

export function isInvalidPasswordError(result: unknown): boolean {
  if (typeof result !== "object" || result === null) return false;

  const error = result as {
    code?: unknown;
    body?: { code?: unknown };
  };
  // Better Auth exposes APIError's code in its body. The top-level check is
  // retained for compatibility with callers that serialize that error first.
  return error.code === "INVALID_PASSWORD" || error.body?.code === "INVALID_PASSWORD";
}

export function isSuccessfulPasswordChange(result: unknown): boolean {
  return typeof result === "object"
    && result !== null
    && "token" in result
    && "user" in result;
}

export async function isPasswordChangeLocked(userId: string): Promise<boolean> {
  const [user] = await db
    .select({ lockedAt: usersTable.passwordChangeLockedAt })
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  return user?.lockedAt != null;
}

/**
 * Atomically increments the failed-attempt count. PostgreSQL evaluates the
 * lock condition from the incremented value, so concurrent requests cannot
 * lose attempts through a read/modify/write race.
 */
export async function recordInvalidPasswordAttempt(
  userId: string,
  maxAttempts = getPasswordChangeMaxAttempts(),
): Promise<number | null> {
  const [updated] = await db
    .update(usersTable)
    .set({
      passwordChangeFailedAttempts: sql`${usersTable.passwordChangeFailedAttempts} + 1`,
      passwordChangeLockedAt: sql`
        CASE
          WHEN ${usersTable.passwordChangeFailedAttempts} + 1 >= ${maxAttempts} THEN NOW()
          ELSE ${usersTable.passwordChangeLockedAt}
        END
      `,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(usersTable.id, userId),
        sql`${usersTable.passwordChangeLockedAt} IS NULL`,
      ),
    )
    .returning({ attempts: usersTable.passwordChangeFailedAttempts });

  return updated?.attempts ?? null;
}

export async function resetPasswordChangeAttempts(userId: string): Promise<void> {
  await db
    .update(usersTable)
    .set({
      passwordChangeFailedAttempts: 0,
      passwordChangeLockedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(usersTable.id, userId));
}