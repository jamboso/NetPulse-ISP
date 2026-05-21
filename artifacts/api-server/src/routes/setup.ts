import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, settingsTable } from "@workspace/db";

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

// Public first run — saves initial settings.
// After setup is complete this is a no-op (idempotent).
router.post("/setup/wizard", async (req, res) => {
  try {
    const alreadyDone = await db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.key, "setupComplete"));
    // Allow re-running only if not already complete
    if (alreadyDone[0]?.value === "1") {
      return res.status(400).json({ error: "Setup already completed." });
    }

    const payload = req.body as Record<string, string>;

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
      const existing = await db
        .select()
        .from(settingsTable)
        .where(eq(settingsTable.key, key));
      if (existing.length > 0) {
        await db
          .update(settingsTable)
          .set({ value, updatedAt: new Date() })
          .where(eq(settingsTable.key, key));
      } else {
        await db.insert(settingsTable).values({ key, value });
      }
    }

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: "Setup failed" });
  }
});

export default router;
