---
name: OpenVPN stale listener recovery
description: Recover a managed OpenVPN service when a left-behind process retains its configured listener port.
---

When the OpenVPN service repeatedly exits with an “Address already in use” bind error while an older OpenVPN process owns its listener port, stop the managed service, terminate the specific stale listener, remove its stale PID file, and start the service again. Confirm the service reaches `active` before configuring routers.

**Why:** A left-behind daemon can keep TCP 1194 bound while systemd retries a replacement process, producing a restart loop even though the configuration itself is valid.

**How to apply:** Use this only after the OpenVPN log confirms the bind failure and identify the listener PID first. Warn that ending the listener briefly disconnects any existing VPN sessions; do not use a broad process kill on hosts that may run other OpenVPN services.