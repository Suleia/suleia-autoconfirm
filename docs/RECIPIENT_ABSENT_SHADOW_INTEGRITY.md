# AUSENTE — integridad de evidencia y decisiones SHADOW

Scope: RECIPIENT_ABSENT only. No live sends, logistics mutations, incident
auto-closes, timer cancellations or additional reminder deadlines. Financial
calculations and all non-AUSENTE customer workflows remain unchanged.

## Root causes and implementation

1. An incident changing primary type retained `absent_shadow`, violating the
   `absent_shadow_only_check` constraint and stopping ingestion. The additive
   current projection is cleared only when primary type leaves AUSENTE;
   append-only history is preserved. This does not close an incident.
2. The shared three-conversation budget competed with unrelated incidents.
   Separate mutually exclusive read phases, one charge per exact conversation,
   bounded fair reads, 120s conversation/240s subscriber caches and verified
   head-overlap incremental history prevent ordinary AUSENTE starvation.
   Cached observations retain their actual timestamp. Unread never means silent.
3. GLS ES second absence requires structured attempt evidence, or the locally
   corroborated conjunction of code -30/14, substatus 15 and the explicit second
   absence description. This is not a universal GLS code definition. Distinct
   verified same-order history follows; incomplete evidence remains UNKNOWN.
4. GPS/address-not-located descriptions route to address resolution instead of
   preparing a normal absent-customer template.
5. Wait requires a real ACTIVE response timer with verified start and exactly
   48 hours. Missing timers produce an explicit conditional requirement.
6. Registry tables were empty and old simulations lacked policy/input hashes.
   Migration 037 adds an assigned, checksummed SHADOW policy, immutable
   idempotent snapshots/supersession and a current-input-bound private view.
7. Global name masking incorrectly masked technical `template_name` and
   scalarized nested shadow metadata. Only technical name fields are exempt;
   customer identities remain masked and private text remains encrypted.
8. Contact/wait inherited operational carrier prerequisites. Requirements now
   depend on the phase. Dropea options are declarations, never proof of a GLS
   slot, agency custody, package operability or retention deadline.
9. The database's original private-message vocabulary rejected the fail-closed
   NOTIFICATION_NOT_OBSERVED/BEFORE_NOTIFICATION states already emitted by the
   notification-boundary reader. Migration 038 adds exactly those two enum
   values; it does not remove the constraint or treat these as notified replies.
   Existing encrypted messages and all unrelated safety constraints are kept.

## Policy and timer ownership

`RECIPIENT_ABSENT_POLICY_V1`, mode SHADOW, checksum
`44db5838092fdbe97de0554e8210a2b0f8cf7d81cff1199f44007cfbdc74cadd`.
The ingestion worker's isolated absence phase owns internal decision projection
and new shadow response timers. There is no deployed independent timer engine;
the existing scheduler/decision-engine placeholders are not described as live
executors. A partial unique index prevents multiple new V1 response timers for
one incident. Pre-existing timer rows are never updated or deleted.

Dropea: 600s; exact case Chatby read: 300s; tracking read: 900s. UNKNOWN is not
STALE and neither is FRESH. No thresholds were enlarged. Without observed
notification, an issue-created boundary may inform simulation only, labelled
`SHADOW_ISSUE_CREATED_ANCHOR_ONLY_NOT_NOTIFICATION`. It never proves notification.
Older lifecycle confirmations and other-order messages are excluded.

## Template and logistics

Catalogue lookup uses `submit:false`, validates exact v1 content roundtrip and
never edits/creates/re-submits a template. Approval gates a WOULD_SEND proposal;
it does not authorize a real send. Technical name: `dropea_ausente_v1` / es_ES.
Read-only Dropea order and official GLS tracking search are allowed. Tracking
does not expose documented slot acceptance, agency availability, operational
capability or retention: these stay UNKNOWN, with explicit reason codes.

## Verification and publication

`scripts/replay-recipient-absent-shadow.mjs` counts the actual population and
reuses the worker's SELECT-only canonical inputs with a collecting no-write
projector. It has no fixed 116-row assumption and no external action connector.
It reports all/active candidate rates, reason counts, attempt/address/customer
response distributions and zero real side effects.

`infrastructure/vps/deploy-absent-integrity.sh` publishes an exact isolated
commit to API/MCP/worker/panel, tests that new image without external network,
backs up private data, records migration checksum/commit, preserves existing
secrets/environment/mounts and unrelated container identities, and provides
scoped rollback. It does not publish main or deploy Render.

Final verification must compare actual image/container revisions, registry,
schema release, exact panel assets, current replay, autonomous cycles and every
pre-existing timer row. Test-source counts and stale runtime catalogues are not
substitutes for executed tests or live evidence. Current verification results
belong in a private owner report and a sanitized Agent Hub handoff.

## Remaining prerequisites for any future LIVE activation — not executed

Explicit owner authorization; fresh exactly correlated conversations; observed
notification; approved exact template; governed attempt evidence; documented
carrier operational capabilities, package custody/retention and applicable
calendar; idempotent action claim and post-action reconciliation. No remaining
UNKNOWN is replaced with a guessed value to improve candidate-rate metrics.
