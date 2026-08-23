import { Router } from "express";
import { db } from "@workspace/db";
import { ipPoolsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { z } from "zod/v4";
import { requireRole } from "../middlewares/requireRole";
import { validateBody } from "../middlewares/validateBody";
import { resolveCompanyScope } from "../middlewares/companyScope";
import { writeAuditLog } from "../lib/audit";

function ipv4ToInteger(ipAddress: string): number {
  return ipAddress.split(".").reduce((value, octet) => value * 256 + Number(octet), 0);
}

function cidrPrefix(network: string): number {
  return Number(network.split("/")[1]);
}

function isCanonicalCidr(network: string): boolean {
  const prefix = cidrPrefix(network);
  const blockSize = 2 ** (32 - prefix);
  return ipv4ToInteger(network.split("/")[0]) % blockSize === 0;
}

function isUsableGateway(network: string, gateway: string): boolean {
  const prefix = cidrPrefix(network);
  const networkAddress = ipv4ToInteger(network.split("/")[0]);
  const broadcastAddress = networkAddress + 2 ** (32 - prefix) - 1;
  const gatewayAddress = ipv4ToInteger(gateway);

  return prefix >= 31
    ? gatewayAddress >= networkAddress && gatewayAddress <= broadcastAddress
    : gatewayAddress > networkAddress && gatewayAddress < broadcastAddress;
}

const ipv4CidrSchema = z.cidrv4().refine(
  (network) => cidrPrefix(network) >= 2 && isCanonicalCidr(network),
  { message: "Network CIDR must use a /2 or narrower canonical network address" },
);

function subnetMaskForPrefix(prefix: number): string {
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return [24, 16, 8, 0]
    .map((shift) => (mask >>> shift) & 0xff)
    .join(".");
}

const subnetMaskSchema = z.ipv4().refine(
  (mask) => /^1*0*$/.test(mask.split(".").map((octet) => Number(octet).toString(2).padStart(8, "0")).join("")),
  { message: "Subnet mask must have contiguous network bits" },
);

const createIpPoolSchema = z.object({
  name:        z.string().min(1),
  network:     ipv4CidrSchema,
  gateway:     z.ipv4(),
  subnetMask:  subnetMaskSchema,
  dns1:        z.string().optional().nullable(),
  dns2:        z.string().optional().nullable(),
  description: z.string().optional().nullable(),
}).strict().refine(
  ({ network, subnetMask }) => subnetMask === subnetMaskForPrefix(cidrPrefix(network)),
  { error: "Subnet mask must match the network CIDR", path: ["subnetMask"] },
).refine(
  ({ network, gateway }) => isUsableGateway(network, gateway),
  { error: "Gateway must be a usable address within the network CIDR", path: ["gateway"] },
);

const updateIpPoolSchema = z.object({
  name:        z.string().min(1).optional(),
  network:     ipv4CidrSchema.optional(),
  gateway:     z.ipv4().optional(),
  subnetMask:  subnetMaskSchema.optional(),
  dns1:        z.string().optional().nullable(),
  dns2:        z.string().optional().nullable(),
  description: z.string().optional().nullable(),
}).strict().superRefine((body, ctx) => {
  const networkChanged = body.network !== undefined;
  const subnetMaskChanged = body.subnetMask !== undefined;

  if (networkChanged !== subnetMaskChanged) {
    ctx.addIssue({
      code: "custom",
      path: [networkChanged ? "subnetMask" : "network"],
      message: "Network and subnet mask must be updated together",
    });
    return;
  }

  if (body.network && body.subnetMask
    && body.subnetMask !== subnetMaskForPrefix(cidrPrefix(body.network))) {
    ctx.addIssue({
      code: "custom",
      path: ["subnetMask"],
      message: "Subnet mask must match the network CIDR",
    });
  }

  if (body.network && body.gateway && !isUsableGateway(body.network, body.gateway)) {
    ctx.addIssue({
      code: "custom",
      path: ["gateway"],
      message: "Gateway must be a usable address within the network CIDR",
    });
  }
});

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
  const [existing] = await db.select().from(ipPoolsTable).where(scopedIpPoolWhere(req, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const effectiveNetwork = body.network ?? existing.network;
  const effectiveGateway = body.gateway ?? existing.gateway;
  if (!isUsableGateway(effectiveNetwork, effectiveGateway)) {
    res.status(400).json({
      error: "Validation failed",
      fields: { gateway: ["Gateway must be a usable address within the network CIDR"] },
    });
    return;
  }

  const update: Record<string, unknown> = {};
  if (body.name !== undefined) update.name = body.name;
  if (body.network !== undefined) {
    const prefix = cidrPrefix(body.network);
    update.network = body.network;
    update.totalIps = prefix <= 30 ? 2 ** (32 - prefix) - 2 : 2 ** (32 - prefix);
  }
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
