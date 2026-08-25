---
name: Owner tenant workspace scope
description: Owner-operated tenant tools must require an explicit company selection instead of inferring a default company.
---

Owner requests that act on tenant data must carry an explicit company scope, either through the established query override or the tenant-workspace request header. The UI must make the selection visible before it loads or saves tenant records.

**Why:** The platform owner has no implicit company. Inferring one can expose or create OLT, ONU, and TR-069 records in the wrong tenant.

**How to apply:** For a new owner-facing tenant workspace, add an explicit company picker, include the chosen scope on every related request, and disable data operations until a selection exists. Do not weaken company filtering or use a silent fallback tenant.