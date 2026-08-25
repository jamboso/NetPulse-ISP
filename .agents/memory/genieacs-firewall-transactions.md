---
name: GenieACS firewall transactions
description: Safe lifecycle requirements for changing the CPE-facing GenieACS CWMP firewall policy.
---

CWMP firewall changes must be staged in a fully populated, source-restricted candidate chain before dispatching traffic to it. The prior active and persisted IPv4/IPv6 rules must remain recoverable until all GenieACS, nginx, and NetPulse checks succeed.

**Why:** Restoring a pre-install permissive firewall while CWMP is listening can expose the CPE management port. Interrupted installation recovery has the same risk as an ordinary failed install.

**How to apply:** Stop the CWMP listener before restoring firewall snapshots; only restart it after restoration when the snapshot proves a prior managed deployment existed. Reject simultaneous UFW ownership, never broaden host-wide firewall defaults, and retire an old dispatch only after the candidate policy has been persisted.