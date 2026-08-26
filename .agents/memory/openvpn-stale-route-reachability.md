---
name: Stale VPN host route breaks reachability monitoring
description: A leftover, more-specific kernel route to a client's VPN IP on an old tun device can silently override the live session's subnet route.
---

On the NetPulse production OpenVPN server, `ip route` can show a stale host route to a router's VPN address (e.g. `10.8.0.2 dev tun0 ... src 10.8.0.1`) alongside the correct, live subnet route on a different tun device (e.g. `10.8.0.0/24 dev tun1 ... src 10.8.0.1`) from the current `openvpn-server@netpulse` session (confirmed via `sudo cat /run/openvpn-server/status-netpulse.log`, which lists only one live client).

**Why:** Linux routing uses longest-prefix match, so the leftover host route on the stale tun device wins for any traffic the server sends to that exact IP, even though the client's real, live session is on a different tun device. This makes the server's own reachability/ping-based monitoring report the router as permanently unreachable/offline even while the tunnel itself is healthy and authenticated. It does not affect traffic that never targets the VPN-private address (e.g. the provisioning callback, which calls the router's public serverUrl, not the VPN IP).

**How to apply:** Before assuming an OpenVPN data-path or cipher problem, run `ip route | grep <vpn-subnet>` and cross-check against `sudo cat /run/openvpn-server/status-netpulse.log` for the actually-live session's device. If a stale, more-specific route exists on an orphaned tun device with no owning process (verify via `ps aux | grep openvpn` first — per the dedicated-RouterOS-VPN-boundary rule, never remove a route or kill a process without confirming it isn't an unrelated service), removing the stale route is the fix, not touching cipher/auth config.
