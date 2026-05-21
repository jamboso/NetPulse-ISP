import { Router } from "express";
import { db } from "@workspace/db";
import { subscriptionsTable, customersTable, plansTable, routersTable, invoicesTable, paymentsTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { requireRole } from "../middlewares/requireRole";
import { writeAuditLog } from "../lib/audit";

const router = Router();

// ── RouterOS helper ───────────────────────────────────────────────────────────

async function rosReq(
  ip: string, ssl: boolean, user: string, pass: string,
  method: "GET" | "PUT" | "PATCH" | "DELETE",
  path: string, body?: object
): Promise<unknown> {
  const scheme = ssl ? "https" : "http";
  const url = `${scheme}://${ip}/rest${path}`;
  const creds = Buffer.from(`${user}:${pass}`).toString("base64");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Basic ${creds}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`RouterOS HTTP ${res.status}: ${t}`);
    }
    const text = await res.text();
    return text.trim() ? JSON.parse(text) : null;
  } catch (err: any) {
    clearTimeout(timer);
    if (err.name === "AbortError") throw new Error(`Timeout connecting to ${ip}`);
    throw err;
  }
}

/** Generate a clean PPPoE username from a customer name + id */
function genUsername(name: string, customerId: number): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 20) + "." + customerId;
}

/** 10-character random alphanumeric password */
function genPassword(): string {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
  return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

/** Find a PPPoE secret's .id by username */
async function findSecretId(ip: string, ssl: boolean, user: string, pass: string, username: string): Promise<string | null> {
  try {
    const list = await rosReq(ip, ssl, user, pass, "GET", `/ppp/secret?name=${encodeURIComponent(username)}`);
    if (Array.isArray(list) && list.length > 0) return (list[0] as Record<string, string>)[".id"] ?? null;
  } catch {}
  return null;
}

/**
 * Provision PPPoE secret on RouterOS. Returns { username, password } or null on failure.
 * Best-effort — never throws.
 */
async function provisionPPPoE(
  routerId: number,
  username: string,
  password: string,
  profileName: string,
  comment: string,
  reqLog?: { info: (...a: any[]) => void; error: (...a: any[]) => void }
): Promise<boolean> {
  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, routerId));
  if (!r || r.routerType !== "routeros") return false;
  try {
    await rosReq(r.ipAddress, r.apiSsl ?? false, r.username, r.password, "PUT", "/ppp/secret", {
      name: username,
      password,
      service: "pppoe",
      profile: profileName || "default",
      comment,
      disabled: "no",
    });
    reqLog?.info({ username, routerId }, "PPPoE secret provisioned on RouterOS");
    return true;
  } catch (e: any) {
    reqLog?.error({ err: e.message, username, routerId }, "Failed to provision PPPoE secret");
    return false;
  }
}

/**
 * Disable PPPoE secret on RouterOS (subscription suspended).
 */
async function disablePPPoESecret(routerId: number, username: string, reqLog?: any): Promise<void> {
  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, routerId));
  if (!r) return;
  try {
    const id = await findSecretId(r.ipAddress, r.apiSsl ?? false, r.username, r.password, username);
    if (id) {
      await rosReq(r.ipAddress, r.apiSsl ?? false, r.username, r.password, "PATCH", `/ppp/secret/${id}`, { disabled: "yes" });
      reqLog?.info({ username, routerId }, "PPPoE secret disabled on RouterOS");
    }
  } catch (e: any) {
    reqLog?.error({ err: e.message, username }, "Failed to disable PPPoE secret");
  }
}

/**
 * Enable PPPoE secret on RouterOS (subscription re-activated).
 */
async function enablePPPoESecret(routerId: number, username: string, reqLog?: any): Promise<void> {
  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, routerId));
  if (!r) return;
  try {
    const id = await findSecretId(r.ipAddress, r.apiSsl ?? false, r.username, r.password, username);
    if (id) {
      await rosReq(r.ipAddress, r.apiSsl ?? false, r.username, r.password, "PATCH", `/ppp/secret/${id}`, { disabled: "no" });
      reqLog?.info({ username, routerId }, "PPPoE secret re-enabled on RouterOS");
    }
  } catch (e: any) {
    reqLog?.error({ err: e.message, username }, "Failed to enable PPPoE secret");
  }
}

