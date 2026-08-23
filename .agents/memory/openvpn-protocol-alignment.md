---
name: OpenVPN protocol alignment
description: RouterOS VPN bootstrap and deployment scripts must use the same OpenVPN transport protocol.
---

The OpenVPN server configuration and each generated RouterOS client script must use the same protocol and port. Standardize on TCP for MikroTik OpenVPN provisioning unless the deployed RouterOS version and server setup have explicitly been configured for UDP. RouterOS v6 profiles must not target a server that requires a `tls-auth` static HMAC key. RouterOS 6.49 also needs `AES-128-CBC` with `SHA1` and no compression; OpenVPN 2.5+ servers need that CBC cipher in both `data-ciphers` and `data-ciphers-fallback`.

**Why:** A TCP client directed at a UDP-only server on the same port fails silently from the application's point of view, even when the certificates and IP address are correct. RouterOS v6 also connects without the `tls-auth` HMAC, so a server requiring it rejects the first packet with “cannot locate HMAC.” Its client rejects the server's `SHA256` digest as unsupported and cannot negotiate GCM ciphers or LZ4 compression. The project contains both an app-generated TCP router profile and legacy deployment setup that defaults to UDP.

**How to apply:** Before issuing a router certificate or importing a `.rsc` profile, check the deployed OpenVPN service's `proto`, firewall rule, static HMAC requirement, and crypto profile. For RouterOS v6, use TCP and certificate authentication without `tls-auth`, with explicit `cipher=aes128` and `auth=sha1` on the router; regenerate the client script after any correction.