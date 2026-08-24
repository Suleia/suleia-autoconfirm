# Telegram audit

The existing bot is implemented in the historical Render application. It authenticates with `TELEGRAM_BOT_TOKEN`, receives updates through an HTTPS webhook, and restricts operators by configured usernames (and optionally chat IDs). The webhook secret currently falls back to the existing cron secret when a dedicated Telegram webhook secret is absent.

Read-only checks on 2026-08-22 confirmed:

- `getMe` succeeded;
- a webhook is configured;
- pending updates: 0;
- no last webhook error was present;
- allowed usernames are configured;
- no dedicated allowed chat ID is configured.

No Telegram message was sent. META-4 must reuse the same bot identity but isolate destination configuration and sending code from the order Telegram workflow. A dedicated destination allowlist and webhook secret are required before deployment. Normal hourly HOLD results must not generate messages.
