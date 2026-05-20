import { Router } from "express";
import { db } from "@workspace/db";
import {
  customersTable, subscriptionsTable, invoicesTable,
  ticketsTable, equipmentTable, ipPoolsTable, paymentsTable,
} from "@workspace/db";
import { sql, eq } from "drizzle-orm";

const router = Router();

router.get("/dashboard/summary", async (_req, res) => {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [
    customerCount,
    activeSubCount,
    overdueInvCount,
    revenueResult,
    openTicketCount,
    equipmentCount,
    ipPoolCount,
    newCustomerCount,
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(customersTable),
    db.select({ count: sql<number>`count(*)` }).from(subscriptionsTable).where(eq(subscriptionsTable.status, "active")),
    db.select({ count: sql<number>`count(*)` }).from(invoicesTable).where(eq(invoicesTable.status, "overdue")),
    db.select({ total: sql<number>`coalesce(sum(amount::numeric), 0)` }).from(invoicesTable).where(eq(invoicesTable.status, "paid")),
    db.select({ count: sql<number>`count(*)` }).from(ticketsTable).where(eq(ticketsTable.status, "open")),
    db.select({ count: sql<number>`count(*)` }).from(equipmentTable),
    db.select({ count: sql<number>`count(*)` }).from(ipPoolsTable),
    db.select({ count: sql<number>`count(*)` }).from(customersTable).where(sql`created_at >= ${monthStart}`),
  ]);

  res.setHeader("Cache-Control", "public, max-age=30");
  res.json({
    totalCustomers: Number(customerCount[0]?.count ?? 0),
    activeSubscriptions: Number(activeSubCount[0]?.count ?? 0),
    overdueInvoices: Number(overdueInvCount[0]?.count ?? 0),
    monthlyRevenue: Number(revenueResult[0]?.total ?? 0),
    openTickets: Number(openTicketCount[0]?.count ?? 0),
    totalEquipment: Number(equipmentCount[0]?.count ?? 0),
    totalIpPools: Number(ipPoolCount[0]?.count ?? 0),
    newCustomersThisMonth: Number(newCustomerCount[0]?.count ?? 0),
  });
});

router.get("/dashboard/revenue", async (_req, res) => {
  const rows = await db.execute(sql`
    SELECT
      TO_CHAR(DATE_TRUNC('month', created_at), 'Mon YYYY') as month,
      DATE_TRUNC('month', created_at) as month_date,
      COALESCE(SUM(amount::numeric), 0) as revenue,
      COUNT(*) as invoice_count
    FROM invoices
    WHERE status = 'paid'
    GROUP BY DATE_TRUNC('month', created_at)
    ORDER BY month_date DESC
    LIMIT 12
  `);

  const data = (rows.rows as Array<{ month: string; revenue: string; invoice_count: string }>)
    .reverse()
    .map(r => ({
      month: r.month,
      revenue: Number(r.revenue),
      invoiceCount: Number(r.invoice_count),
    }));
  res.setHeader("Cache-Control", "public, max-age=60");
  res.json(data);
});

router.get("/dashboard/activity", async (_req, res) => {
  const rows = await db.execute(sql`
    (SELECT id, 'customer_created' as type, 'New customer added: ' || name as description, created_at as ts, id as entity_id, 'customer' as entity_type FROM customers ORDER BY created_at DESC LIMIT 5)
    UNION ALL
    (SELECT id, 'invoice_created' as type, 'Invoice #' || id || ' created' as description, created_at as ts, id as entity_id, 'invoice' as entity_type FROM invoices ORDER BY created_at DESC LIMIT 5)
    UNION ALL
    (SELECT id, 'ticket_opened' as type, 'Ticket: ' || subject as description, created_at as ts, id as entity_id, 'ticket' as entity_type FROM tickets ORDER BY created_at DESC LIMIT 5)
    UNION ALL
    (SELECT id, 'payment_received' as type, 'Payment of $' || amount::numeric as description, created_at as ts, id as entity_id, 'payment' as entity_type FROM payments ORDER BY created_at DESC LIMIT 5)
    ORDER BY ts DESC
    LIMIT 20
  `);

  res.setHeader("Cache-Control", "public, max-age=30");
  res.json((rows.rows as Array<{ id: number; type: string; description: string; ts: string; entity_id: number; entity_type: string }>).map((r, i) => ({
    id: i + 1,
    type: r.type,
    description: r.description,
    timestamp: r.ts,
    entityId: r.entity_id,
    entityType: r.entity_type,
  })));
});

router.get("/dashboard/subscription-breakdown", async (_req, res) => {
  const rows = await db.execute(sql`
    SELECT status, COUNT(*) as count FROM subscriptions GROUP BY status
  `);
  res.setHeader("Cache-Control", "public, max-age=30");
  res.json((rows.rows as Array<{ status: string; count: string }>).map(r => ({
    status: r.status,
    count: Number(r.count),
  })));
});

export default router;
