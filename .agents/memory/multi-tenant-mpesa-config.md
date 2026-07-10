---
name: Per-company M-Pesa Daraja config
description: How multi-tenant M-Pesa credentials are resolved and routed, and the legacy-compatibility constraint that shaped the design
---

Each SaaS client company can have its own Daraja paybill/consumer key/secret/passkey, stored one-row-per-company (unique on companyId) with a nullable-field resolver that falls back to company 1's legacy global settings row when a company has no dedicated config yet.

**Why:** Existing self-hosted single-tenant installs already had global M-Pesa settings tied to company 1. Callbacks from Safaricom arrive unauthenticated (no session/company context), so the company must be disambiguated from the URL path itself, not resolved via `req.companyId`.

**How to apply:** Safaricom-facing callback URLs are registered twice — legacy unscoped paths (`/api/mpesa/callback`, `/c2b/validation`, `/c2b/confirmation`) default to company 1 for backward compatibility, and new tenants get company-scoped paths suffixed with `companies.username` (e.g. `/api/mpesa/callback/:companyUsername`). A middleware resolves the company from that path segment before validating the Safaricom IP/webhook secret, since those checks are also per-company now. Authenticated in-app settings UI uses `req.companyId` from normal session-based company scoping (owner gets a per-company CRUD dialog on the Companies page; company admins get a self-scoped `/settings` tab) — never the path-based resolver, which is callback-only.
