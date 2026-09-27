# Incremental ADDRESS activation

The Render incident owner reserves one real case per capability using a CAS in
the existing Supabase `app_state`. The existing delivery ledger persists the
pre-write decision, policy hash, identity, provider outcome and promotion proof.
Existing Chatby/Dropea clients and action claims remain the only senders.

Recovery capabilities start CANARY, not LIVE. Promotion requires a real verified
case, one intended write (zero for interpretation), exact identity, a closed
breaker and a tested release. Unknown results open only that capability's
persisted breaker; claims are never reset or blindly retried.

Required deployment controls:

- `ADDRESS_ACTIVATION_AT`: immutable UTC cutover for new issues only; configure
  before the first run initializes persistent capability state.
- `ADDRESS_REGRESSION_GATE_REVISION`: exact tested `RENDER_GIT_COMMIT`.
- `ADDRESS_POLICY_REGISTRY_HASH`: registered SHA-256 of the current policy.
- `ADDRESS_INTERPRETATION_MODE`, `ADDRESS_DETAILS_MODE`, `ADDRESS_CHANGE_MODE`,
  `ADDRESS_SOLUTION_MODE`, `ADDRESS_DISCOUNT_OFFER_MODE`: CANARY.
- Corresponding breakers CLOSED; master `ADDRESS_AUTOMATION_ENABLED=true`.
- `ADDRESS_RETURN_MODE=SHADOW`, `ADDRESS_RETURN_BREAKER=OPEN`.
- `ADDRESS_PICKUP_MODE=SHADOW`, `ADDRESS_RETRY_MODE=SHADOW`.

RETURN cannot close its own breaker. Future authorized opening requires both
configured and persisted breaker changes, verified recovery canaries, a new
clean pending issue, exact fresh reads, no reply, T0+48h and RETURN permission.
Until then the existing return executor remains blocked for ADDRESS. Accepted
discounts remain manual, with no email or automatic economic application.

Issue 1309433 is hard excluded. Historic unknown cases are not reclassified.
Native initial templates and flows are unchanged. A partial response permanently
supersedes silence milestones; DETAILS requires T0+24h not yet reached.

Rollback: set recovery modes SHADOW (and RETURN remains SHADOW/OPEN), then deploy
the previous revision if required. Preserve persistent claims, breaker state,
cutover and audit records. A later release requires a new tested revision gate.

Validation: 353 backend tests, including simultaneous reservation, duplicate
claim, unknown provider outcome, late reply after claim, partial reply after
24h, cross-order checks, exact post-write order, fallback and isolated breakers.
