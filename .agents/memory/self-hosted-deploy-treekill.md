---
name: Self-hosted deploy script killed by its own PM2 restart
description: Web-UI-triggered production deploys freeze at the "restarting" status because PM2's restart kills the deploy script as a descendant process.
---

The self-hosted NetPulse updater (`deploy/update.sh`) is spawned as a `detached` background child of the running API server process when triggered from the Updates page. Partway through, the script itself calls `pm2 restart netpulse` to load the new build. Node's `detached: true` only detaches the child from the parent's process *group* (breaks terminal signal delivery) — it does not change the child's PPID lineage. PM2's restart kills the full descendant process tree of the app it restarts (via a PID-ancestry walk, not just a process-group signal), so the update script itself gets killed mid-flight at exactly the "restarting" step, before it can write "health-check"/"succeeded" to the status file.

**Why:** confirmed twice in production — git history and PM2 both showed the update had fully succeeded (new commit checked out, built, and running) each time, but the Updates-page status file stayed frozen forever at `{"state":"restarting", ...}` from the stale run, and a second deploy attempt from the web UI appeared to do nothing (its status write for the new target commit never landed, implying the second run died even earlier or was rejected).

**How to apply:** when a web-triggered deploy appears stuck at "restarting" indefinitely, don't keep retrying the button — SSH in and run `sudo /opt/netpulse/deploy/update.sh <full-commit-sha>` directly in the foreground. Running it as a normal SSH-session child (not a descendant of the PM2-managed app) lets it survive its own `pm2 restart` step and complete normally, including the health check. Task #231 (proposed, then cancelled by user) tracked a proper code fix for this; the SSH workaround remains the reliable path until/unless that's revisited.
