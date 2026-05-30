# Suleia AutoConfirm

Backend base for the Dropea + Chatby + Shopify + Google Sheets auto-confirmation system.

## What is included

- webhook receiver for Dropea
- poll and auto-confirm workflow shells
- Google Sheets sync layer
- OpenAI conversation classification
- Shopify payment verification helper
- file-based storage for the MVP

## What you still need to fill

- `DROPEA_API_KEY`
- `CHATBY_TOKEN`
- `OPENAI_API_KEY`
- `GOOGLE_SHEET_ID`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
- optional Shopify credentials if you use non-COD verification

## Recommended start

1. Copy `.env.example` to `.env`.
2. Fill the secrets.
3. Run `npm start`.
4. Point Dropea webhooks to `/api/webhooks/dropea/:token`.
