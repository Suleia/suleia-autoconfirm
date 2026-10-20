# Telegram Command Center on a VPS

Isolated Node 22 service reusing an existing Telegram bot and Meta account.
No external packages, inbound port, public webhook, LLM, customer data or
logistics actions. Existing order/incident automations remain separate.
The old Telegram logistics menu is not forwarded by this service: `/start`
lists the new campaign commands. Moving Telegram does not move Render's
other workloads. Keep Render running for its existing responsibilities.

## Features and boundaries

- Spanish phrases work without commands: "¿Cómo van las campañas hoy?",
  "Pon la campaña CollaGum a 35 euros al día", "Sube el presupuesto de
  CollaGum en 5 euros", "Baja el presupuesto de CollaGum un 10 %",
  "Pausa la campaña NIDA", "Sí, hazlo" and "No, cancela".
  The parser supports explicit immediate requests, not unrestricted conversation.
  Unrecognized wording asks for clarification; no LLM or API key is required.
- Campaigns resolve by exact name/ID or a unique name fragment. Multiple matches
  ask for a full name, ID or numbered selection; nothing is selected by performance.
  Relative amounts use the freshly read daily budget. "Esa"/"bájala" requires
  a recent unambiguous campaign reference. Selection context survives restart
  but expires after five minutes. A new change request supersedes prior proposals.
  Confirmation applies only to the one concrete pending proposal for that user/chat.
- Negations, conditional rules, batches and future schedules do not become
  changes. Old incoming messages cannot initiate actions after five minutes.
- Private chats and numeric sender IDs only; bot username and Meta account pinned.
- `/resumen` or `/meta` with `hoy`, `ayer`, `7d`, `30d` or two ISO dates (max 31 days).
- `/campanas`: all paginated campaign states and current campaign budgets.
- `/analizar`: factual comparison of the last 7 complete account-local days
  against the preceding 7. It does not invent efficiency targets or infer profit
  from attributed orders. No autonomous recommendations, alerts or schedules.
- `/presupuesto ID 35,00` and `/pausar ID` create proposals only. Confirm using
  inline buttons or `/confirmar CODE`; cancel using `/cancelar CODE`.
- EUR daily campaign budgets only. Ad-set budgets, lifetime budgets, creation,
  resuming campaigns and changing creatives are outside this version.
- Explicit budget cap and per-change percentage ceiling. Writes default off.
- Proposals created with writes off remain simulations even after a restart or
  later activation of writes. The API client independently blocks mutations
  whenever writes are disabled.
- Five-minute confirmation bound to sender/chat, fresh campaign ownership and
  configuration checks, durable execution claim and provider readback.
- Ambiguous writes are never retried; `/reconciliar CODE` only reads the provider.
  A mismatch leaves that campaign blocked for operator investigation. Reconciliation
  proves current state, not who changed it. Meta offers no compare-and-swap guarantee:
  a simultaneous human edit between precheck and write remains a race.
- Local durable proposals, action history and polling offset. Treat the state
  directory as private; back it up encrypted and monitor disk usage. History is
  deliberately not truncated. No raw Telegram messages or provider error bodies
  are logged. Unknown senders receive no response.

## Validate before migration

Run `node --test infrastructure/telegram-center/center.test.mjs`.
On the target host verify Node 22 on systemd's default PATH, `suleiaops`, systemd and disk
capacity. Choose a fixed source revision. No current host address, credentials
or production deployment is assumed by these files.

Using existing secrets in the server environment (never shell arguments), run:

```bash
node infrastructure/telegram-center/telegram-admin.mjs inspect
```

This reads `getMe` and `getWebhookInfo` and prints only bot identity, webhook
presence and pending count. Match the username against the owner's existing
bot in Telegram. A display name alone is not identity evidence.
Obtain the owner's numeric user ID through a trusted existing private bot log
or Telegram account export; never authorize an arbitrary first caller.

## Install and cut over

`sudo bash infrastructure/telegram-center/install.sh --install-only` performs
file installation steps 1–3 below using an atomic release symlink. It requires
the service account to exist and the service to be stopped, preserves an
existing environment file, and never starts/enables the bot or changes Telegram.
The installer verifies Node 22 on its PATH; verify the systemd service PATH too.

1. Copy this directory's `.mjs` files to `/opt/suleia-telegram`, owned by root
   and not writable by the service account. No npm installation is needed.
2. Provision `/etc/suleia/telegram.env` from `environment.example`, root-owned
   mode 0600. Reuse the existing bot secret from trusted server storage and
   the existing Meta credential; do not commit or paste either. Explicitly
   set bot username, numeric allowed IDs, account and API version. Start with
   `META_WRITES_ENABLED=false`. Select a daily cap for later use.
