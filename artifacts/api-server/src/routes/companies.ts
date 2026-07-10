import { Router } from "express";
import { db, companiesTable, usersTable } from "@workspace/db";
import { eq, ne } from "drizzle-orm";
import { z } from "zod/v4";
import { requireRole } from "../middlewares/requireRole";
import { validateBody } from "../middlewares/validateBody";
import { auth } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";

const router = Router();

// All routes here are owner-only — this is the platform owner's tenant
// management area, never exposed to company staff.
//
// IMPORTANT: this must NOT be a blanket `router.use(requireRole("owner"))`.
// This router is mounted at the top level (alongside customers/plans/etc, not
// under a "/companies" path prefix), so an unscoped `router.use()` middleware
// here would run for every request that reaches this router — including ones
// destined for completely different route files mounted afterward — and
// reject them for any non-owner role before they ever get there. Apply the
// guard per-route instead so it only gates this file's own endpoints.
const ownerOnly = requireRole("owner");

const createCompanySchema = z.object({
  name:       z.string().min(1),
  ownerEmail: z.string().email(),
  ownerPhone: z.string().optional().nullable(),
});

const updateCompanySchema = z.object({
  name:       z.string().min(1).optional(),
  ownerEmail: z.string().email().optional(),
  ownerPhone: z.string().optional().nullable(),
});

const extendSchema = z.object({
  amount: z.number().int().positive(),
  unit:   z.enum(["hours", "days", "months"]),
});

function genUsernameBase(name: string): string {
  const initials = name
    .trim()
    .split(/\s+/)
    .map(w => w[0])
    .filter(Boolean)
    .join("")
    .toUpperCase();
  return initials || "CO";
}

async function genUniqueUsername(name: string): Promise<string> {
  const base = genUsernameBase(name);
  let candidate = base;
  let n = 1;
  // Collision numbering: WM, WM2, WM3, ...
  while (true) {
    const [existing] = await db.select({ id: companiesTable.id }).from(companiesTable).where(eq(companiesTable.username, candidate));
    if (!existing) return candidate;
    n += 1;
    candidate = `${base}${n}`;
  }
}

function genTempPassword(): string {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

router.get("/companies", ownerOnly, async (_req, res) => {
  const companies = await db.select().from(companiesTable).where(ne(companiesTable.id, 1)).orderBy(companiesTable.createdAt);

  const admins = await db
    .select({ id: usersTable.id, companyId: usersTable.companyId })
    .from(usersTable)
    .where(eq(usersTable.role, "admin"));
  const adminByCompany = new Map(admins.map(a => [a.companyId, a.id]));

  res.json({
    data: companies.map(c => ({ ...c, adminUserId: adminByCompany.get(c.id) ?? null })),
  });
});

router.get("/companies/:id", ownerOnly, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, id));
  if (!company) { res.status(404).json({ error: "Not found" }); return; }
  res.json(company);
});

router.post("/companies", ownerOnly, validateBody(createCompanySchema), async (req, res) => {
  const body = req.body as z.infer<typeof createCompanySchema>;

  const [existingUser] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, body.ownerEmail));
  if (existingUser) {
    res.status(400).json({ error: "A user with that email already exists" });
    return;
  }

  const username = await genUniqueUsername(body.name);
  const tempPassword = genTempPassword();

  const [company] = await db.insert(companiesTable).values({
    name:         body.name,
    username,
    ownerEmail:   body.ownerEmail,
    ownerPhone:   body.ownerPhone ?? null,
    accessStatus: "active",
    exempt:       false,
    accessUntil:  null,
  }).returning();

  let signUpResult;
  try {
    signUpResult = await auth.api.signUpEmail({
      body: { name: body.name, email: body.ownerEmail, password: tempPassword },
    });

    if (!signUpResult?.user) {
      throw new Error("signUpEmail returned no user");
    }

    await db.update(usersTable)
      .set({ role: "admin", companyId: company!.id, phone: body.ownerPhone ?? null, updatedAt: new Date() })
      .where(eq(usersTable.id, signUpResult.user.id));
  } catch (err) {
    // Roll back so we never strand a user without a companyId (which would
    // permanently 403 them via resolveCompanyScope) or a company without an admin.
    if (signUpResult?.user) {
      await db.delete(usersTable).where(eq(usersTable.id, signUpResult.user.id));
    }
    await db.delete(companiesTable).where(eq(companiesTable.id, company!.id));
    req.log.error({ err }, "Failed to finish company admin account setup, rolled back");
    res.status(500).json({ error: "Failed to create company admin account" });
    return;
  }

  void writeAuditLog({
    companyId:  company!.id,
    userId:     req.user!.id,
    userEmail:  req.user!.email,
    action:     "create",
    entityType: "company",
    entityId:   company!.id,
    diff:       { after: company },
  });

  res.status(201).json({ ...company, tempPassword, adminEmail: body.ownerEmail });
});

