---
name: Playwright Chromium on Nix
description: Browser E2E tests need Chromium runtime libraries declared separately from the downloaded Playwright browser.
---

When adding or upgrading Playwright browser testing, ensure its Chromium shared-library runtime is declared through the Replit system dependency configuration.

**Why:** Playwright downloads the browser binary, but the Nix environment does not automatically provide every dynamically linked browser library. The first test run can fail before tests execute with a missing shared-library error.

**How to apply:** After adding browser tests, run the focused Playwright suite in this environment. If Chromium cannot launch, add the missing runtime libraries through the package-management flow and keep the resulting system dependency declaration committed.