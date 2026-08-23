---
name: TR-069 ACS verification boundary
description: GenieACS owns CWMP authentication; NetPulse enables CPE management only after an ACS-side verification marker and reported standard data model are observed.
---

NetPulse must treat an external ACS as the authority for per-device CWMP authentication. It may never enable or retry management work based solely on a staff confirmation or an asserted device model.

**Why:** An ONU/CPE record and a guessed TR-098/TR-181 path are not proof that the device is authenticated or compatible. Sending a connection request or configuration task without both checks can affect an unverified device.

**How to apply:** Require a trusted ACS-side authentication marker and a freshly reported, matching standard data-model root before enrollment, command creation, or retry. When a CPE is offline, retain/queue work with visible recovery guidance rather than issuing a connection request. Model-specific VLAN, access, and QoS mappings remain disabled until separately lab-validated.