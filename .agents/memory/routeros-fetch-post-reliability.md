---
name: RouterOS /tool fetch POST reliability
description: RouterOS provisioning scripts calling home via /tool fetch should use GET, not POST+http-data, for reliability
---

A RouterOS `.rsc` script's `/tool fetch ... http-method=post http-data="..." keep-result=no` call (used to "call home" to report provisioning status) consistently hit its `on-error` branch on real hardware (multiple routers, healthy VPN tunnels, same server), while `/tool fetch` GET calls to the same HTTPS server in the same script (e.g. downloading certs with `dst-path=...`) always succeeded.

**Why:** Root cause could not be isolated without device-level tracing (RouterOS gives no exception text in `on-error={}` blocks pre-7.13, and 7.13's `:onerror` variable-capture syntax isn't available on 6.x, so it can't be used in a script that must support both). Rather than guess at the exact POST/http-data/keep-result incompatibility, the fix converts the "call home" request to a plain GET with all params in the query string — structurally identical to the fetch pattern already proven reliable elsewhere in the same script.

**How to apply:** For any RouterOS provisioning/callback script calling a Node/Express (or similar) backend, prefer `/tool fetch url="...?k=v&..." dst-path="tmpfile" mode=https` (GET) over POST+http-data for simple status callbacks. On the server, register the callback route for both GET and POST (share one handler, read from `req.query` with `req.body` as a fallback/primary) so it keeps working regardless of which method the caller uses.
