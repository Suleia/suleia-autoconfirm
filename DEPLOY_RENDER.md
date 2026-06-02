# Deploy to Render

## What this backend needs

- a public URL for Dropea webhooks
- environment variables from `.env`
- a hosting account on Render

## How to deploy

1. Push this folder to a Git repository.
2. Create a new Render Web Service.
3. Select the repository and the `autoconfirm/` folder.
4. Use the included `render.yaml` or Dockerfile.
5. Add the environment variables from `autoconfirm/.env`.
6. Deploy.

## After deploy

- Set the Dropea webhook URL to:
  `/api/webhooks/dropea/<webhookToken>`
- Keep `AGENT_DRY_RUN=true` at first.
- If you want the OpenAI Assistant to drive the decision step, set:
  - `OPENAI_ASSISTANT_ENABLED=true`
  - `OPENAI_ASSISTANT_ID=<your_assistant_id>`
- Keep `AUTO_POLL_ENABLED=true` so the service periodically syncs new orders to Google Sheets even if a webhook is missed.
- Set `AGENT_ENABLED=true` so the assistant decision flow is active.
