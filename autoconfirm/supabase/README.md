# Suleia Supabase setup

Supabase is used as the central memory for Suleia Command Center.

The current app keeps JSON files as a local safety backup, and mirrors the important data to Supabase when these Render variables are configured:

- `SUPABASE_ENABLED=true`
- `SUPABASE_URL=https://YOUR_PROJECT.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY=...`
- `SUPABASE_SCHEMA=public`

Setup:

1. Create a Supabase project.
2. Open SQL Editor.
3. Run `autoconfirm/supabase/schema.sql`.
4. Add the variables above to Render.
5. Redeploy Render.
6. Run `POST /api/cron/supabase-backfill` with the same bearer token used for cron endpoints.

The service role key must stay only in Render or trusted local scripts. Never put it in Shopify, browser JavaScript, or public files.

What is mirrored:

- Orders and agent decisions.
- Operational pending orders.
- Pending incidents and proposed actions.
- Feedback and learned rules.
- Telegram bot interactions.
- Webhook dedupe events.
- Meta campaign insight snapshots.
