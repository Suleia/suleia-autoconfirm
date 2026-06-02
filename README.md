# Suleia AutoConfirm

Backend base for the Dropea + Chatby + Shopify + Google Sheets auto-confirmation system.

## What is included

- webhook receiver for Dropea
- poll and auto-confirm workflow shells
- Google Sheets sync layer
- OpenAI conversation classification
- OpenAI Assistant orchestration for Chatby + Dropea decisions
- Shopify payment verification helper
- file-based storage for the MVP

## What you still need to fill

- `DROPEA_API_KEY`
- `CHATBY_TOKEN`
- `OPENAI_API_KEY`
- `OPENAI_ASSISTANT_ID`
- `AUTO_POLL_ENABLED`
- `AUTO_POLL_INTERVAL_MINUTES`
- `GOOGLE_SHEET_ID`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
- optional Shopify credentials if you use non-COD verification

## Recommended start

1. Copy `.env.example` to `.env`.
2. Fill the secrets.
3. Run `npm start`.
4. Point Dropea webhooks to `/api/webhooks/dropea/:token`.
5. Keep `OPENAI_ASSISTANT_ENABLED=true` if you want the assistant to make the decision step.
6. Leave `AUTO_POLL_ENABLED=true` so the service keeps syncing new Dropea orders even if a webhook is missed.
7. Use `AGENT_ENABLED=true` to enable the assistant decision flow.
