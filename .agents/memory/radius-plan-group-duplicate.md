---
name: RADIUS plan-group duplicate membership
description: Why changing or recreating a customer's bandwidth package could leave them stuck on an old speed indefinitely, even after redialing.
---

Customer speed/package enforcement runs through FreeRADIUS `radusergroup` (which plan group a username belongs to) + `radgroupreply` (that group's `Mikrotik-Rate-Limit`). Any code path that adds a user to a new plan group without first removing membership in their old plan group(s) leaves them in two `np-plan-*` groups at once. RADIUS then applies whichever group's reply attributes it evaluates last — non-deterministic from the app's point of view — so a customer can stay capped at an old (e.g. 10Mbps) rate forever, even after their package is changed again, their subscription is deleted and recreated, or they redial. The DB's `subscriptions.planId` and the RouterOS PPP profile can both show the *correct* new plan while RADIUS still silently serves the old one.

**Why:** discovered when a customer's package was changed from 10Mbps→200Mbps (and later the subscription was deleted/recreated) and they kept getting 10Mbps. `radusergroup` had rows for both `np-plan-5` and `np-plan-8` simultaneously — the original create path only ever inserted new group rows, never cleared stale ones.

**How to apply:** any function that assigns a subscriber to a plan's RADIUS group (creation, recreation, or plan change) must first delete all of that username's `np-plan-%` rows, then insert exactly one. When debugging "customer package looks right but speed is wrong," check `radusergroup` for duplicate plan-group rows before looking anywhere else, and remember an already-connected session needs to be kicked (or the customer needs to reconnect) before a RADIUS fix takes effect — RADIUS reply attributes are only sent at session start.
