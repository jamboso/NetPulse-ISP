---
name: Notification settings encryption
description: Encryption and migration rules for notification-channel configuration stored by the application.
---

Notification channel values are encrypted before being persisted and the API must complete the legacy plaintext migration before it accepts traffic.

**Why:** Continuing after a failed migration leaves previously saved Slack or SMTP values in plaintext, which defeats the at-rest protection promised by the settings UI.

**How to apply:** Keep the startup migration fail-closed for notification encryption errors. Background or best-effort migrations may not replace this prerequisite; logging must never include the migrated values.