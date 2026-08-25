---
name: Dedicated RouterOS VPN boundary
description: Safety rules that keep NetPulse router management VPN recovery isolated from other OpenVPN deployments.
---

NetPulse RouterOS VPN recovery must operate only on the dedicated, marked NetPulse OpenVPN instance. It must never infer ownership from a generic OpenVPN unit name, port number, or certificate path.

**Why:** A host can run another business-critical VPN (including Tabana-VPN) alongside NetPulse. Generic names such as `openvpn@server` and `/etc/openvpn/server.conf` are not proof of NetPulse ownership; automated repair against them can disrupt unrelated traffic.

**How to apply:** Use the dedicated NetPulse configuration, unit, PKI, PID, and logs. Require the immutable NetPulse ownership marker before changing configuration, stopping a listener, or restarting a service. The management protocol is TCP only; server configurations use `tcp-server`, while the repair helper reads and validates the marked configuration's own TCP port instead of assuming 1194. Once a zero-touch RouterOS tunnel is connected, NetPulse monitoring and RouterOS control must use the assigned private VPN address rather than a public management address. Keep legacy migration root-only and explicitly confirmed by an operator after they verify the source is NetPulse; the portal and normal updater must refuse to adopt generic instances automatically. Privileged helper sources must be root-owned and non-writable by the app account before installation.