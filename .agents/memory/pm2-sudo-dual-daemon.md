---
name: PM2 has a separate daemon per Unix user — sudo vs non-sudo silently fork the process list
description: Running pm2 commands sometimes with sudo and sometimes without creates two independent PM2 daemons (root's and the regular user's) that can collide on the same port.
---

PM2 stores its process list per-user (`~/.pm2`). If an app is registered once as a regular user (`pm2 start ...`) and later restarted/updated via a `sudo`-requiring script (`sudo bash deploy/update.sh` → `pm2 restart netpulse` running as root), that creates a **second, independent** PM2 daemon under root managing its own copy of the same app — not the same process.

**Why:** Both copies try to bind the same `PORT`. The one started second (usually root's) fails with `EADDRINUSE` and crash-loops with an enormous restart count in a few seconds (thousands of restarts, 0s uptime), which is a strong diagnostic signature for this exact issue. Meanwhile `curl localhost:<port>` still connects because the *other* (older) daemon's process is still bound and serving stale code — so requests silently hit outdated code with no obvious error, or nginx returns 502 if that old process ever dies without root's replacement ever succeeding.

**How to apply:** Pick one invocation convention (this project's `deploy/update.sh` hard-requires root) and stick to it consistently — always `sudo`, or never. If you inherit a mixed setup, run `pm2 kill` as the *non-privileged* user to clear the stray daemon, then let the root-owned one (`sudo pm2 restart ...` / `sudo pm2 save`) be the single source of truth.