/**
 * Delete PPPoE secret from RouterOS (subscription cancelled/deleted).
 */
async function deletePPPoESecret(routerId: number, username: string, reqLog?: any): Promise<void> {
  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, routerId));
  if (!r) return;
  try {
    const id = await findSecretId(r.ipAddress, r.apiSsl ?? false, r.username, r.password, username);
    if (id) {
      await rosReq(r.ipAddress, r.apiSsl ?? false, r.username, r.password, "DELETE", `/ppp/secret/${id}`);
      reqLog?.info({ username, routerId }, "PPPoE secret deleted from RouterOS");
    }
  } catch (e: any) {
    reqLog?.error({ err: e.message, username }, "Failed to delete PPPoE secret");
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatSub(
  s: typeof subscriptionsTable.$inferSelect,
  customer?: typeof customersTable.$inferSelect | null,
  plan?: typeof plansTable.$inferSelect | null
) {
  return {
    ...s,
    customer: customer ?? null,
    plan: plan ? { ...plan, price: Number(plan.price) } : null,
  };
}

// ── Routes ────────────────────────────────────────────────────────────────────

router.get("/subscriptions", async (req, res) => {
  const { customerId, status } = req.query as Record<string, string>;

  const conditions = [];
  if (customerId) conditions.push(eq(subscriptionsTable.customerId, parseInt(customerId)));
  if (status) conditions.push(eq(subscriptionsTable.status, status));

  const base = db
    .select()
    .from(subscriptionsTable)
    .leftJoin(customersTable, eq(subscriptionsTable.customerId, customersTable.id))
    .leftJoin(plansTable, eq(subscriptionsTable.planId, plansTable.id));

  const rows = await (conditions.length === 0
    ? base.orderBy(subscriptionsTable.createdAt)
    : conditions.length === 1
      ? base.where(conditions[0]!).orderBy(subscriptionsTable.createdAt)
      : base.where(and(...conditions)).orderBy(subscriptionsTable.createdAt));

  res.json(rows.map(r => formatSub(r.subscriptions, r.customers, r.plans)));
});

router.post("/subscriptions", requireRole("admin", "billing"), async (req, res) => {
  const body = req.body as {
    customerId: number; planId: number; routerId?: number;
    status?: string; startDate: string; endDate?: string;
    ipAddress?: string; macAddress?: string;
  };

  // Get customer + plan for PPPoE provisioning
  const [[customer], [plan]] = await Promise.all([
    db.select().from(customersTable).where(eq(customersTable.id, body.customerId)),
    db.select().from(plansTable).where(eq(plansTable.id, body.planId)),
  ]);

  const status = body.status ?? "active";
  const shouldProvision = status === "active" && body.routerId != null && customer;

  // Auto-generate credentials if we'll provision
  const pppoeUsername = shouldProvision ? genUsername(customer!.name, body.customerId) : null;
  const pppoePassword = shouldProvision ? genPassword() : null;

  const [sub] = await db.insert(subscriptionsTable).values({
    customerId: body.customerId,
    planId: body.planId,
    routerId: body.routerId ?? null,
    status,
    startDate: body.startDate,
    endDate: body.endDate ?? null,
    ipAddress: body.ipAddress ?? null,
    macAddress: body.macAddress ?? null,
    pppoeUsername,
    pppoePassword,
  }).returning();

  // Provision on RouterOS (best-effort, non-blocking response)
  if (shouldProvision && pppoeUsername && pppoePassword) {
    provisionPPPoE(
      body.routerId!,
      pppoeUsername,
      pppoePassword,
      plan?.rosProfileName ?? "default",
      `Sub #${sub!.id} | ${customer!.name} | ${plan?.name ?? ""}`,
      req.log
    );
  }

  void writeAuditLog({
    userId:     req.user!.id,
    userEmail:  req.user!.email,
    action:     "create",
    entityType: "subscription",
    entityId:   sub!.id,
    diff:       { after: sub },
  });

  res.status(201).json(sub);
});

router.get("/subscriptions/:id", async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const [row] = await db
    .select()
    .from(subscriptionsTable)
    .leftJoin(customersTable, eq(subscriptionsTable.customerId, customersTable.id))
    .leftJoin(plansTable, eq(subscriptionsTable.planId, plansTable.id))
    .where(eq(subscriptionsTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatSub(row.subscriptions, row.customers, row.plans));
});

router.patch("/subscriptions/:id", requireRole("admin", "billing"), async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const body = req.body as {
    planId?: number; routerId?: number | null; status?: string;
    endDate?: string | null; ipAddress?: string | null; macAddress?: string | null;
  };

  // Load current subscription
  const [existing] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const update: Record<string, unknown> = {};
  if (body.planId !== undefined) update.planId = body.planId;
  if (body.routerId !== undefined) update.routerId = body.routerId;
  if (body.status !== undefined) update.status = body.status;
  if (body.endDate !== undefined) update.endDate = body.endDate;
  if (body.ipAddress !== undefined) update.ipAddress = body.ipAddress;
  if (body.macAddress !== undefined) update.macAddress = body.macAddress;

  const prevStatus = existing.status;
  const newStatus = body.status;
  const effectiveRouterId = body.routerId ?? existing.routerId;

  // Handle status transitions that affect RouterOS
  if (newStatus && newStatus !== prevStatus && effectiveRouterId) {
    const username = existing.pppoeUsername;

    if (newStatus === "active") {
      if (username) {
        // Re-enable existing secret
        enablePPPoESecret(effectiveRouterId, username, req.log);
      } else {
        // No credentials yet — generate and provision now
        const [[customer], [plan]] = await Promise.all([
          db.select().from(customersTable).where(eq(customersTable.id, existing.customerId)),
          db.select().from(plansTable).where(eq(plansTable.id, existing.planId)),
        ]);
        if (customer) {
          const pppoeUsername = genUsername(customer.name, existing.customerId);
          const pppoePassword = genPassword();
          update.pppoeUsername = pppoeUsername;
          update.pppoePassword = pppoePassword;
          provisionPPPoE(
            effectiveRouterId,
            pppoeUsername,
            pppoePassword,
            plan?.rosProfileName ?? "default",
            `Sub #${id} | ${customer.name} | ${plan?.name ?? ""}`,
            req.log
          );
        }
      }
    } else if (newStatus === "suspended" && username) {
      disablePPPoESecret(effectiveRouterId, username, req.log);
    } else if (newStatus === "cancelled" && username) {
      deletePPPoESecret(effectiveRouterId, username, req.log);
      update.pppoeUsername = null;
      update.pppoePassword = null;
    }
  }

  const [updated] = await db.update(subscriptionsTable).set(update).where(eq(subscriptionsTable.id, id)).returning();

  void writeAuditLog({
    userId:     req.user!.id,
    userEmail:  req.user!.email,
    action:     "update",
    entityType: "subscription",
    entityId:   id,
    diff:       { before: existing, after: updated },
  });

  res.json(updated);
});

router.delete("/subscriptions/:id", requireRole("admin"), async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const [existing] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.id, id));

  if (!existing) { res.status(404).json({ error: "Subscription not found" }); return; }

  if (existing.pppoeUsername && existing.routerId) {
    deletePPPoESecret(existing.routerId, existing.pppoeUsername, req.log);
  }

  // Cascade: delete payments → invoices → subscription
  const invoices = await db.select({ id: invoicesTable.id }).from(invoicesTable).where(eq(invoicesTable.subscriptionId, id));
  if (invoices.length > 0) {
    const invoiceIds = invoices.map(i => i.id);
    await db.delete(paymentsTable).where(inArray(paymentsTable.invoiceId, invoiceIds));
    await db.delete(invoicesTable).where(inArray(invoicesTable.id, invoiceIds));
  }

  await db.delete(subscriptionsTable).where(eq(subscriptionsTable.id, id));

  void writeAuditLog({
    userId:     req.user!.id,
    userEmail:  req.user!.email,
    action:     "delete",
    entityType: "subscription",
    entityId:   id,
    diff:       { before: existing },
  });

  res.status(204).send();
});

export default router;
