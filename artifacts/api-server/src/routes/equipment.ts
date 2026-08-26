import { Router } from "express";
import { db } from "@workspace/db";
import { equipmentTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { z } from "zod/v4";
import { requireRole } from "../middlewares/requireRole";
import { validateBody } from "../middlewares/validateBody";
import { resolveCompanyScope, NO_COMPANY_SCOPE } from "../middlewares/companyScope";
import { writeAuditLog } from "../lib/audit";

const EQUIPMENT_TYPES = ["router", "switch", "olt", "onu", "other"] as const;
const EQUIPMENT_STATUSES = ["online", "offline", "maintenance"] as const;

const createEquipmentSchema = z.object({
  name:       z.string().min(1),
  type:       z.enum(EQUIPMENT_TYPES).optional(),
  model:      z.string().min(1),
  brand:      z.string().optional().nullable(),
  ipAddress:  z.ipv4(),
  macAddress: z.string().optional().nullable(),
  location:   z.string().optional().nullable(),
  status:     z.enum(EQUIPMENT_STATUSES).optional(),
  notes:      z.string().optional().nullable(),
}).strict();

const updateEquipmentSchema = createEquipmentSchema.partial();

const router = Router();
router.use(resolveCompanyScope);

function scopedEquipmentWhere(req: import("express").Request, id: number) {
  return req.companyId != null
    ? and(eq(equipmentTable.id, id), eq(equipmentTable.companyId, req.companyId))
    : NO_COMPANY_SCOPE;
}

router.get("/equipment", async (req, res) => {
  const { status, type } = req.query as Record<string, string>;
  const rows = req.companyId != null
    ? await db.select().from(equipmentTable).where(eq(equipmentTable.companyId, req.companyId)).orderBy(equipmentTable.createdAt)
    : [];
  const filtered = rows.filter(r => {
    if (status && r.status !== status) return false;
    if (type && r.type !== type) return false;
    return true;
  });
  res.json(filtered);
});

router.post("/equipment", requireRole("admin", "technician"), validateBody(createEquipmentSchema), async (req, res) => {
  if (req.companyId == null) {
    res.status(403).json({ error: "Forbidden: no company scope for this account" });
    return;
  }
  const body = req.body;
  const [eq_] = await db.insert(equipmentTable).values({
    companyId: req.companyId!,
    name: body.name,
    type: body.type ?? "router",
    model: body.model,
    brand: body.brand ?? null,
    ipAddress: body.ipAddress,
    macAddress: body.macAddress ?? null,
    location: body.location ?? null,
    status: body.status ?? "online",
    notes: body.notes ?? null,
  }).returning();

  void writeAuditLog({
    companyId:  req.companyId,
    userId:     req.user!.id,
    userEmail:  req.user!.email,
    action:     "create",
    entityType: "equipment",
    entityId:   eq_.id,
    diff:       eq_,
  });

  res.status(201).json(eq_);
});

router.get("/equipment/:id", async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const [item] = await db.select().from(equipmentTable).where(scopedEquipmentWhere(req, id));
  if (!item) { res.status(404).json({ error: "Not found" }); return; }
  res.json(item);
});

router.patch("/equipment/:id", requireRole("admin", "technician"), validateBody(updateEquipmentSchema), async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const body = req.body;
  const update: Record<string, unknown> = {};
  if (body.name !== undefined) update.name = body.name;
  if (body.type !== undefined) update.type = body.type;
  if (body.model !== undefined) update.model = body.model;
  if (body.brand !== undefined) update.brand = body.brand;
  if (body.ipAddress !== undefined) update.ipAddress = body.ipAddress;
  if (body.macAddress !== undefined) update.macAddress = body.macAddress;
  if (body.location !== undefined) update.location = body.location;
  if (body.status !== undefined) update.status = body.status;
  if (body.notes !== undefined) update.notes = body.notes;
  const [updated] = await db.update(equipmentTable).set(update).where(scopedEquipmentWhere(req, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  void writeAuditLog({
    companyId:  req.companyId,
    userId:     req.user!.id,
    userEmail:  req.user!.email,
    action:     "update",
    entityType: "equipment",
    entityId:   id,
    diff:       update,
  });

  res.json(updated);
});

router.delete("/equipment/:id", requireRole("admin"), async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  await db.delete(equipmentTable).where(scopedEquipmentWhere(req, id));

  void writeAuditLog({
    companyId:  req.companyId,
    userId:     req.user!.id,
    userEmail:  req.user!.email,
    action:     "delete",
    entityType: "equipment",
    entityId:   id,
  });

  res.status(204).send();
});

export default router;
