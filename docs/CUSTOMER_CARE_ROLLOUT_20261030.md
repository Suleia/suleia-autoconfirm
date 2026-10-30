# Customer Care rollout — 2026-10-30

## Delivered architecture and scope

See [CUSTOMER_CARE_AGENT.md](CUSTOMER_CARE_AGENT.md) for the architecture, ownership
map, case/intent/slot schemas, policy router, missing-slot logic, payment wording,
context accumulation, latest-intent rule, stale-plan guard, metrics and rollback.
Customer Care interprets and delegates; it does not own existing operational
writers. It is deterministic, with no external model usage or API spending.

Published changes:

- PR178: exact live Render baseline a844f24 → de40d19; isolated memory/observer.
- PR179: exact VPS worker baseline3ad9a8f → ae1cf00; gated clarification adapter,
  prepared for the existing sender. **Not activated in production**.
- PR180: actual static panel baseline dc714f6 → dbaaef7; sanitized read-only card
  and additive local JSON projection. No SQL migration or new access grants.

## Validation

- Original backend regression: **822/822**, isolated Linux, no network/secrets.
- Final Render candidate: **861/861**, Node22.22.0, isolated Linux without network
  or production credentials, including Telegram and existing timer suites.
- Final VPS candidate: **692/692**, including existing retry, support,
  clarification, Telegram and timer suites in the same isolated Node22 runtime.
- Focused conversation/context regression: **38/38**.
- Actual panel/Render projection regression: **103/103**.
- All new fixtures are synthetic/sanitized. Customer transcripts and receipts
  remain in governed private runtime storage, never Git or public issue comments.
- Native Windows filesystem restrictions caused unrelated fsync/symlink failures;
  complete baseline and candidate runs were therefore performed in Linux.

## Read-only shadow replay

Fresh exact subscriber/order/active-issue reads, 19:37–19:39 UTC, initial830ec31
implementation. Later unknown-text/provenance/hash refinements were covered by
regression tests; these replay totals must not be relabelled as a fresh replay
ofde40d19:

| Measure | Result |
| --- | ---: |
| Cases reviewed / expected | 34 / 34 |
| Exact bindings verified | 34 |
| Same normalized decision | 17 |
| Improved clarification decision | 4 |
| Other routing differences requiring review | 13 |
| Fewer clarification opportunities | 4 |
| Wrong questions avoided | 4 |
| Changes of mind detected | 1 |
| Changed human-review route | 1 |
| Unverified context / read failures | 0 / 0 |
| Provider writes / new sends | 0 / 0 |

These are comparisons, not executed incident resolutions or evidence of achieved
resolution-rate targets. An initial provider rate limit was respected; no write
or forced incident cycle was used to recover the read.

## Production SHADOW

Render deployment dep-dbif88ou01pc73asu3rg was independently verified LIVE and
operational at 19:48:35 UTC, revision830ec31. All **147** pre-existing environment
variables were fingerprint-verified unchanged. Six new independent flags bring
the total to153: enabled/context true; clarification/status-reply/AI false;
modeSHADOW. The existing VPS incident timer remains active at :00/:30; no timer
or sender was added. The observer reuses the normal batch's already-read messages.

Follow-up deployment dep-dbifp6cipgvc73dl4ktg reached LIVE with exact revision
de40d1915fbc7be07c5c6827f01ce3a3d8d34199 after the previous incident invocation
finished. No environment variables were changed by this follow-up: all153 hashes
were independently compared. Its process responds with `ok:true` and the exact
revision. At20:27UTC its global `operational` status remained false because the
existing Chatby integration was rate-limited (HTTP429), not a successful provider
health check. Do not describe this as fully healthy or activate the new sender
while source freshness is unresolved.

The actual Operations panel serves the context card (HTTP200) and anonymous
incident API access remains401. Exactly two static files changed;47 other assets
were verified unchanged. The existing ingestion image was extended with only two
projection modules, preserving its deployed runtime patches. API, bot, Meta and
all other containers were retained; reader/panel environments and entrypoints
were independently verified unchanged. Private release copies and rollback
instructions are retained on the VPS.

The normal20:00UTC incident invocation completed at20:08:49UTC. It persisted
**33 SHADOW cases**,175 current-order inbound events, **zero observation errors**
and **zero Customer Care provider writes**. Its cohort includes49 historical
clarification messages and two historical repeated-question findings; these are
not new Customer Care sends or today's send count. One change of mind and two
human-review routes were observed. No new-layer autonomous resolution is claimed.

At20:18:45UTC the existing local SQL observation projection contained **33 exact
context cards**. The public static script returns200 and the protected incident
API returns401 without login. The reader's later overall health was503 with an
explicit `CHATBY_MESSAGES_HTTP_429` and retry-not-before20:31:12UTC. Its running
container is not evidence of a complete source synchronization. Respect that
backoff; do not force another scan or retry customer writes.

## Canary and remaining risks

- **No Customer Care canary or global LIVE messaging is claimed.** The existing
  VPS clarification sender remains on its original revision until the separately
  gated adapter can be admitted for a naturally eligible exact case. No customer
  input or duplicate message is fabricated to obtain a canary.
- Protected workflows keep their existing policy/capability gates. The older
  reply-release gate already did not match a844f24 before this rollout; it also
  does not match830ec31. This pre-existing block is not silently lifted.
- A delegation may still be blocked by that existing owner's policy or missing
  provider contract. It is not evidence of an action being requested or applied.
- Payment methods and product/usage answers require verified source contracts;
  unsupported nuances escalate instead of generating unverified prose.
- Natural shadow persistence and the sanitized panel projection are verified;
  complete reader/provider health and a naturally eligible canary remain pending.
- Browser visual validation was not performed under the repository prohibition;
  DOM/render/privacy tests and actual served-asset checks were performed.

Rollback disables the independent Customer Care flags and redeploys the verified
predecessor where needed, leaving every case history, claim and evidence intact.
The panel/reader rollback script restores their exact prior image/static mount
without recreating API, bot, campaigns, importers or unrelated services.
