import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  encryptNotificationSetting,
  isEncryptedNotificationSetting,
  isNotificationSetting,
} from "./settingsEncryption.js";

/**
 * One-time, idempotent migration for notification configuration saved before
 * encrypted storage was introduced. It never returns or logs the values.
 */
export async function migrateLegacyNotificationSettings(): Promise<number> {
  const rows = await db.select().from(settingsTable);
  let migrated = 0;

  for (const row of rows) {
    if (
      row.value === null
      || !isNotificationSetting(row.key)
      || isEncryptedNotificationSetting(row.value)
    ) {
      continue;
    }

    await db
      .update(settingsTable)
      .set({ value: encryptNotificationSetting(row.value), updatedAt: new Date() })
      .where(eq(settingsTable.key, row.key));
    migrated += 1;
  }

  return migrated;
}