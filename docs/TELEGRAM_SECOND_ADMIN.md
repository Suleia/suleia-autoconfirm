# Second Telegram administrator: audit and staged identity verification

Status: prepared, not activated. Owner requested identification and a concrete
permission plan before any production authorization change. Personal account
IDs and identity evidence belong only in the protected operator report and
server audit, never in this repository or the Agent Hub.

## Current production facts, 2026-10-21

- The active VPS service is `suleia-telegram.service`, running the legacy
  `infrastructure/telegram-center` implementation. Its eight deployed modules
  match current main; the Ads V2/V3/V4 gateway is not deployed.
- `/etc/suleia/telegram.env`, root-owned mode 0600, contains
  `TELEGRAM_ALLOWED_USER_IDS`: a comma-separated list of positive numeric IDs.
  One administrator is configured. `loadConfig` rejects a username in this list.
  There is one uniform administrator capability set, no separate owner/editor
  role. Being first in the list does not confer an additional bot role.
- Every command/callback passes `Controller.authorized`: private chat, human
  sender, `chat.id === from.id`, and numeric sender ID in the list. A username,
  display name or ID written inside text cannot pass that check.
- Telegram `getMe` verified the pinned bot and `getChat` verified the existing
  administrator. No webhook is active. Polling health is READ_ONLY.
- `META_WRITES_ENABLED=false`, daily proposal ceiling EUR100, maximum change
  10 percent, confirmation TTL five minutes. No values were changed.
- `/var/lib/suleia-telegram/state.json` is private mode 0600 inside a mode 0700
  state directory. It holds offsets, proposals, conversation context and audit.
  Proposal ownership and conversational context are bound to numeric user/chat.
  Event codes resolve to the actor in durable proposals; EXECUTING also records
  the user directly. Do not clear this state or recycle another user's proposal.
- Unknown senders are silently discarded without retaining their identity.
  There is no trustworthy retained candidate identity. No update queue was read
  during the audit. No Telegram messages were sent.
- The deployed help/dispatcher supports Meta reads and simulated proposals.
  Neither it nor the provider's current command/menu configuration exposes a
  commercial panel or Web App. Web-panel OAuth is a separate access surface;
  adding a Telegram ID does not grant web, SSH, database or Meta Business access.

## Exact equivalent permissions being prepared

Both numeric IDs would pass the same existing allowlist gate:

| Function | Same behavior for each administrator |
| --- | --- |
| `/resumen`, `/meta` | Read Meta reports for supported dates |
| `/campanas`, `/analizar` | Read campaigns, budgets and period comparisons |
| `/presupuesto`, `/pausar` | Create a proposal, with writes off: simulation only |
| `/confirmar`, `/cancelar`, natural-language confirmations | Own private-chat proposals only; five-minute expiry |
| `/reconciliar` | Read provider state for own uncertain proposal; never resend |
| `/historial`, `/estado`, help | Shared action history and bot status |
| Commercial panel | Unavailable through the deployed bot for either account; not an authorization failure |

Global spending controls, fresh provider checks, durable execution claims,
uncertain-result blocking and API-level writes-off enforcement remain shared.
One administrator must never confirm the other's proposal. Existing behavior
does not include per-person financial caps; the same global limits apply.

## Verification-only helper

`infrastructure/telegram-center/admin-link.mjs` is an operator helper, not a
new permission store or a background consumer. Nothing imports it into the
running service. It cannot change environment/state, grant/revoke access,
send messages, call Meta, stop/restart services or advance the polling offset.
There is deliberately no `apply` command.

It prepares a 192-bit random, ten-minute challenge bound to the pinned bot,
one existing numeric administrator, target username and current policy/list.
The challenge only proves identity; knowledge of it never confers access.
Private request/proof files must be root-owned 0600 outside Git. `prepare`
prints only a request ID/path; instructions containing the challenge stay in
the protected file. Never post those instructions or raw updates in GitHub.

Two fresh, unforwarded private messages are mandatory:

1. The already allowlisted administrator sends the exact challenge consent
   from the private request file, using their existing account. This approves
   identification only, not the future access grant.
2. The candidate opens the private deep link from that file and presses Start
   using their own account. Telegram must deliver that account's numeric
   `message.from.id`, matching `chat.id`, and the expected `from.username`.

The helper also re-reads Telegram `getChat(numeric_id)` to confirm the private
chat's current username and `getMe` to pin bot identity. Username comparison is
only a cross-check on a provider-delivered numeric ID. Forwarded/edited/group/
callback/bot messages, old messages, other admins' consents, changed policy,
multiple candidate IDs, expired challenges and mismatched readback fail closed.
No message bodies or unrelated senders are retained in the resulting proof.

Telegram does not support resolving a private person using `getChat(@username)`;
its username form is for a supergroup/channel. Do not use third-party ID lookup
sites or treat a typed ID, screenshot or display name as completed verification.

## Approved maintenance sequence — NOT executed in preparation

The helper's collector must never compete with the active poller. Obtain the
owner's explicit authorization for a brief **identification-only polling pause**
before executing this sequence. This is separate from approving the final
second-administrator grant. Do not deploy Ads features or change bot code to
perform this check.

1. Review the published helper/test revision. Stage only this helper beside
   copies of the live `config.mjs` and `api.mjs` in a private operator directory,
   without changing `/opt/suleia-telegram` or the active release symlink.
   Use a root-owned mode 0700 directory such as `/root/suleia-admin-link`.
   Check service health, unchanged allowed IDs, writes-off and limits.
