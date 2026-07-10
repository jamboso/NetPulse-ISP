import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod/v4";
import type { BetterAuthPlugin } from "better-auth";
import { logger } from "./logger";

/**
 * Minimal "login as" plugin for owner-only impersonation of SaaS client
 * accounts (used from the admin Companies dashboard to debug stuck accounts).
 *
 * Deliberately hand-rolled instead of using better-auth's official `admin`
 * plugin: that plugin requires extra schema columns (banned/banReason/
 * banExpires on users, impersonatedBy on sessions) and a parallel
 * role/permission system that would conflict with this app's existing
 * owner/admin/billing/support/technician roles. This plugin reuses the
 * app's own `requireRole` semantics and only adds the one endpoint we need.
 */
export const impersonatePlugin = () => {
  return {
    id: "impersonate",
    endpoints: {
      impersonateUser: createAuthEndpoint(
        "/impersonate-user",
        {
          method: "POST",
          body: z.object({ userId: z.string() }),
          use: [sessionMiddleware],
        },
        async (ctx) => {
          const caller = ctx.context.session.user as { id: string; role?: string };
          if (caller.role !== "owner") {
            throw new APIError("FORBIDDEN", { message: "Only owners can impersonate other accounts" });
          }

          const targetUser = await ctx.context.internalAdapter.findUserById(ctx.body.userId);
          if (!targetUser) {
            throw new APIError("NOT_FOUND", { message: "Target user not found" });
          }

          const newSession = await ctx.context.internalAdapter.createSession(targetUser.id, false);
          if (!newSession) {
            throw new APIError("INTERNAL_SERVER_ERROR", { message: "Failed to create impersonation session" });
          }

          logger.info(
            { ownerUserId: caller.id, targetUserId: targetUser.id },
            "owner impersonated user account",
          );

          await setSessionCookie(ctx, { session: newSession, user: targetUser });
          return ctx.json({ user: targetUser });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
};
