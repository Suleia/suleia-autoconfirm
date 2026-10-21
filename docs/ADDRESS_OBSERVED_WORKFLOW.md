# ADDRESS_INCORRECT observed workflow

Initial sender remains Chatby native. Catalog: `dropea_incidencia_direccion_v1`,
locale `es_ES`, Chatby1472497, Meta3109078812596009, APPROVED.
This change never sends, edits or republishes that initial template.
Direction node and automatic reply ownership need read-only Chatby inspection.

T0 requires the exact structured template name, outbound wamid and timestamp
after the exact incident opened, in the exact associated order conversation.
There is no issue-date fallback. The 5 EUR offer is due at 24 hours and remains
recoverable when a previous cycle missed it, including after 48 hours. A silent
return proposal requires a verified offer and waits until the later of initial
notice +48 hours and actual offer +24 hours. Without a verified offer there is no
silent-return deadline. Explicit customer return requests keep their own path.
Each write rereads current provider issue/order and Chatby. Claims use existing
durable message/address/return ledgers. Late cooperative input supersedes return.

Owner clarification: incomplete address waits for details, then manual review.
It never becomes initial-timer silence, regardless of elapsed time. Missing-field
text is allowed only inside the24h customer reply window; outside that window it
is manual. No approved template is changed to reopen the reply window.
An isolated greeting does not erase an earlier address; ambiguity requires review.
Accepted discounts leave this address executor as `MANUAL_DISCOUNT_RECOVERY`.
The separately authorized accepted-discount support workflow owns any support
email and matching solution; sending an offer does not change the COD amount.

Policy revision `2026-10-21.1` changes offer/return timing and its registry hash.
Deployments must register the new policy hash and exact tested release gate;
existing RETURN modes, breakers, claims and independent authorization remain.
Fresh capability execution also binds the policy and decision hashes, so a
decision from an older policy or a crossed deadline cannot reserve an action.

New execution defaults to SHADOW. Master `ADDRESS_AUTOMATION_ENABLED=true` plus
`ADDRESS_{SOLUTION,OFFER,RETURN,DETAILS}_MODE=CANARY` requires the corresponding
`ADDRESS_*_CANARY_ISSUE_ID` exact match. LIVE is a distinct explicit stage mode.
`ADDRESS_*_BREAKER=OPEN` stops that action. Other workflow switches are preserved.
Do not promote a stage based on another stage's canary.

Solution contract: official V2 POST issues/{id}/resolve, status RESOLVED,
resolution_status SOLUTION_PROVIDED, resolution_note at most500characters.
The note is request-only, so verification checks exact issue/order/status and
stores the submitted note's hash rather than claiming a readback of its text.
Uncertain writes are not blindly repeated. Solution claims requiring later
reconciliation remain manual; the return lane uses existing verification.

Validation:325 tests passed at the initial implementation checkpoint, including
late partial reply after return reservation, partial-then-silent at24h/48h/30days,
complete address at2h/30h/47h59, explicit return, agency review, exact correlation,
unknown dates, deduplication, persistent claim failures and provider timeouts.
No actual new address action has been executed at this checkpoint.

Rollback: disable ADDRESS_AUTOMATION_ENABLED first, preserve ledgers, then deploy
the previous Render revision e1ad8b93ed4ad1023ff3762acca7e95136751792. Never clear
claims to retry an uncertain write. This document does not certify LIVE activation.