2. Run the existing Node 22 runtime as root with `admin-link.mjs prepare`,
   `--username <expected_username>`, `--owner-id <existing_numeric_id>` and
   `--request /root/suleia-admin-link/request.json`. The default env file is
   `/etc/suleia/telegram.env`; secrets are loaded privately, never in arguments.
   Open the instructions privately with the owner and share the candidate's
   expiring deep link with that person through a channel the owner trusts.
   Do not have either person send the challenge messages before the pause.
3. In the authorized maintenance session, arrange unconditional restoration
   of the existing service on success, timeout, failure or user cancellation.
   Gracefully stop only `suleia-telegram.service` and wait until inactive with
   no existing `process.lock`. Do not remove a stale lock without proving no
   process owns it. Other services/timers remain untouched.
4. While polling is paused, have both people send the two exact private
   messages. Run `admin-link.mjs collect --request <private_request_path>
   --output <new_private_proof_path>`. The helper independently checks inactive
   systemd state twice, takes the same exclusive process lock, verifies the
   existing bot/state identity and reads one batch at the unchanged durable
   offset. It refuses an active webhook. It never acknowledges a later offset,
   drops pending updates or saves the bot state; its temporary lock is released
   in `finally`. The bot state bytes are checked unchanged after the read.
5. A waiting result grants nothing. A repeat read uses the same saved offset;
   never increment it to search. If messages are missing, the first 100 updates
   are insufficient, the challenge expires or there is any uncertainty, restore
   the service and arrange a new session. Do not keep the bot paused waiting for
   this chat to answer. Limit the planned pause to three minutes.
6. Always restore the unchanged existing service and verify READ_ONLY health
   and ownership of the polling process. Pending updates remain for that process.
   The candidate still has no access; the existing admin's unknown verification
   command can only receive ordinary help, not execute a campaign operation.
7. Inspect the private proof. Present the candidate's verified numeric ID,
   username, verification time, consenting existing numeric administrator,
   exact before/after list, permission table and limits to the owner in the
   private chat. Ask explicitly whether to append **that exact ID**. Do not
   treat the earlier consent to identification as activation approval.

No maintenance pause or identity request has been activated by this preparation.

## Future addition — requires separate exact-ID approval

After identity verification and explicit owner approval:

1. Recheck the protected proof, current policy, source revision and list.
   The plan must still be current; obtain a new challenge if expired and
   recheck `getChat` before the write. Record the owner approval reference
   privately. Never put an ID or approval conversation in a commit/issue.
2. Gracefully stop only this bot; preserve the whole state and offset. Privately
   back up the environment mode 0600. Through the existing `Store` lock/record
   API, record `ADMIN_ACCESS_CHANGE_PREPARED` with request ID, approving numeric
   actor, candidate numeric ID, exact before/after list, reason and timestamp.
   Close the store before restart; never edit live JSON alongside the consumer.
3. Atomically replace only the value of `TELEGRAM_ALLOWED_USER_IDS`, appending
   the verified ID. Preserve every existing ID, including the original admin,
   and every other environment value and file ownership/mode. Validate the
   staged environment through existing `loadConfig`; compare every unrelated
   value privately (never print secrets or their values). No bot token rotation,
   write enablement, API/Ads flag activation or panel role change is allowed.
4. Start the same release and verify health/config. In a controlled stop/start
   using the same Store API, record `ADMIN_ACCESS_GRANTED` only after successful
   readback, or `ADMIN_ACCESS_CHANGE_FAILED` if not verified. Journal entries
   include request, approving actor and target ID. Preserve past proposals/audit.
5. Both people independently initiate `/estado`, `/resumen hoy`, `/campanas`
   and `/analizar`. Each creates a distinct bounded proposal, confirms it as
   simulation, and checks history. Correlate the event code to its numeric
   proposal owner in private state. Confirm no Meta mutation and no cross-user
   confirmation, group access or unknown-user access. Do not impersonate a
   Telegram account or claim a successful real message path from unit tests.
6. Commercial-panel access remains explicitly **not verified / unavailable in
   this deployed bot**. Do not silently deploy the pending Ads PRs or provision
   a web administrator to make that line pass. A separate requested/reviewed
   feature/access change is needed if the owner wants it available via Telegram.

## Revocation and rollback

Revocation uses the same single allowlist: after an owner request, remove only
the added numeric ID, preserve the original/current other admins and all global
controls, record `ADMIN_ACCESS_REVOKED` with approving actor/target/reason using
the same private Store API, and restart only the bot. Verify the revoked ID is
rejected, the original admin still succeeds and polling is healthy. Preserve
audit/history. A revoked user's saved proposals cannot be confirmed through
the bot because the existing authorization gate runs first; review unresolved
actions separately without retries. Do not later re-add an ID with old pending
proposals without checking expiry and current identity.

On a failed addition, restore only the previous allowlist value; do not replace
unrelated settings from a stale backup. Log failure/rollback privately and
verify the original admin. There is no need to rotate the bot token, replace
accounts, expose a port or make any repository public.

## Validation

`node --test infrastructure/telegram-center/center.test.mjs infrastructure/telegram-center/admin-link.test.mjs`

The tests use fictitious accounts and mocked Telegram/Meta. They cover secure
identity negatives, bot/username readback, explicit owner consent, expiration,
policy drift, non-advancing collection, equivalent existing commands, isolated
proposals, shared limits, simulation/idempotency, actor correlation and removal
from the existing allowlist. They do not establish the real candidate's ID.

References: [Telegram getChat](https://core.telegram.org/bots/api#getchat),
[updates and offsets](https://core.telegram.org/bots/api#getupdates),
[deep linking](https://core.telegram.org/bots/features#deep-linking).
