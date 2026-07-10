/**
 * Per-company M-Pesa credential resolution.
 *
 * Each SaaS client company can run its own Daraja paybill/till with its own
 * Consumer Key/Secret/Passkey. Resolution order per company:
 *   1. `company_mpesa_configs` row for that companyId (set via Settings → M-Pesa
 *      or, for owners, the Companies dashboard).
 *   2. Legacy global `settings` table (`mpesa*` keys) — only for companyId 1,
 *      so existing single-tenant/self-hosted installs keep working unchanged.
 *   3. `MPESA_*` environment variables — same companyId-1-only fallback.
 */

import { db } from "@workspace/db";
import { companyMpesaConfigsTable, companiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getSettings } from "./sms.js";

export interface ResolvedMpesaConfig {
  companyId: number;
  consumerKey?: string;
  consumerSecret?: string;
  shortcode?: string;
  passkey?: string;
  paybillNumber?: string;
  env: string;
  callbackUrl?: string;
  allowedIps?: string;
  webhookSecret?: string;
}

const LEGACY_FALLBACK_COMPANY_ID = 1;

/** Fetch the raw per-company config row, or null if none has been saved yet. */
export async function getCompanyMpesaConfigRow(companyId: number) {
  const [row] = await db
    .select()
    .from(companyMpesaConfigsTable)
    .where(eq(companyMpesaConfigsTable.companyId, companyId));
  return row ?? null;
}

/** Resolve the effective, ready-to-use M-Pesa config for a given company. */
export async function resolveMpesaConfig(companyId: number): Promise<ResolvedMpesaConfig> {
  const row = await getCompanyMpesaConfigRow(companyId);

  if (row && (row.consumerKey || row.consumerSecret || row.shortcode)) {
    return {
      companyId,
      consumerKey: row.consumerKey ?? undefined,
      consumerSecret: row.consumerSecret ?? undefined,
      shortcode: row.shortcode ?? undefined,
      passkey: row.passkey ?? undefined,
      paybillNumber: row.paybillNumber ?? undefined,
      env: row.env ?? "sandbox",
      callbackUrl: row.callbackUrl ?? undefined,
      allowedIps: row.allowedIps ?? undefined,
      webhookSecret: row.webhookSecret ?? undefined,
    };
  }

  if (companyId !== LEGACY_FALLBACK_COMPANY_ID) {
    // No per-company config saved yet, and this isn't the legacy default
    // company — do not fall through to another tenant's global settings.
    return { companyId, env: "sandbox" };
  }

  let s: Record<string, string> = {};
  try {
    s = await getSettings();
  } catch {
    // fall through to env vars
  }

  return {
    companyId,
    consumerKey: s["mpesaConsumerKey"] || process.env["MPESA_CONSUMER_KEY"] || undefined,
    consumerSecret: s["mpesaConsumerSecret"] || process.env["MPESA_CONSUMER_SECRET"] || undefined,
    shortcode: s["mpesaShortcode"] || process.env["MPESA_SHORTCODE"] || undefined,
    passkey: s["mpesaPasskey"] || process.env["MPESA_PASSKEY"] || undefined,
    paybillNumber: s["mpesaPaybillNumber"] || undefined,
    env: s["mpesaEnv"] || process.env["MPESA_ENV"] || "sandbox",
    callbackUrl: s["mpesaCallbackUrl"] || process.env["MPESA_CALLBACK_URL"] || undefined,
    allowedIps: s["mpesaAllowedIps"] || process.env["MPESA_ALLOWED_IPS"] || undefined,
    webhookSecret: s["mpesaWebhookSecret"] || process.env["MPESA_WEBHOOK_SECRET"] || undefined,
  };
}

/** Resolve a company by its public `username` slug (used in callback URLs). */
export async function getCompanyByUsername(username: string) {
  const [row] = await db.select().from(companiesTable).where(eq(companiesTable.username, username));
  return row ?? null;
}

/** Resolve a company by id — used to build the company-scoped callback URL. */
export async function getCompanyById(companyId: number) {
  const [row] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId));
  return row ?? null;
}

/** Upsert the per-company config row with the given partial fields. */
export async function upsertCompanyMpesaConfig(
  companyId: number,
  fields: Partial<{
    consumerKey: string | null;
    consumerSecret: string | null;
    shortcode: string | null;
    passkey: string | null;
    paybillNumber: string | null;
    env: string;
    callbackUrl: string | null;
    allowedIps: string | null;
    webhookSecret: string | null;
  }>,
) {
  const existing = await getCompanyMpesaConfigRow(companyId);
  if (existing) {
    await db
      .update(companyMpesaConfigsTable)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(companyMpesaConfigsTable.companyId, companyId));
  } else {
    await db.insert(companyMpesaConfigsTable).values({ companyId, ...fields });
  }
  return getCompanyMpesaConfigRow(companyId);
}
