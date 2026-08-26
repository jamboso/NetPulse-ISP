---
name: RouterOS version string breaks unescaped URL fetches
description: /system resource get version returns "7.15.2 (stable3)" with spaces/parens; embedding it raw in a /tool fetch URL query param breaks the request.
---

RouterOS's `/system resource get version` returns a human-readable string like `7.15.2 (stable3)` — it contains a space and parentheses. If that raw value is concatenated directly into a `/tool fetch url=(...)` query parameter in a generated `.rsc` script, the URL becomes invalid and the fetch fails outright (RouterOS does not auto percent-encode it).

**Why:** This exact bug caused a provisioning "call home" callback to silently fail (`/tool fetch` error caught by a generic `on-error` handler, logged as a vague warning) while an earlier step in the same script correctly used `[:tonum [:pick [/system resource get version] 0 1]]` to get just the major version number. The failure was invisible from the server side — the request never reached the server — and only showed up in the router's own `/log print where message~"..."` output.

**How to apply:** Any RouterOS script embedding the OS version in a URL, filename, or other machine-parsed string must extract just the major version number via `[:tonum [:pick [/system resource get version] 0 1]]`, matching the pattern already used elsewhere in the script, rather than interpolating the raw version string. When a RouterOS `/tool fetch` step silently fails in a generated provisioning script, check the router's own log (via WinBox terminal, not the app server's Linux shell) for the actual RouterOS-side error before assuming a server or network problem.
