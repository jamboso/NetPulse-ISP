---
name: Ubuntu firewall persistence
description: Firewall and persistence constraints on the self-hosted NetPulse control-plane server
---

The Ubuntu control plane uses iptables-nft rules restored by netfilter-persistent, not an active UFW installation. Existing UFW chain names are remnants in the saved rules and do not mean UFW is active. The current INPUT policy is ACCEPT, so a new service must not assume that the host is protected by a default-deny firewall.

**Why:** Enabling a new default-deny firewall without first preserving SSH, HTTPS, OpenVPN, and RADIUS access could lock out the server or disrupt existing services.

**How to apply:** Before exposing GenieACS CWMP, inspect and preserve the saved iptables rules, obtain the real CPE/NAT source CIDR, and add a narrowly scoped TCP 7547 rule through the existing iptables/netfilter-persistent mechanism. Do not guess a whole-internet rule or install UFW solely to satisfy an installer preflight.