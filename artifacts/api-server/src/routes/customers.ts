import { Router } from "express";
import { db } from "@workspace/db";
import { customersTable } from "@workspace/db";
import { eq, ilike, or, sql } from "drizzle-orm";

const router = Router();

router.get("/customers", async (req, res) => {
  const { search, status, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  let query = db.select().from(customersTable).$dynamic();
  let countQuery = db.select({ count: sql<number>`count(*)` }).from(customersTable).$dynamic();

  const conditions = [];
  if (search) {
    conditions.push(or(
      ilike(customersTable.name, `%${search}%`),
      ilike(customersTable.email, `%${search}%`),
      ilike(customersTable.phone, `%${search}%`),
    ));
  }
  if (status) conditions.push(eq(customersTable.status, status));

  if (conditions.length > 0) {
    const cond = conditions.length === 1 ? conditions[0]! : sql`${conditions[0]} AND ${conditions[1]}`;
    query = query.where(cond);
    countQuery = countQuery.where(cond);
  }

  const [data, countResult] = await Promise.all([
    query.orderBy(customersTable.createdAt).limit(limitNum).offset(offset),
    countQuery,
  ]);

  res.json({ data, total: Number(countResult[0]?.count ?? 0), page: pageNum, limit: limitNum });
});

router.post("/customers", async (req, res) => {
  const body = req.body;
  const [customer] = await db.insert(customersTable).values({
    name: body.name,
    email: body.email,
    phone: body.phone,
    address: body.address,
    status: body.status ?? "active",
    notes: body.notes ?? null,
  }).returning();
  res.status(201).json(customer);
});

router.get("/customers/:id", async (req, res) => {
  const id = parseInt(req.params.id!);
  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, id));
  if (!customer) { res.status(404).json({ error: "Not found" }); return; }
  res.json(customer);
});

router.patch("/customers/:id", async (req, res) => {
  const id = parseInt(req.params.id!);
  const body = req.body;
  const update: Record<string, unknown> = {};
  if (body.name !== undefined) update.name = body.name;
  if (body.email !== undefined) update.email = body.email;
  if (body.phone !== undefined) update.phone = body.phone;
  if (body.address !== undefined) update.address = body.address;
  if (body.status !== undefined) update.status = body.status;
  if (body.notes !== undefined) update.notes = body.notes;
  const [updated] = await db.update(customersTable).set(update).where(eq(customersTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

router.delete("/customers/:id", async (req, res) => {
  const id = parseInt(req.params.id!);
  await db.delete(customersTable).where(eq(customersTable.id, id));
  res.status(204).send();
});

export default router;
