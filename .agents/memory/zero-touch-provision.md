---
name: Zero-Touch Provisioning
description: Two-stage RouterOS bootstrap provisioning via tokens — how the system works and key design choices
---

## Architecture
Two-stage .rsc bootstrap pattern (like the user's sample from Tabana Wireless):
1. Stage 1 (tiny, downloaded once by admin) → fetches Stage 2 via token + MAC
2. Stage 2 (generated fresh by server) → full OpenVPN + RADIUS + PPPoE config + callback

## Key endpoints (all PUBLIC, token is the auth)
- `GET /api/provision/:token/bootstrap.rsc` — Stage 1
- `GET /api/provision/:token/register` — called by Stage 1 before fetching Stage 2
- `GET /api/provision/:token/setup.rsc` — Stage 2 (includes router certs embedded)
- `POST /api/provision/:token/callback` — router calls this after completing setup
- `GET /api/provision/:token/info` — status polling (token-gated, no user auth needed)

## Auth-gated endpoints (require session)
- `GET /api/routers/:id/provision-info` — used by UI to poll status
- `POST /api/routers/:id/reprovision` — regenerate token + cert

## DB fields added to routersTable
provisionToken, provisionStatus ("pending"/"provisioned"/"connected"),
macAddress, rosVersion, vpnConnected, lastCallbackAt, vpnIp,
bridgePorts (text JSON array, default '["ether2"]')

## Auto-provisioning on creation
POST /routers automatically:
1. Generates a UUID provisionToken
2. Calls autoProvision() which generates a VPN client cert if VPN certs exist

## RouterOS-version fallback
The Stage 2 script must select the OpenVPN cipher on the router itself when the bootstrap has not reported a RouterOS version.

**Why:** RouterOS 7 needs `aes128-cbc`, while RouterOS 6 needs `aes128`. A missing version report otherwise produces a RouterOS 6 profile for a RouterOS 7 device and causes a generic tunnel timeout.

**How to apply:** Preserve the server-side version optimization when a version is reported, but keep an import-time RouterOS major-version check as the safe fallback. On a tunnel timeout, abort before RADIUS, PPPoE, hotspot, or customer-traffic configuration.

## UI
RouterProvisionPanel component in network.tsx:
- Polls /api/routers/:id/provision-info every 5s
- Shows copyable one-line RouterOS command
- Status badges animate based on provisionStatus + vpnConnected
- Reprovision button regenerates token + cert

**Why:** The token is the security boundary — it's a UUID in the URL, so guessing is infeasible. Routers don't have session cookies so token-in-URL is the correct pattern (same as how Safaricom M-Pesa callbacks work in this codebase).
