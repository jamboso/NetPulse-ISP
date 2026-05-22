import { db } from "@workspace/db";
import {
  radcheckTable, radreplyTable, radusergroupTable,
  radgroupreplyTable, radnasTable,
  subscriptionsTable, customersTable, plansTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "./logger";

export function planGroupName(planId: number): string {
  return `np-plan-${planId}`;
}

export function rateLimitValue(downloadMbps: number, uploadMbps: number): string {
  return `${downloadMbps}M/${uploadMbps}M`;
}

export function wispBwDown(downloadMbps: number): number {
  return downloadMbps * 1_000_000;
}

export function wispBwUp(uploadMbps: number): number {
  return uploadMbps * 1_000_000;
}

async function upsertGroupReplyAttr(
  groupname: string, attribute: string, op: string, value: string
): Promise<void> {
  const [existing] = await db
    .select({ id: radgroupreplyTable.id })
    .from(radgroupreplyTable)
    .where(and(
      eq(radgroupreplyTable.groupname, groupname),
      eq(radgroupreplyTable.attribute, attribute),
    ));
  if (existing) {
    await db.update(radgroupreplyTable)
      .set({ op, value })
      .where(eq(radgroupreplyTable.id, existing.id));
  } else {
    await db.insert(radgroupreplyTable).values({ groupname, attribute, op, value });
  }
}

export async function syncPlanRadiusGroup(plan: {
  id: number; downloadSpeed: number; uploadSpeed: number;
}): Promise<void> {
  try {
    const group = planGroupName(plan.id);
    const rateLimit = rateLimitValue(plan.downloadSpeed, plan.uploadSpeed);
    await upsertGroupReplyAttr(group, "Mikrotik-Rate-Limit", ":=", rateLimit);
    await upsertGroupReplyAttr(group, "WISPr-Bandwidth-Max-Down", ":=", String(wispBwDown(plan.downloadSpeed)));
    await upsertGroupReplyAttr(group, "WISPr-Bandwidth-Max-Up",   ":=", String(wispBwUp(plan.uploadSpeed)));
  } catch (err) {
    logger.error({ err, planId: plan.id }, "radiusSync: failed to sync plan group");
  }
}

export async function syncSubscriptionCreate(params: {
  username: string;
  password: string;
  planId: number;
}): Promise<void> {
  const { username, password, planId } = params;
  try {
    const [existing] = await db.select({ id: radcheckTable.id })
      .from(radcheckTable)
      .where(and(
        eq(radcheckTable.username, username),
        eq(radcheckTable.attribute, "Cleartext-Password"),
      ));
    if (existing) {
      await db.update(radcheckTable).set({ value: password })
        .where(eq(radcheckTable.id, existing.id));
    } else {
      await db.insert(radcheckTable).values({
        username, attribute: "Cleartext-Password", op: ":=", value: password,
      });
    }

    await removeRejectCheck(username);

    const group = planGroupName(planId);
    const [ugExisting] = await db.select({ id: radusergroupTable.id })
      .from(radusergroupTable)
      .where(and(
        eq(radusergroupTable.username, username),
        eq(radusergroupTable.groupname, group),
      ));
    if (!ugExisting) {
      await db.insert(radusergroupTable).values({ username, groupname: group, priority: 0 });
    }
  } catch (err) {
    logger.error({ err, username }, "radiusSync: failed to sync subscription create");
  }
}

async function removeRejectCheck(username: string): Promise<void> {
  await db.delete(radcheckTable).where(and(
    eq(radcheckTable.username, username),
    eq(radcheckTable.attribute, "Auth-Type"),
    eq(radcheckTable.value, "Reject"),
  ));
}

export async function syncSubscriptionSuspend(username: string): Promise<void> {
  try {
    const [existing] = await db.select({ id: radcheckTable.id })
      .from(radcheckTable)
      .where(and(
        eq(radcheckTable.username, username),
        eq(radcheckTable.attribute, "Auth-Type"),
      ));
    if (!existing) {
      await db.insert(radcheckTable).values({
        username, attribute: "Auth-Type", op: ":=", value: "Reject",
      });
    }
  } catch (err) {
    logger.error({ err, username }, "radiusSync: failed to suspend user");
  }
}

export async function syncSubscriptionReactivate(username: string): Promise<void> {
  try {
    await removeRejectCheck(username);
  } catch (err) {
    logger.error({ err, username }, "radiusSync: failed to reactivate user");
  }
}

export async function syncSubscriptionCancel(username: string): Promise<void> {
  try {
    await db.delete(radcheckTable).where(eq(radcheckTable.username, username));
    await db.delete(radreplyTable).where(eq(radreplyTable.username, username));
    await db.delete(radusergroupTable).where(eq(radusergroupTable.username, username));
  } catch (err) {
    logger.error({ err, username }, "radiusSync: failed to cancel user");
  }
}

export async function upsertRadnas(router: {
  ipAddress: string;
  name: string;
  radiusSecret: string;
  radiusPort?: number | null;
}): Promise<void> {
  try {
    const [existing] = await db.select({ id: radnasTable.id })
      .from(radnasTable)
      .where(eq(radnasTable.nasname, router.ipAddress));
    if (existing) {
      await db.update(radnasTable).set({
        shortname:   router.name,
        secret:      router.radiusSecret,
        description: `Managed by NetPulse (port ${router.radiusPort ?? 1812})`,
      }).where(eq(radnasTable.id, existing.id));
    } else {
      await db.insert(radnasTable).values({
        nasname:     router.ipAddress,
        shortname:   router.name,
        type:        "other",
        secret:      router.radiusSecret,
        description: `Managed by NetPulse (port ${router.radiusPort ?? 1812})`,
      });
    }
  } catch (err) {
    logger.error({ err, nasname: router.ipAddress }, "radiusSync: failed to upsert radnas");
  }
}

export async function removeRadnas(ipAddress: string): Promise<void> {
  try {
    await db.delete(radnasTable).where(eq(radnasTable.nasname, ipAddress));
  } catch (err) {
    logger.error({ err, nasname: ipAddress }, "radiusSync: failed to remove radnas");
  }
}

export async function syncAllSubscriptions(): Promise<{ synced: number; skipped: number }> {
  let synced = 0;
  let skipped = 0;

  const rows = await db
    .select()
    .from(subscriptionsTable)
    .leftJoin(customersTable, eq(subscriptionsTable.customerId, customersTable.id))
    .leftJoin(plansTable, eq(subscriptionsTable.planId, plansTable.id));

  for (const row of rows) {
    const sub  = row.subscriptions;
    const plan = row.plans;

    if (!sub.pppoeUsername || !sub.pppoePassword) { skipped++; continue; }

    if (sub.status === "active") {
      await syncSubscriptionCreate({
        username: sub.pppoeUsername,
        password: sub.pppoePassword,
        planId:   sub.planId,
      });
      if (plan) await syncPlanRadiusGroup(plan);
      synced++;
    } else if (sub.status === "suspended") {
      await syncSubscriptionSuspend(sub.pppoeUsername);
      synced++;
    } else if (sub.status === "cancelled") {
      await syncSubscriptionCancel(sub.pppoeUsername);
      synced++;
    } else {
      skipped++;
    }
  }

  return { synced, skipped };
}
