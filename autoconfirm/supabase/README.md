# Suleia Supabase setup

Supabase is used as the central memory for Suleia Command Center.

The current app keeps JSON files as a local safety backup, and mirrors the important data to Supabase when these Render variables are configured:

- `SUPABASE_ENABLED=true`
- `SUPABASE_URL=https://YOUR_PROJECT.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY=...`
- `SUPABASE_SCHEMA=public`

Setup:

Automatic setup:

1. Generate a Supabase Personal Access Token in the Supabase dashboard.
2. Run `npm run supabase:setup-project` with `SUPABASE_ACCESS_TOKEN` and `RENDER_API_KEY` in the environment.
3. The setup tool creates the Supabase project, runs `supabase/schema.sql`, adds Render variables, deploys Render and launches `/api/cron/supabase-backfill`.

Manual fallback:

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
- Atomic WhatsApp template delivery ledger, preventing duplicate sends across deploys and concurrent events.
- Meta campaign insight snapshots.

On startup, Render restores orders, runtime state, operational caches, feedback and learned agent memory from Supabase. Local JSON files remain only as a fast operational cache and emergency fallback.
