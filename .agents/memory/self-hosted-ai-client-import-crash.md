---
name: Self-hosted deploys crash if AI integration client throws at import time
description: Any lib module that throws unconditionally at module-load time when AI_INTEGRATIONS_OPENAI_* env vars are unset will crash-loop the whole server on self-hosted installs that never provisioned the AI integration.
---

Any `lib/*` module that does `if (!process.env.AI_INTEGRATIONS_OPENAI_*) throw ...` at the top level (outside a function) crashes the entire process at import time, not just the feature that needs it — because bundlers/ESM eagerly evaluate all imported modules reachable from the entrypoint, even if the route using them is never called.

**Why:** On self-hosted deploys (e.g. a bare Ubuntu box), there's no Replit-managed AI Integrations proxy, so these env vars are legitimately unset. The server should still boot and serve every non-AI feature (auth, billing, etc).

**How to apply:** Any client wrapping an optional integration must defer the env-var check into a lazy getter (e.g. a `Proxy` or function called on first real use), never at module scope. When fixing one instance of this pattern, grep the whole `lib/` tree for the same error string / pattern — there were three near-identical copies (`client.ts`, `image/client.ts`, `audio/client.ts`) and fixing only one still left the server crash-looping.
