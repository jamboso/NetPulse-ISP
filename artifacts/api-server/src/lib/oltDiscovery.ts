import { and, eq, or } from "drizzle-orm";
import { db, oltPonPortsTable, onusTable } from "@workspace/db";
import type { OltDiscovery } from "./oltAdapters";

type PersistedInventory = { ports: number; onus: number; skippedOnus: number };

/**
 * Persists a vendor adapter's read-only discovery output in one database
 * transaction. Inventory records are always located by the active tenant and
 * OLT before they are updated, so a result can never modify another company.
 */
export async function persistOltDiscovery(
  companyId: number,
  oltId: number,
  discovery: OltDiscovery,
): Promise<PersistedInventory> {
  return db.transaction(async (tx) => {
    const discoveredAt = new Date();
    const portIds = new Map<string, number>();

    for (const port of discovery.ports) {
      const [existing] = await tx.select().from(oltPonPortsTable).where(and(
        eq(oltPonPortsTable.companyId, companyId),
        eq(oltPonPortsTable.oltId, oltId),
        eq(oltPonPortsTable.portNumber, port.portNumber),
      ));
      const values = {
        label: port.label ?? null,
        state: port.state,
        opticalState: port.opticalState ?? null,
        lastSeenAt: discoveredAt,
      };
      if (existing) {
        await tx.update(oltPonPortsTable).set(values).where(and(
          eq(oltPonPortsTable.id, existing.id),
          eq(oltPonPortsTable.companyId, companyId),
          eq(oltPonPortsTable.oltId, oltId),
        ));
        portIds.set(port.portNumber, existing.id);
      } else {
        const [created] = await tx.insert(oltPonPortsTable).values({
          companyId, oltId, portNumber: port.portNumber, ...values,
        }).returning({ id: oltPonPortsTable.id });
        if (created) portIds.set(port.portNumber, created.id);
      }
    }

    let persistedOnus = 0;
    let skippedOnus = 0;
    for (const onu of discovery.onus) {
      // A vendor must provide a stable serial or LOID before NetPulse can
      // safely merge repeated discoveries into one subscriber device record.
      if (!onu.serialNumber && !onu.loid) {
        skippedOnus += 1;
        continue;
      }
      const identityClauses = [
        onu.serialNumber ? eq(onusTable.serialNumber, onu.serialNumber) : undefined,
        onu.loid ? eq(onusTable.loid, onu.loid) : undefined,
      ].filter(Boolean);
      const [existing] = await tx.select().from(onusTable).where(and(
        eq(onusTable.companyId, companyId),
        eq(onusTable.oltId, oltId),
        or(...identityClauses),
      ));
      const values = {
        ponPortId: onu.portNumber ? portIds.get(onu.portNumber) ?? null : null,
        serialNumber: onu.serialNumber ?? null,
        loid: onu.loid ?? null,
        vendor: onu.vendor ?? null,
        model: onu.model ?? null,
        macAddress: onu.macAddress ?? null,
        opticalState: onu.opticalState ?? null,
        rxPowerDbm: onu.rxPowerDbm ?? null,
        txPowerDbm: onu.txPowerDbm ?? null,
        provisioningState: onu.provisioningState,
        lastSeenAt: discoveredAt,
      };
      if (existing) {
        await tx.update(onusTable).set(values).where(and(
          eq(onusTable.id, existing.id),
          eq(onusTable.companyId, companyId),
          eq(onusTable.oltId, oltId),
        ));
      } else {
        await tx.insert(onusTable).values({ companyId, oltId, ...values });
      }
      persistedOnus += 1;
    }

    return { ports: discovery.ports.length, onus: persistedOnus, skippedOnus };
  });
}