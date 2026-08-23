import { Router } from "express";
import { db } from "@workspace/db";
import { ipPoolsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { z } from "zod/v4";
import { requireRole } from "../middlewares/requireRole";
import { validateBody } from "../middlewares/validateBody";
import { resolveCompanyScope } from "../middlewares/companyScope";
import { writeAuditLog } from "../lib/audit";

const ipv4CidrSchema = z.cidrv4().refine(
  (network) => Number(network.split("/")[1]) >= 2,
  { message: "Network CIDR must have a prefix of /2 or greater" },
);

const createIpPoolSchema = z.object({
  name:        z.string().min(1),
  network:     ipv4CidrSchema,
  gateway:     z.ipv4(),
  subnetMask:  z.ipv4(),
  dns1:        z.string().optional().nullable(),
  dns2:        z.string().optional().nullable(),
  description: z.string().optional().nullable(),
}).strict();

const updateIpPoolSchema = z.object({
  name:        z.string().min(1).optional(),
  gateway:     z.ipv4().optional(),
  subnetMask:  z.ipv4().optional(),
  dns1:        z.string().optional().nullable(),
  dns2:        z.string().optional().nullable(),
  description: z.string().optional().nullable(),
}).strict();

const router = Router();
router.use(resolveCompanyScope);

function scopedIpPoolWhere(req: import("express").Request, id: number) {
  return req.companyId != null
    ? and(eq(ipPoolsTable.id, id), eq(ipPoolsTable.companyId, req.companyId))
    : eq(ipPoolsTable.id, id);
}

router.get("/ip-pools", async (req, res) => {
  const pools = req.companyId != null
    ? await db.select().from(ipPoolsTable).where(eq(ipPoolsTable.companyId, req.companyId)).orderBy(ipPoolsTable.createdAt)
    : await db.select().from(ipPoolsTable).orderBy(ipPoolsTable.createdAt);
  res.json(pools);
});

router.post("/ip-pools", requireRole("admin", "technician"), validateBody(createIpPoolSchema), async (req, res) => {
  const body = req.body;
  const prefix = Number(body.network.split("/")[1]);
  const totalIps = prefix <= 30 ? 2 ** (32 - prefix) - 2 : 2 ** (32 - prefix);

  const [pool] = await db.insert(ipPoolsTable).values({
    companyId: req.companyId!,
    name: body.name,
    network: body.network,
    gateway: body.gateway,
    subnetMask: body.subnetMask,
    dns1: body.dns1 ?? null,
    dns2: body.dns2 ?? null,
    totalIps,
    usedIps: 0,
    description: body.description ?? null,
  }).returning();

  void writeAuditLog({
    companyId:  req.companyId,
    userId:     req.user!.id,
    userEmail:  req.user!.email,
    action:     "create",
    entityType: "ip_pool",
    entityId:   pool.id,
    diff:       pool,
  });

  res.status(201).json(pool);
});

router.get("/ip-pools/:id", async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const [pool] = await db.select().from(ipPoolsTable).where(scopedIpPoolWhere(req, id));
  if (!pool) { res.status(404).json({ error: "Not found" }); return; }
  res.json(pool);
});

router.patch("/ip-pools/:id", requireRole("admin", "technician"), validateBody(updateIpPoolSchema), async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const body = req.body;
  const update: Record<string, unknown> = {};
  if (body.name !== undefined) update.name = body.name;
  if (body.gateway !== undefined) update.gateway = body.gateway;
  if (body.subnetMask !== undefined) update.subnetMask = body.subnetMask;
  if (body.dns1 !== undefined) update.dns1 = body.dns1;
  if (body.dns2 !== undefined) update.dns2 = body.dns2;
  if (body.description !== undefined) update.description = body.description;
  const [updated] = await db.update(ipPoolsTable).set(update).where(scopedIpPoolWhere(req, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  void writeAuditLog({
    companyId:  req.companyId,
    userId:     req.user!.id,
    userEmail:  req.user!.email,
    action:     "update",
    entityType: "ip_pool",
    entityId:   id,
    diff:       update,
  });

  res.json(updated);
});

router.delete("/ip-pools/:id", requireRole("admin"), async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  await db.delete(ipPoolsTable).where(scopedIpPoolWhere(req, id));

  void writeAuditLog({
    companyId:  req.companyId,
    userId:     req.user!.id,
    userEmail:  req.user!.email,
    action:     "delete",
    entityType: "ip_pool",
    entityId:   id,
  });

  res.status(204).send();
});

export default router;
