---
name: OpenVPN protocol alignment
description: RouterOS VPN bootstrap and deployment scripts must use the same OpenVPN transport protocol.
---

The OpenVPN server configuration and each generated RouterOS client script must use the same protocol and port. Standardize on TCP for MikroTik OpenVPN provisioning unless the deployed RouterOS version and server setup have explicitly been configured for UDP. RouterOS v6 profiles must not target a server that requires a `tls-auth` static HMAC key. RouterOS 6.49 also needs `AES-128-CBC` with `SHA1` and no compression; OpenVPN 2.5+ servers need that CBC cipher in both `data-ciphers` and `data-ciphers-fallback`.

**Why:** A TCP client directed at a UDP-only server on the same port fails silently from the application's point of view, even when the certificates and IP address are correct. RouterOS v6 also connects without the `tls-auth` HMAC, so a server requiring it rejects the first packet with “cannot locate HMAC.” Its client rejects the server's `SHA256` digest as unsupported and cannot negotiate GCM ciphers or LZ4 compression. The project contains both an app-generated TCP router profile and legacy deployment setup that defaults to UDP.

**How to apply:** Before issuing a router certificate or importing a `.rsc` profile, check the deployed OpenVPN service's `proto`, firewall rule, static HMAC requirement, and crypto profile. For RouterOS v6, use TCP and certificate authentication without `tls-auth`, with explicit `cipher=aes128` and `auth=sha1` on the router; regenerate the client script after any correction.

NetPulse router-management tunnels must be split tunnels: do not push `redirect-gateway`, and generate RouterOS clients with both `add-default-route=no` and `route-nopull=yes`.

**Why:** A default-route push can route the router's upstream traffic, including its reachability to the VPN endpoint, into a tunnel that is not intended to carry internet traffic. The result looks like a connection loop or a traffic outage.

**How to apply:** Keep the VPN route scope limited to explicit management networks. Do not accept server-pushed DNS for router-management tunnels unless that behavior is deliberately required and tested.

When another OpenVPN service already owns the standard port, compare CA fingerprints before changing anything. If the CAs differ, keep the unrelated service running and align the NetPulse database setting, dedicated config, firewall/NAT, and generated router profiles to a free port instead.

**Why:** An externally open port can belong to the wrong OpenVPN instance. In that state, certificates may appear to fail randomly even though the NetPulse service and router credentials are correct.

**How to apply:** Verify the process and unit behind each listener, then treat the port as a shared deployment value. A port change does not require CA regeneration, but existing routers must be updated or reprovisioned.