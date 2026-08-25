---
name: NetPulse OpenVPN legacy authentication
description: A marked legacy NetPulse OpenVPN config can retain password-script authentication that rejects certificate-only RouterOS clients.
---

The dedicated NetPulse RouterOS VPN is designed for client-certificate authentication. If OpenVPN logs show the client certificate verifies successfully followed by `auth-user-pass-verify` being disallowed and `AUTH_FAILED`, the listener and certificate chain are working; a stale password-authentication directive remains in the active config.

**Why:** Existing marked configurations are intentionally preserved by the installer, so they can retain directives from an earlier deployment even after the generated NetPulse config becomes certificate-only.

**How to apply:** Before changing the server, explain that removing the stale directive changes this dedicated service to certificate-only authentication, back up the config, remove only the legacy password-verification requirement, restart `openvpn-server@netpulse`, and verify a successful client connection.