# Incident process audit — 2026-10-16

## Confirmed faults and corrections

1. The VPS order-cycle caller retried a mutating POST after a 240-second timeout.
   Recent systemd logs contain repeated timeouts. A lost response does not establish
   that the provider action did not execute. The caller now makes one attempt with
   a bounded 600-second deadline; transport uncertainty fails explicitly. The
   service has a 650-second limit. Existing durable claims remain mandatory.
2. The caller recognized any `ok: true` substring as success and ignored stage
   errors. It now parses the top-level response and checks ingestion, Shopify,
   template, confirmation and operational refresh errors. Overlapping skipped
   cycles are reported as SKIP, never PASS. Only fixed stage names are logged;
   provider response bodies and credentials are never printed.
3. Retry follow-up checked only the original issue. A confirmed live example had
   a resolved RETRY issue followed by a new pending issue for the same order,
   but remained AWAITING_CARRIER. Discovery now uses the fresh incident cache;
   each different issue is read directly in Dropea, with exact order identity,
   active/pending status and a creation time after the original action required.
   Read failures are not evidence of delivery or a successful resolution. The
   follow-up issue ID is persisted for review. This path never submits an action.

## Observed production coverage

- Incident scheduler: every 30 minutes on VPS; latest sampled cycle reviewed 26
  incidents (20 rejected, five absent, one address). The browser retry owner was
  AUTO and reviewed 24 pending retry cases with zero eligible writes.
- Fourteen cases showed customer activity; eight were labelled actionable by
  the broad classifier. These counts do not mean eight provider-authorized
  resolutions: exact identity, current provider state, date and intent still apply.
- Discount offers and governed returns were enabled. One current order already
  had a verified return from another issue, correctly preventing a duplicate.
  Two no-response cases were still waiting for their existing 48-hour deadline.
- Accepted-discount support was configured but disabled. One current acceptance
  was waiting. The previous owner hold on this flow is preserved; no mail or
  discount change was claimed executed by this audit.
- Address interpretation/details were LIVE. Solution/change-address/offer were
  CANARY. Return was effectively SHADOW with an open breaker; pickup/retry were
  SHADOW. The current address case required provider reconciliation. These gates
  are not silently promoted by an infrastructure repair.
- The separate absent controller sent initial templates while its own resolution
  stage was disabled. This is distinct from the active Render/VPS resolution
  owners; enabling both could duplicate actions.

## Validation and deployment

Run Node tests for incident-browser and VPS infrastructure. Run
`python3 infrastructure/vps/test-render-cycle-response.py -v` on Linux; integration
tests use a stub curl and temporary files, never provider requests.

Install `validate-render-cycle-response.py` as
`/usr/local/libexec/suleia-render-cycle-response.py` before updating the runner.
Keep the existing environment file, secret values and timers. Install the runner
and service atomically while the unit is inactive, then reload systemd. Do not
replay an uncertain production request as part of deployment verification.

Package the two incident-browser follow-up modules with the existing browser
image/runtime revision. Preserve private state, sessions, evidence, limits and
network isolation. Before restart verify there is no in-flight save or cycle.
Verify the next actual cycle and read-only feedback against Dropea.

Rollback: restore the recorded prior runner/service and browser image. Preserve
all action journals, claims, evidence and private state. No business policy,
template content, confirmation rule or customer-facing action is changed here.