3. Install `suleia-telegram.service` in `/etc/systemd/system/`, then run
   `systemctl daemon-reload`. Do not start it yet. Store the current Render
   configuration privately for rollback. Inspect any other polling consumer
   and stop it. The VPS collector alone cannot prove Render or Telegram health.
4. Deploy the companion Render `TELEGRAM_OWNER` guards in this change, then
   set `TELEGRAM_OWNER=vps` in Render and verify the authenticated webhook setup
   route refuses registration. The old webhook route must also refuse processing.
   If that deployment cannot be verified, do not cut over. Do not disable Render
   itself; its existing logistics flows still need it.
5. With the server environment injected, run:

   ```bash
   node /opt/suleia-telegram/telegram-admin.mjs detach --previous-consumer-disabled
   ```

   This explicitly removes the existing webhook without discarding updates.
   Telegram does not allow `getUpdates` while a webhook is registered. No bot
   token rotation or new bot is needed. Retained old mutation commands cannot
   execute after five minutes; stale callbacks require an unexpired saved proposal.
6. Start once: `systemctl start suleia-telegram`. Its preflight verifies bot
   identity, no webhook, account metadata and campaign read access. It does not
   prove write permission. Inspect private `health.json` and service exit status.
7. The owner sends "hola", "estado del bot", "muéstrame las campañas",
   "resumen de ayer" and "compara las campañas" (commands also work).
   Verify an unauthorized sender/group causes no Meta calls or replies; tests
   cover these cases without contacting real people. Confirm a proposal with
   writes off: it must report simulation and leave Meta unchanged.
8. Only after the owner chooses cap/change limits and explicitly approves a
   specific production canary, enable `META_WRITES_ENABLED=true`, restart and
   execute that exact confirmed proposal. Check the bot's readback and Meta
   directly. Do not silently change account permissions or issue a trial write
   to discover permissions. When verified, enable service on boot:
   `systemctl enable suleia-telegram`.

The service reads its environment via systemd; do not `source` untrusted files
or put secrets into interactive history. For preflight-only execution use
`service.mjs --check` with the same injected environment while the main service
is stopped. It takes the same state lock, verifies reads, and sends no messages.

## Operations and recovery

- `node /opt/suleia-telegram/service.mjs --healthcheck` returns nonzero if local
  health is failed or older than two minutes. It needs only `STATE_DIRECTORY`.
  Connect this local check to existing host monitoring. A preflight-only check
  is not proof that polling is running.
- Restart preserves offsets and proposals. Graceful shutdown releases the process
  lock. A crash or SIGKILL deliberately leaves `process.lock` behind: stop the
  unit, prove no process owns that state directory, back up state, then remove
  only the lock before restarting. Never delete `state.json` to fix a lock.
- Health includes a durable count and timestamp of authorized messages successfully
  answered, without retaining their text or sender identifiers in health output.
  Check these alongside an owner-confirmed reply to verify the live message path.
- EXECUTING/UNKNOWN actions survive restarts and block further actions for that
  campaign. Use `/reconciliar` to read back. A persistent mismatch requires a
  private operator investigation; do not rewrite the journal to resend blindly.
- Missing previously initialized state, malformed JSON, a second process,
  a different bot/account and an active webhook fail closed.
- A successful provider write plus failed Telegram reply does not resend the
  write. Poll replay encounters the saved terminal proposal state.
- Long polling makes outbound HTTPS connections to Telegram and Meta only.
  It takes up to one polling/request interval to stop. HTTP 409 indicates a
  competing consumer and stops the service. Rate limits back off; mutations
  never retry. Review private health on failure, not raw URLs or tokens.

## Rollback

1. Stop and disable `suleia-telegram`; preserve the entire state directory.
2. Check any EXECUTING/UNKNOWN action directly in Meta; stopping the bot does
   not undo a campaign change. Never automatically restore previous budgets.
3. Restore `TELEGRAM_OWNER=render` on Render and verify deployment. Using the
   existing authenticated `/api/telegram/setup-webhook` setup flow, register
   its webhook and original secret. No pending updates are discarded.
4. Verify `getWebhookInfo` and an owner-initiated `/start` in the legacy bot.
   Do not run polling and webhook consumers simultaneously. The new campaign
   commands disappear on rollback; unrelated automations remain running.

References: https://core.telegram.org/bots/api#getupdates,
https://core.telegram.org/bots/api#getwebhookinfo,
https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-group/.
