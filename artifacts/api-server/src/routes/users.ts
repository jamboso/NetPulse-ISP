import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq, ilike, or } from "drizzle-orm";
import { requireRole } from "../middlewares/requireRole";
import { auth } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";

const router = Router();

router.get("/users", requireRole("admin"), async (req, res) => {
  const { search } = req.query as Record<string, string>;

  let query = db.select({
    id: usersTable.id,
    email: usersTable.email,
    name: usersTable.name,
    role: usersTable.role,
    active: usersTable.active,
    createdAt: usersTable.createdAt,
  }).from(usersTable).$dynamic();

  if (search) {
    query = query.where(
      or(
        ilike(usersTable.name, `%${search}%`),
        ilike(usersTable.email, `%${search}%`),
      ),
    );
  }

  const data = await query.orderBy(usersTable.createdAt);
  res.json({ data });
});

router.post("/users", requireRole("admin"), async (req, res) => {
  const { name, email, password, role } = req.body as {
    name: string;
    email: string;
    password: string;
    role: string;
  };

  if (!name || !email || !password || !role) {
    res.status(400).json({ error: "name, email, password, and role are required" });
    return;
  }

  const validRoles = ["admin", "billing", "support", "technician"];
  if (!validRoles.includes(role)) {
    res.status(400).json({ error: "Invalid role" });
    return;
  }

  const existing = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (existing.length > 0) {
    res.status(400).json({ error: "A user with that email already exists" });
    return;
  }

  const signUpResult = await auth.api.signUpEmail({
    body: { name, email, password },
  });

  if (!signUpResult?.user) {
    res.status(500).json({ error: "Failed to create user" });
    return;
  }

  const [updated] = await db
    .update(usersTable)
    .set({ role, updatedAt: new Date() })
    .where(eq(usersTable.id, signUpResult.user.id))
    .returning({
      id: usersTable.id,
      email: usersTable.email,
      name: usersTable.name,
      role: usersTable.role,
      active: usersTable.active,
      createdAt: usersTable.createdAt,
    });

  void writeAuditLog({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: "create",
    entityType: "user",
    entityId: null,
    diff: { after: { id: updated?.id, email, name, role } },
  });

  res.status(201).json(updated);
});

router.patch("/users/:id", requireRole("admin"), async (req, res) => {
  const { id } = req.params as { id: string };
  const { role, active } = req.body as { role?: string; active?: boolean };

  if (id === req.user!.id) {
    res.status(400).json({ error: "You cannot modify your own account through this endpoint" });
    return;
  }

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const validRoles = ["admin", "billing", "support", "technician"];
  if (role !== undefined && !validRoles.includes(role)) {
    res.status(400).json({ error: "Invalid role" });
    return;
  }

  const updates: Partial<typeof usersTable.$inferInsert> = { updatedAt: new Date() };
  if (role !== undefined) updates.role = role;
  if (active !== undefined) updates.active = active;

  const [updated] = await db
    .update(usersTable)
    .set(updates)
    .where(eq(usersTable.id, id))
    .returning({
      id: usersTable.id,
      email: usersTable.email,
      name: usersTable.name,
      role: usersTable.role,
      active: usersTable.active,
      createdAt: usersTable.createdAt,
    });

  void writeAuditLog({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: "update",
    entityType: "user",
    entityId: null,
    diff: { before: existing, after: updated },
  });

  res.json(updated);
});

export default router;
