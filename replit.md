# NetPulse ISP Manager

A full-featured ISP Management SaaS for managing customers, service plans, subscriptions, billing, payments, support tickets, network equipment, and IP pools.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite (artifact: `artifacts/isp-portal`, preview path `/`)
- API: Express 5 (artifact: `artifacts/api-server`, path `/api`)
- DB: PostgreSQL + Drizzle ORM
- Auth: Clerk (`@clerk/react` v6 on frontend, `@clerk/express` on backend)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Charts: Recharts
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — OpenAPI source of truth
- `lib/db/src/schema/` — Drizzle ORM table definitions (customers, plans, subscriptions, invoices, payments, tickets, equipment, ipPools)
- `lib/api-client-react/src/generated/` — auto-generated React Query hooks
- `artifacts/api-server/src/routes/` — Express route handlers
- `artifacts/isp-portal/src/pages/` — React page components
- `artifacts/isp-portal/src/components/` — shared UI components

## Architecture decisions

- Contract-first API: OpenAPI spec → Orval codegen → typed React Query hooks
- Clerk auth v6: uses `Show` component (not `SignedIn`/`SignedOut`) for auth gating; `RedirectToSignIn` for unauthenticated redirects
- API routes are currently open (no auth middleware guard on backend routes)
- Numeric DB fields (`price`, `amount`) stored as `numeric`, converted via `Number()` in routes
- `isStaff` in ticket_replies stored as `text` ("true"/"false") for compatibility

## Product

- **Dashboard**: live KPI cards + revenue chart + recent activity
- **Customers**: full CRUD, status badges, search/filter
- **Service Plans**: plan catalog with pricing tiers
- **Subscriptions**: link customers to plans, manage status
- **Invoices**: generate & track invoices per subscription
- **Payments**: record and view payments against invoices
- **Support Tickets**: create/reply/close tickets, staff vs. customer replies
- **Network**: equipment inventory + IP pool management
- **Settings**: user profile via Clerk UserProfile component

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- `@clerk/react` v6 exports `Show` (with `when="signed-in"` / `when="signed-out"` props) — NOT `SignedIn`/`SignedOut` components
- Do NOT import from `@clerk/react/internal` or `@clerk/themes` — neither is available
- Vite HMR may serve stale module cache after import changes; restart the workflow to force a clean rebuild
- Always run `pnpm --filter @workspace/api-spec run codegen` after editing `openapi.yaml`

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
