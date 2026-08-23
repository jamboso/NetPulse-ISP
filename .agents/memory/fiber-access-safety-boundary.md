---
name: Fiber access safety boundary
description: Safety rules for managed OLT/ONU integration and vendor adapter enablement.
---

OLT and ONU management remains independent of RouterOS router records. A default OLT adapter may test management-port reachability and perform inventory discovery only; it must refuse provisioning and rollback commands. Enable vendor write behavior only after model, firmware, protocol, and lab validation. Every network probe must resolve the management hostname immediately before use and connect only to its validated IP inside the explicit `OLT_MANAGEMENT_ALLOWED_CIDRS` allowlist; protocol-specific default ports are enforced.

**Why:** SNMP and CLI command mappings vary across OLT vendors and firmware. Treating an unverified profile as writable could alter subscriber service or factory-reset equipment. Unvalidated management hosts would also turn discovery into an internal-network scanning/SSRF primitive.

**How to apply:** New vendor integrations register behind the adapter contract, retain company scoping and credential redaction, and begin as dry-run/approval-only until their specific write operations are validated. When only standard SNMP identity is evidenced, use `sysDescr`/`sysName` to verify the exact vendor and model, return no PON/ONU inventory, and send no vendor enterprise OIDs. For MIB-based reads, gate requests in order: standard identity first, firmware validation second, PON/ONU tables last. Persist discovered PON/ONU inventory transactionally with company-and-OLT-scoped matching so repeat discovery updates records rather than duplicating them. Never re-resolve an approved hostname inside an adapter; pass its already-approved IP address instead.