router.patch("/companies/:id", ownerOnly, validateBody(updateCompanySchema), async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const body = req.body as z.infer<typeof updateCompanySchema>;

  const [before] = await db.select().from(companiesTable).where(eq(companiesTable.id, id));
  if (!before) { res.status(404).json({ error: "Not found" }); return; }

  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name !== undefined) update.name = body.name;
  if (body.ownerEmail !== undefined) update.ownerEmail = body.ownerEmail;
  if (body.ownerPhone !== undefined) update.ownerPhone = body.ownerPhone;

  const [updated] = await db.update(companiesTable).set(update).where(eq(companiesTable.id, id)).returning();

  void writeAuditLog({
    companyId:  id,
    userId:     req.user!.id,
    userEmail:  req.user!.email,
    action:     "update",
    entityType: "company",
    entityId:   id,
    diff:       { before, after: updated },
  });

  res.json(updated);
});

router.post("/companies/:id/suspend", ownerOnly, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const [updated] = await db.update(companiesTable)
    .set({ accessStatus: "suspended", updatedAt: new Date() })
    .where(eq(companiesTable.id, id))
    .returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  void writeAuditLog({
    companyId: id,
    userId: req.user!.id, userEmail: req.user!.email,
    action: "update", entityType: "company", entityId: id,
    diff: { after: { accessStatus: "suspended" } },
  });

  res.json(updated);
});

router.post("/companies/:id/activate", ownerOnly, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const [updated] = await db.update(companiesTable)
    .set({ accessStatus: "active", updatedAt: new Date() })
    .where(eq(companiesTable.id, id))
    .returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  void writeAuditLog({
    companyId: id,
    userId: req.user!.id, userEmail: req.user!.email,
    action: "update", entityType: "company", entityId: id,
    diff: { after: { accessStatus: "active" } },
  });

  res.json(updated);
});

router.post("/companies/:id/exempt", ownerOnly, validateBody(z.object({ exempt: z.boolean() })), async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const { exempt } = req.body as { exempt: boolean };
  const [updated] = await db.update(companiesTable)
    .set({ exempt, updatedAt: new Date() })
    .where(eq(companiesTable.id, id))
    .returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  void writeAuditLog({
    companyId: id,
    userId: req.user!.id, userEmail: req.user!.email,
    action: "update", entityType: "company", entityId: id,
    diff: { after: { exempt } },
  });

  res.json(updated);
});

router.post("/companies/:id/extend", ownerOnly, validateBody(extendSchema), async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const { amount, unit } = req.body as z.infer<typeof extendSchema>;

  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, id));
  if (!company) { res.status(404).json({ error: "Not found" }); return; }

  const base = company.accessUntil && company.accessUntil.getTime() > Date.now() ? company.accessUntil : new Date();
  const extended = new Date(base);
  if (unit === "hours") extended.setHours(extended.getHours() + amount);
  else if (unit === "days") extended.setDate(extended.getDate() + amount);
  else extended.setMonth(extended.getMonth() + amount);

  const [updated] = await db.update(companiesTable)
    .set({ accessUntil: extended, accessStatus: "active", updatedAt: new Date() })
    .where(eq(companiesTable.id, id))
    .returning();

  void writeAuditLog({
    companyId: id,
    userId: req.user!.id, userEmail: req.user!.email,
    action: "update", entityType: "company", entityId: id,
    diff: { after: { accessUntil: extended } },
  });

  res.json(updated);
});

export default router;
