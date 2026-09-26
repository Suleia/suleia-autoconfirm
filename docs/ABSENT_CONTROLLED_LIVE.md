# Controlled AUSENTE activation

The dedicated `recipient-absent-live-controller` authorizes Chatby native sends.
It never calls a template-send API. The initial deployment has no Dropea write
credential; `SOLUTION_PROVIDED` remains disabled until the verified callback
and resolution canary gates are met. Existing resolution executor logic is reused.

## Credentials and permissions

`provision-absent-controller.py` transfers only Chatby API token, HMAC identity
key, one ES read-only Dropea store configuration and its referenced token from
the existing ingestion container into root-only `/opt/suleia-secrets/absent-native-gate.env`.
It creates a dedicated database login and random authorization token without
printing either. The script refuses to overwrite existing secrets.

Migration 046 grants only the read views/columns needed for exact-case evidence
and the native/resolution AUSENTE ledger tables. Runtime cannot change activation
flags, cutover times or evidence. A breaker forces native flags off. Restarting
does not close the breaker. No credentials belong in this repository.

Docker uses non-root image user, read-only root, no capabilities, no new privileges,
bounded CPU/memory/PIDs/logs, restart policy and an internal DB-backed healthcheck.
No host port is published. The public proxy must route only the exact authorization
endpoint; all requests require a high-entropy Bearer token. HTTP 201 is the sole
allow response. A global request limit and single in-flight authorization protect
provider quotas; rejected or uncertain requests never send a template.

The existing Docker networks do not provide a DNS destination egress allowlist.
Application transports constrain HTTPS destinations to Chatby and the validated
Dropea ES API, forbid redirects and do not accept arbitrary URLs in incoming
requests. PostgreSQL is internal. This is application enforcement, not a claim
of a network firewall. The container has no Docker socket or host filesystem access.

## Activation and rollback

Apply 046 as database operator, provision secrets once, then start the exact tested
image with `start-absent-controller.sh <40-character commit>`. It requires all
native switches OFF. Test authenticated OFF denial and unchanged ledger counts
before adding the Chatby route. Do not publish until reproducible rollback and
the exact HTTP 201 path have been checked.

Retain the pre-cutover API catalogs, screenshots, element 526887 configuration
and its destinations. Restore that exact node and routes in a draft and verify
before publication. The evidence mode is `REPRODUCIBLE_RESTORE`; never claim an
official complete graph export. Compare all 23 templates, subflow inventory and
unrelated visible configuration before/after.

Emergency stop: an operator sets native `automation_live=false` and
`native_send_enabled=false`, and resolution status `DISABLED`. Keep the native
authorization route in place so stopping the controller also denies sends.
Stopping/removing this dedicated container leaves the shared services untouched.
Do not restore unguarded v2 while claiming that the master switch is effective.

Post-cutover: CANARY status reserves a single new issue. Verify one v3, zero v2,
one +48h timer and an additional observation cycle before expanding. Only real
observed button mappings can enter the callback contract; a subset is supported.
The application must not manufacture callback evidence or auto-enable itself.

Native identity compatibility: the observed `ISSUE-Payload` contains the exact
order ID and incidence labels, but no issue ID; `Incidencia: Id` can be unset.
The adapter accepts that missing field only by selecting the single active,
pending CURRENT AUSENTE of the exact order. It then directly re-reads the provider
issue/order and exact Chatby conversation. An explicit issue ID narrows the lookup;
zero/multiple matches or any mismatch deny. This does not classify queue hints as
verified delivery attempts or bypass FIRST/SECOND, cutover or prior-notice gates.

## Canary closure observability

The existing 120-second observer exposes last completion, lag and failures through
the DB-backed health endpoint. The existing runtime collector includes the dedicated
container by exact name (not its stopped backups), its immutable image ID, revision,
restart count, both independent breakers and durable counts. A resolution breaker
does not disable native notification; it denies the resolution executor before POST.
The existing collector also reports an orders-poll alert after more than 20 minutes
without a successful current poll. Business-event age is not the alert criterion.
No additional scheduler is installed and ingestion environment is preserved.

The resolution worker uses the same ephemeral AUSENTE evidence projector as the
controller, not the shared ingestion writer. A POST timeout is followed by a direct
GET, never another POST. Dropea does not echo the instruction text, so an uncertain
POST plus a resolved issue is retained for reconciliation with the resolution breaker
open; it is not falsely attributed to our instruction. Writer credentials remain
exclusive to the separate writer after real notification/timer/callback gates.

Each successful notice observation records a durable cycle counter. Require the
initial verification plus at least two later 120-second cycles before expansion.
The private panel projects verified native notices and their exact-message timers
independently of shadow proposals; no callback is labelled verified by that fact alone.

On 26 September the owner explicitly authorized one verified second-absence
notification canary. Only CANARY control with a preselected matching issue and
operator-written `second_absence_canary_authorized=true` plus the same exact
`second_absence_canary_issue_id` permits it. UNKNOWN, other issues, prior notices,
stale identity and normal LIVE second absences remain denied. This exception does
not enable any logistics write, pickup or return.
