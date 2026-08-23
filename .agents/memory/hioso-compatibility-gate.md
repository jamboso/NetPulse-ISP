---
name: HIOSO compatibility gate
description: Safety rule for HIOSO OLT capability profiles and the boundary between recognized hardware and validated behavior.
---

Treat HIOSO series recognition, MIB-backed discovery, and write authorization as separate capability levels. A model’s port count, family name, package size, or an EPON MIB must never be used to infer GPON compatibility or configuration-write safety. GPON may use standard SNMP identity checks only when no GPON-specific MIB evidence is available.

**Why:** HIOSO command mappings vary by PON protocol, firmware, and ONU interoperability behavior. The supplied EPON materials prove selected read-only inventory fields, not GPON controls or safe service configuration.

**How to apply:** Add a model/firmware/PON/protocol combination to the registry only with its evidence level. Before accepting MIB-specific discovery, confirm the live SNMP identity and firmware against the stored approved profile; fail without persisting inventory on a mismatch. Where only standard SNMP identity is evidenced, avoid vendor-specific OIDs and persist no PON/ONU inventory. Keep provisioning and rollback disabled until an exact profile is validated in a safe lab. Preserve the existing encrypted-credential, tenant-scope, and approved-IP handoff boundaries for every discovery request.