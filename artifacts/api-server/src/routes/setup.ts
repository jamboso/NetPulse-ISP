import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, settingsTable, usersTable } from "@workspace/db";
import { auth } from "../lib/auth";

const router = Router();

// Public — no auth. Returns whether setup wizard has been completed.
router.get("/setup/status", async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.key, "setupComplete"));
    const complete = rows[0]?.value === "1";

    const companyRows = await db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.key, "companyName"));
    const companyName = companyRows[0]?.value ?? null;

    return res.json({ complete, companyName, version: "1.0.0" });
  } catch {
    return res.json({ complete: false, companyName: null, version: "1.0.0" });
  }
});

// Public first run — creates the first admin account and saves initial settings.
// Blocked once setupComplete = "1".
router.post("/setup/wizard", async (req, res) => {
  try {
    const alreadyDone = await db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.key, "setupComplete"));
    if (alreadyDone[0]?.value === "1") {
      return res.status(400).json({ error: "Setup already completed." });
    }

    const payload = req.body as Record<string, string>;

    // ── Create first admin account via better-auth ───────────────────────
    const { adminName, adminEmail, adminPassword } = payload;
    if (!adminEmail || !adminPassword || !adminName) {
      return res.status(400).json({ error: "Admin name, email and password are required." });
    }

    // Check if any user already exists (safety guard)
    const existingUsers = await db.select().from(usersTable).limit(1);
    if (existingUsers.length === 0) {
      await auth.api.signUpEmail({
        body: { name: adminName, email: adminEmail, password: adminPassword },
      });
    }

    // ── Save settings ────────────────────────────────────────────────────
    const allowed = [
      "companyName", "companyAddress", "companyPhone", "companyEmail",
      "timezone", "currency",
      "invoicePrefix", "invoiceDueDays", "lateFeePercent",
      "autoSuspendDays", "gracePeriodDays",
      "ntpServer",
    ];

    const entries: Array<{ key: string; value: string }> = [];
    for (const key of allowed) {
      if (payload[key] !== undefined && payload[key] !== "") {
        entries.push({ key, value: payload[key] });
      }
    }
    entries.push({ key: "setupComplete", value: "1" });

    for (const { key, value } of entries) {
      const existing = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
      if (existing.length > 0) {
        await db.update(settingsTable).set({ value, updatedAt: new Date() }).where(eq(settingsTable.key, key));
      } else {
        await db.insert(settingsTable).values({ key, value });
      }
    }

    return res.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Setup failed";
    return res.status(500).json({ error: msg });
  }
});

export default router;
