---
name: NetPulse settings allowlist gap
description: radiusPort is not persistable via the settings API — known pre-existing gap in NetPulse ISP Manager
---

`PATCH /api/settings` only persists keys listed in `SETTINGS_KEYS` in `artifacts/api-server/src/routes/settings.ts`. `radiusPort` (and possibly other newer settings fields the frontend renders, e.g. `radiusAcctPort`, `radiusNasId`) are missing from that allowlist, so submitting them via the Settings UI silently no-ops — no error, the value just never persists.

**Why:** Discovered while wiring RADIUS auto-configuration into the PPPoE setup wizard. The global RADIUS server/secret persist fine, but relying on a global `radiusPort` setting would have silently failed. Worked around by using the per-router `routersTable.radiusPort` column (falls back to a hardcoded default of 1812) instead of depending on the unpersisted global setting.

**How to apply:** Before wiring any new feature to a `settingsTable` key, check it's actually in `SETTINGS_KEYS`. If a user reports a Settings field "not saving," check this allowlist first before assuming a UI or DB bug.
