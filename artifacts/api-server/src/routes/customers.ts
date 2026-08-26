import { Router } from "express";
import { db } from "@workspace/db";
import { customersTable, subscriptionsTable, invoicesTable, paymentsTable, ticketsTable, ticketRepliesTable, radcheckTable, routersTable, hotspotVouchersTable } from "@workspace/db";
import { eq, ilike, or, sql, inArray, and } from "drizzle-orm";
import { z } from "zod/v4";
import { requireRole } from "../middlewares/requireRole";
import { validateBody } from "../middlewares/validateBody";
import { resolveCompanyScope } from "../middlewares/companyScope";
import { writeAuditLog } from "../lib/audit";
import { getSettings, sendSms } from "../lib/sms.js";
import { removeRadnas } from "../lib/radiusSync";

const CUSTOMER_STATUSES = ["active", "inactive", "suspended"] as const;

const createCustomerSchema = z.object({
  name:          z.string().min(1),
  email:         z.string().email(),
  phone:         z.string().min(1),
  address:       z.string().min(1),
  status:        z.enum(CUSTOMER_STATUSES).optional(),
  notes:         z.string().optional().nullable(),
  latitude:      z.number().optional().nullable(),
  longitude:     z.number().optional().nullable(),
  pppoeUsername: z.string().optional().nullable(),
  pppoePassword: z.string().optional().nullable(),
});

const updateCustomerSchema = createCustomerSchema.partial();

async function upsertRadcheck(username: string, password: string): Promise<void> {
  const [existing] = await db.select({ id: radcheckTable.id })
    .from(radcheckTable)
    .where(and(eq(radcheckTable.username, username), eq(radcheckTable.attribute, "Cleartext-Password")));
  if (existing) {
    await db.update(radcheckTable).set({ value: password }).where(eq(radcheckTable.id, existing.id));
  } else {
    await db.insert(radcheckTable).values({ username, attribute: "Cleartext-Password", op: ":=", value: password });
  }
}

const router = Router();
router.use(resolveCompanyScope);

router.get("/customers", async (req, res) => {
  const { search, status, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  let query = db.select().from(customersTable).$dynamic();
  let countQuery = db.select({ count: sql<number>`count(*)` }).from(customersTable).$dynamic();

  const conditions = [];
  if (req.companyId != null) conditions.push(eq(customersTable.companyId, req.companyId));
  if (search) {
    conditions.push(or(
      ilike(customersTable.name, `%${search}%`),
      ilike(customersTable.email, `%${search}%`),
      ilike(customersTable.phone, `%${search}%`),
      ilike(customersTable.pppoeUsername, `%${search}%`),
    ));
  }
  if (status) conditions.push(eq(customersTable.status, status));

  if (conditions.length > 0) {
    const cond = and(...conditions)!;
    query = query.where(cond);
    countQuery = countQuery.where(cond);
  }

  const [data, countResult] = await Promise.all([
    query.orderBy(customersTable.createdAt).limit(limitNum).offset(offset),
    countQuery,
  ]);

  res.json({ data, total: Number(countResult[0]?.count ?? 0), page: pageNum, limit: limitNum });
});

router.post("/customers", requireRole("admin", "billing", "support"), validateBody(createCustomerSchema), async (req, res) => {
  const body = req.body;
  const [customer] = await db.insert(customersTable).values({
    companyId:     req.companyId!,
    name:          body.name,
    email:         body.email,
    phone:         body.phone,
    address:       body.address,
    status:        body.status ?? "active",
    notes:         body.notes ?? null,
    latitude:      body.latitude  != null ? Number(body.latitude)  : null,
    longitude:     body.longitude != null ? Number(body.longitude) : null,
    pppoeUsername: body.pppoeUsername ?? null,
    pppoePassword: body.pppoePassword ?? null,
  }).returning();

  if (body.pppoeUsername && body.pppoePassword) {
    void upsertRadcheck(body.pppoeUsername, body.pppoePassword);
  }

  void writeAuditLog({
    companyId:  req.companyId,
    userId:     req.user!.id,
    userEmail:  req.user!.email,
    action:     "create",
    entityType: "customer",
    entityId:   customer!.id,
    diff:       { after: customer },
  });

  res.status(201).json(customer);
});

function scopedCustomerWhere(req: import("express").Request, id: number) {
  return req.companyId != null
    ? and(eq(customersTable.id, id), eq(customersTable.companyId, req.companyId))
    : eq(customersTable.id, id);
}

router.get("/customers/:id", async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const [customer] = await db.select().from(customersTable).where(scopedCustomerWhere(req, id));
  if (!customer) { res.status(404).json({ error: "Not found" }); return; }
  res.json(customer);
});

