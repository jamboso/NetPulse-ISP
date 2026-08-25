---
name: OpenVPN certificate authority synchronization
description: Router certificates must be signed by the same CA the deployed OpenVPN service trusts.
---

NetPulse must issue router certificates from the certificate authority used by the live OpenVPN server. On self-hosted installations where the deployment scripts created an EasyRSA CA independently, an owner must sync the installed certificate bundle before reprovisioning affected routers.

**Why:** A valid router certificate signed by a different CA is still rejected during the OpenVPN TLS handshake. Replacing a live server's certificates is more disruptive than aligning NetPulse with the existing trusted CA.

Older NetPulse installations may keep the active service certificates under `/etc/openvpn/server/certs`, while the current installer uses `/etc/openvpn/netpulse*`. Certificate sync must recognize both approved layouts and locate the corresponding CA signing key before issuing new router credentials.

**How to apply:** Preserve the running OpenVPN configuration, perform the owner-authorized server-local certificate sync, then reprovision each router whose certificate was issued under the previous CA. Never return CA or server private keys in API responses or logs.