---
name: Owner company-scope picker pattern
description: Reuse decision for gating owner-facing tenant screens behind an explicit company selection, instead of reinventing scoping per screen.
---

This app already has a shared frontend pattern for "an owner must pick a company before any tenant data loads or saves" (resolve role/selection state, show an explanatory empty state until chosen, bypass for non-owner roles whose company is implicit). Reuse it for new owner-facing tenant screens rather than writing a bespoke picker.

**Why:** Auditing and gating each owner-facing screen independently is how a screen gets missed — both a data-fetch and a data-*write* path (e.g. a create/update mutation) can silently skip the scope header even when the picker UI is present. See `monitoring-route-missing-company-scope.md` for a fetch-path example this cost real rework to catch.

**How to apply:** Before adding a new owner-facing tenant screen, find and reuse the existing scope hook/component pair. When adding it to an existing screen, verify *every* read and write call (queries and mutations) is threaded through it — not just the ones a dialog's initial data comes from.
