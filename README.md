# NetPulse ISP Manager

[![CI](https://github.com/jamboso/NetPulse-ISP/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/jamboso/NetPulse-ISP/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/jamboso/NetPulse-ISP/graph/badge.svg)](https://codecov.io/gh/jamboso/NetPulse-ISP)

A full-featured, self-hosted ISP Management System built for small and medium internet service providers. Manage customers, service plans, subscriptions, billing, M-Pesa payments, support tickets, network equipment, IP pools, hotspot portals, and more — all from a single web app.

---

## Features

### Customer Management
- Full CRUD — create, view, edit, and deactivate customers
- Status badges, search, and filter
- Customer detail page with subscription, invoice, payment, ticket, and communication history
- SMS notifications and communication logs

### Service Plans & Subscriptions
- Plan catalog with pricing tiers and data limits
- Link customers to plans, manage subscription status
- PPPoE and hotspot plan support

### Billing & Payments
- Generate and track invoices per subscription
- Record payments manually or via M-Pesa STK Push
- M-Pesa transaction log with rate limiting on all payment endpoints
- Sales analytics dashboard

### Support Tickets
- Create, reply to, and close tickets
- Staff vs. customer reply distinction
- Ticket detail page with full conversation thread

### Network Management
- Equipment inventory (routers, switches, OLTs, splitters, etc.)
- IP pool management with allocation tracking
- Network map visualization
- Infrastructure overview tab
- MikroTik RouterOS dashboard integration

### Hotspot Portal
- Captive portal for hotspot customers
- Hotspot session management and usage snapshots
- Admin dashboard for hotspot plans and vouchers

### Monitoring & Compliance
- Live bandwidth and uptime monitoring
- Usage snapshot history
- Compliance reporting
- Audit log with CSV export, entity ID filter, and links to detail pages
- Automated audit log retention/purge with configurable schedule and manual purge button
- Purge history log showing every cleanup run

### Access Control
- Role-based access: `admin`, `billing`, `support`, `technician`
- Staff management page (admin only)
- Session-based auth via better-auth (email + password)

### VPN (OpenVPN)
- Issue and revoke OpenVPN client certificates per customer
- Download `.ovpn` config files (admin only)
- Remote IP tracking from OpenVPN status log

### Settings & Setup
- SMTP configuration for password reset emails
- Company branding settings
- First-run Setup Wizard
- System update tab
- SMS template management

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + Vite, TailwindCSS, shadcn/ui, Recharts |
| API | Express 5, Node.js 24, TypeScript 5 |
| Database | PostgreSQL + Drizzle ORM |
| Auth | better-auth (email/password, session cookies) |
| Validation | Zod v4, drizzle-zod |
| API contract | OpenAPI 3.1 → Orval codegen → React Query hooks |
| Monorepo | pnpm workspaces |
| Payments | Safaricom M-Pesa Daraja API (STK Push, C2B) |
| VPN | OpenVPN (optional) |
| AAA | FreeRADIUS (optional) |
| Process mgr | PM2 |
| Reverse proxy | nginx |

---

## Quick Install (Ubuntu 22.04 / 24.04)

```bash
curl -fsSL https://raw.githubusercontent.com/jamboso/NetPulse-ISP/main/deploy/install.sh | sudo bash
```

The script takes ~5–8 minutes, then prints your server URL. Open it and follow the Setup Wizard.

### What the installer does

| Step | Action |
|------|--------|
| Pre-flight | Checks OS, RAM ≥ 1 GB, disk ≥ 5 GB, internet access |
| System packages | `git nginx postgresql openssl ufw curl` |
| Node.js 24 | Via NodeSource apt repo |
| PostgreSQL | Creates `netpulse` DB + user, auto-generates password |
| Code | Clones repo to `/opt/netpulse`; detects existing install and upgrades |
| .env | Writes production config with auto-generated secrets |
| Build | `pnpm install` → libs → API → frontend |
| PM2 | Registers and starts the API server as a system service |
| nginx | Configures reverse proxy on port 80 |

### Optional components

During install you will be prompted:

- **FreeRADIUS** — RADIUS AAA server for PPPoE/Wi-Fi authentication
- **OpenVPN** — VPN server for customer and staff tunnels

Both default to **No** and can be added later by re-running the setup script.

---

## Development Setup

### Requirements

- Node.js 24
- pnpm 10
- PostgreSQL (local or remote)

### Steps

```bash
git clone https://github.com/jamboso/NetPulse-ISP.git
cd NetPulse-ISP
pnpm install
```

Create a `.env` file in `artifacts/api-server/`:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/netpulse
BETTER_AUTH_SECRET=your-secret-here
SESSION_SECRET=your-secret-here
```

Push the database schema:

```bash
pnpm --filter @workspace/db run push
```

Start the API server and frontend:

```bash
# Terminal 1
pnpm --filter @workspace/api-server run dev

# Terminal 2
pnpm --filter @workspace/isp-portal run dev
```

Open [http://localhost:8080](http://localhost:8080) and complete the Setup Wizard to create your first admin account.

---

## Project Structure

```
├── artifacts/
│   ├── api-server/         # Express 5 API (port 5000, path /api)
│   └── isp-portal/         # React + Vite frontend (path /)
├── lib/
│   ├── api-spec/           # OpenAPI 3.1 source of truth
│   ├── api-client-react/   # Auto-generated React Query hooks (Orval)
│   ├── api-zod/            # Auto-generated Zod schemas (Orval)
│   └── db/                 # Drizzle ORM schema and DB client
├── deploy/
│   ├── install.sh          # One-command Ubuntu installer
│   ├── setup-ubuntu.sh     # Full setup script (called by installer)
│   ├── update.sh           # In-place upgrade script
│   ├── nginx.conf          # nginx reverse proxy config
│   └── ecosystem.config.cjs # PM2 process config
└── scripts/                # Utility scripts (post-merge, etc.)
```

---

## Useful Commands

| Command | Purpose |
|---------|---------|
| `pnpm run typecheck` | Full typecheck across all packages |
| `pnpm run build` | Typecheck + build all packages |
| `pnpm run test` | Run all tests |
| `pnpm --filter @workspace/api-spec run codegen` | Regenerate API hooks + Zod schemas from OpenAPI spec |
| `pnpm --filter @workspace/db run push` | Push DB schema changes (dev only) |
| `pnpm --filter @workspace/api-server run test:coverage` | API test coverage report |

---

## Roles & Permissions

| Role | Access |
|------|--------|
| `admin` | Full access to everything |
| `billing` | Invoices, payments, subscriptions, customers |
| `support` | Customers (read/write), tickets |
| `technician` | Equipment, IP pools, network infrastructure |

---

## API

The API is contract-first: all endpoints are defined in `lib/api-spec/openapi.yaml`. After editing the spec, run codegen to regenerate typed React Query hooks and Zod validation schemas:

```bash
pnpm --filter @workspace/api-spec run codegen
```

All API routes (except `/api/health`, `/api/setup`, `/api/hotspot-portal`, M-Pesa callbacks, and MAC vendor lookup) require a valid session cookie.

---

## M-Pesa Integration

Set the following environment variables to enable Safaricom Daraja API payments:

```env
MPESA_CONSUMER_KEY=
MPESA_CONSUMER_SECRET=
MPESA_SHORTCODE=
MPESA_PASSKEY=
MPESA_CALLBACK_URL=https://yourdomain.com/api/mpesa/callback
```

STK Push, C2B registration, and transaction history are all available via the Payments page.

---

## License

MIT
