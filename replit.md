# NetPulse ISP Manager

[![CI](https://github.com/jamboso/NetPulse-ISP/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/jamboso/NetPulse-ISP/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/jamboso/NetPulse-ISP/graph/badge.svg)](https://codecov.io/gh/jamboso/NetPulse-ISP)

A full-featured ISP Management SaaS for managing customers, service plans, subscriptions, billing, payments, support tickets, network equipment, and IP pools.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm run test:secrets` — verify the pre-commit credential scanner
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Git credential protection

- Run `bash scripts/setup-git-hooks.sh` once after cloning. The existing
  post-merge setup also re-applies it.
- The pre-commit hook scans staged files and the local `.git/config` for common
  credential formats, including GitHub PATs, and blocks a match without
  printing the value.
- Remove and rotate any real credential it finds; never bypass the check with
  `git commit --no-verify`.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite (artifact: `artifacts/isp-portal`, preview path `/`)
- API: Express 5 (artifact: `artifacts/api-server`, path `/api`)
- DB: PostgreSQL + Drizzle ORM
- Auth: better-auth (email/password; session cookies; `@workspace/db` adapter)
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
- Auth uses better-auth (not Clerk); session verified server-side via `requireAuth` middleware
- `requireAuth` middleware guards all routes in `artifacts/api-server/src/routes/index.ts` except: health, mac-vendor, setup, mpesa callbacks, hotspot-portal
- Unauthenticated API requests return 401
- RBAC: `requireRole(...roles)` middleware in `artifacts/api-server/src/middlewares/requireRole.ts`; insufficient role returns 403
- Roles: `admin` (full access), `billing` (invoices/payments/subscriptions/customers), `support` (customers read/write, tickets), `technician` (equipment/IP pools/network infra)
- Role is stored on the `users` table (`role` column, default `"admin"`)
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
- **Settings**: user profile and account settings

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Vite HMR may serve stale module cache after import changes; restart the workflow to force a clean rebuild
- Always run `pnpm --filter @workspace/api-spec run codegen` after editing `openapi.yaml`
- better-auth session is cookie-based; frontend must send `credentials: "include"` on API requests
- `BETTER_AUTH_URL` env var must match the server's public origin for session cookies to work correctly

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