router.patch("/customers/:id", requireRole("admin", "billing", "support"), validateBody(updateCustomerSchema), async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const body = req.body;

  const [before] = await db.select().from(customersTable).where(scopedCustomerWhere(req, id));
  if (!before) { res.status(404).json({ error: "Not found" }); return; }

  const update: Record<string, unknown> = {};
  if (body.name      !== undefined) update.name      = body.name;
  if (body.email     !== undefined) update.email     = body.email;
  if (body.phone     !== undefined) update.phone     = body.phone;
  if (body.address   !== undefined) update.address   = body.address;
  if (body.status    !== undefined) update.status    = body.status;
  if (body.notes     !== undefined) update.notes     = body.notes;
  if (body.latitude     !== undefined) update.latitude     = body.latitude  != null ? Number(body.latitude)  : null;
  if (body.longitude    !== undefined) update.longitude    = body.longitude != null ? Number(body.longitude) : null;
  if (body.pppoeUsername !== undefined) update.pppoeUsername = body.pppoeUsername ?? null;
  if (body.pppoePassword !== undefined) update.pppoePassword = body.pppoePassword ?? null;

  const [updated] = await db.update(customersTable).set(update).where(scopedCustomerWhere(req, id)).returning();

  if (body.pppoeUsername && body.pppoePassword) {
    void upsertRadcheck(body.pppoeUsername, body.pppoePassword);
  }
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  void writeAuditLog({
    companyId:  req.companyId,
    userId:     req.user!.id,
    userEmail:  req.user!.email,
    action:     "update",
    entityType: "customer",
    entityId:   id,
    diff:       { before, after: updated },
  });

  res.json(updated);
});

/*
 * POST /api/customers/:id/remind-technician
 * Sends an SMS reminder to a technician about a customer with intermittent service.
 * Body: { phone: string, message: string }
 * Requires auth — admin or support.
 */
router.post("/customers/:id/remind-technician", requireRole("admin", "support"), async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const { phone, message } = req.body as { phone?: string; message?: string };

  if (!phone || !message) {
    res.status(400).json({ error: "phone and message are required" });
    return;
  }

  const [customer] = await db.select().from(customersTable).where(scopedCustomerWhere(req, id));
  if (!customer) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }

  try {
    const s = await getSettings();
    const result = await sendSms(s, phone, message);
    if (!result.success) {
      res.status(502).json({ error: "SMS failed to send", detail: result.message });
      return;
    }
    req.log.info({ customerId: id, techPhone: phone }, "Technician reminder sent");
    res.json({ success: true, message: result.message });
  } catch (err) {
    req.log.error({ err }, "Failed to send technician reminder");
    res.status(500).json({ error: "Failed to send reminder" });
  }
});

router.delete("/customers/:id", requireRole("admin"), async (req, res) => {
  const id = parseInt(req.params["id"] as string);

  const [before] = await db.select().from(customersTable).where(scopedCustomerWhere(req, id));
  if (!before) { res.status(404).json({ error: "Not found" }); return; }

  // The full cascade runs in one transaction: if any step fails (e.g. an
  // unexpected FK constraint), the whole deletion rolls back instead of
  // leaving the customer's records partially deleted.
  const assignedRouters = await db.transaction(async (tx) => {
    // Cascade: ticket_replies → tickets → payments → invoices → subscriptions → customer
    const tickets = await tx.select({ id: ticketsTable.id }).from(ticketsTable).where(eq(ticketsTable.customerId, id));
    if (tickets.length > 0) {
      const ticketIds = tickets.map(t => t.id);
      await tx.delete(ticketRepliesTable).where(inArray(ticketRepliesTable.ticketId, ticketIds));
      await tx.delete(ticketsTable).where(inArray(ticketsTable.id, ticketIds));
    }

    const invoices = await tx.select({ id: invoicesTable.id }).from(invoicesTable).where(eq(invoicesTable.customerId, id));
    if (invoices.length > 0) {
      const invoiceIds = invoices.map(i => i.id);
      await tx.delete(paymentsTable).where(inArray(paymentsTable.invoiceId, invoiceIds));
      await tx.delete(invoicesTable).where(inArray(invoicesTable.id, invoiceIds));
    }

    await tx.delete(subscriptionsTable).where(eq(subscriptionsTable.customerId, id));

    // Routers explicitly assigned to this customer are removed with them.
    // Unassigned/company-level routers are never touched here — only rows
    // whose customerId points at this exact customer.
    const routers = await tx.select({ id: routersTable.id, ipAddress: routersTable.ipAddress, radiusSecret: routersTable.radiusSecret })
      .from(routersTable).where(eq(routersTable.customerId, id));
    if (routers.length > 0) {
      const routerIds = routers.map(r => r.id);
      // hotspot_vouchers.router_id has no cascading FK action, so it must be
      // cleared explicitly before the router row can be deleted.
      await tx.delete(hotspotVouchersTable).where(inArray(hotspotVouchersTable.routerId, routerIds));
      await tx.delete(routersTable).where(eq(routersTable.customerId, id));
    }

    await tx.delete(customersTable).where(scopedCustomerWhere(req, id));

    return routers;
  });

  for (const r of assignedRouters) {
    if (r.radiusSecret) void removeRadnas(r.ipAddress);
  }

  void writeAuditLog({
    companyId:  req.companyId,
    userId:     req.user!.id,
    userEmail:  req.user!.email,
    action:     "delete",
    entityType: "customer",
    entityId:   id,
    diff:       { before },
  });

  res.status(204).send();
});

export default router;
