---
name: VPN repair authorization
description: Role boundary for the dedicated NetPulse OpenVPN repair operation.
---

The safe, dedicated NetPulse VPN repair operation is available to account owners and administrators, but not technicians or lower-privileged roles.

**Why:** System administrators need to restore the private management tunnel that gates RouterOS console access. The helper is still restricted to NetPulse's dedicated service and does not modify routers, Tabana-VPN, RADIUS, or customer traffic.

**How to apply:** Keep portal visibility and API authorization aligned whenever changing this repair workflow. Do not broaden the privileged helper to technicians, and retain the dedicated-service validation and repair confirmation.