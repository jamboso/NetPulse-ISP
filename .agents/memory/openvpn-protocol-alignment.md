---
name: OpenVPN protocol alignment
description: RouterOS VPN bootstrap and deployment scripts must use the same OpenVPN transport protocol.
---

The OpenVPN server configuration and each generated RouterOS client script must use the same protocol and port. Standardize on TCP for MikroTik OpenVPN provisioning unless the deployed RouterOS version and server setup have explicitly been configured for UDP.

**Why:** A TCP client directed at a UDP-only server on the same port fails silently from the application's point of view, even when the certificates and IP address are correct. The project contains both an app-generated TCP router profile and legacy deployment setup that defaults to UDP.

**How to apply:** Before issuing a router certificate or importing a `.rsc` profile, check the deployed OpenVPN service's `proto` and firewall rule, then match the Infrastructure VPN setting and regenerate the client script after any correction.