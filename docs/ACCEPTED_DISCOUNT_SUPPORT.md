# Accepted-discount support workflow

The separate worker requests the accepted COD reduction by email, verifies the sent message and actual attachment bytes, and only then provides the incident delivery solution. Email submission is not evidence that the carrier has changed the collectable amount.

The existing notification, offer and return workflows are unchanged. This worker reads the current incident cache, then re-reads Dropea and the exactly correlated Chatby conversation before each external step. It requires a verified offer ledger with original/final amounts and the latest customer's explicit acceptance. It waits one hour after acceptance and excludes acceptances before its activation timestamp. A changed amount, pickup arrangement, return, contradictory/ambiguous response, missing original offer or unverified identity blocks execution.

One durable claim per order covers reopened incidents and restarts. Unknown results require reconciliation; they are never resent blindly. Evidence images are genuine authenticated Chatby screenshots with visible offer, acceptance, phone, date and time. The email uses each order's recorded original amount minus exactly 500 cents, reconciled with the offered amount. No customer details, captures or credentials belong in this repository.

## Required private connections

Set secrets in Render's environment or an approved secret manager, never in a chat, repository, screenshot, command argument or log:

- `DISCOUNT_GMAIL_CLIENT_ID`, `DISCOUNT_GMAIL_CLIENT_SECRET`, `DISCOUNT_GMAIL_REFRESH_TOKEN`: owner-authorized offline OAuth connection, with Gmail send and read permissions. The connector used by the desktop assistant does not transfer its credentials to Render.
- `DISCOUNT_GMAIL_FROM`: authorized mailbox; the worker checks Gmail's profile before sending.
- `DISCOUNT_CHATBY_STORAGE_STATE`: dedicated authenticated Playwright storage state scoped only to Chatby. Provision via an owner login in the dedicated capture environment; do not export the operator's general browsing session. Expired sessions block capture.
- `DISCOUNT_CHATBY_URL`: the account's observed live-chat page URL on `https://app.chatby.io`.
- Either `DISCOUNT_BROWSER_CDP_URL`: private dedicated remote browser endpoint; or `DISCOUNT_BROWSER_EXECUTABLE`: installed Chromium executable in the server runtime. Installing playwright-core alone does not install Chromium or its operating-system dependencies. The browser must run independently of the operator's computer.
- `DISCOUNT_SUPPORT_DROPSHIPPER_ID`: expected issue owner; other owners are rejected.
- `DISCOUNT_SUPPORT_ACTIVATION_AT`: ISO timestamp defining the first authorized future acceptance.
- `DISCOUNT_SUPPORT_ENABLED`: `true` arms the periodic worker, but missing connections still prohibit execution. `false` disables it.

The server reports `acceptedDiscountSupport.enabled`, `ready`, `missing`, `lastRun` and `lastStatus`. Configuration presence is only a readiness prerequisite, not proof of live provider verification. The initial authenticated capture and sent-mail readback must be verified before claiming end-to-end operational success. A capture failing layout/date/identity checks must be investigated, not replaced with a reconstructed transcript image.

The production owner is the existing dedicated VPS worker, checking every 30 minutes. Do not enable a second support scheduler or sender in parallel. Existing emails, persisted claims and uncertain writes require reconciliation. The worker does not automatically migrate or replay historical acceptances. Solution verification confirms the exact issue/order and provider status; the provider's read contract may not expose the literal submitted note. Reconcile COD changes separately with support/provider evidence.

The dedicated VPS scheduler runs the existing support lane every 30 minutes.
An explicit acceptance after a verified return request may request carrier
recovery only when a fresh pending incident on the exact same tracking number
is still ERROR/DELIVERY_EXCEPTION, exposes PROVIDE_SOLUTION, and the acceptance
postdates the reopened incident. The original offer must be verified between
the prior incident's creation and its return request. The one-hour settling
period, unchanged original amount, exact five-euro reduction, fresh rereads,
screenshots, persistent per-order claim and sent-mail verification still apply.
The email and note explicitly request feasibility and confirmation of stopping
the return; they do not assert that the return or collectable amount changed.
Delivered, returning, cancelled, changed-shipment, agency and uncertain-return
cases stay blocked. A previous support receipt is never replayed.

An interrupted delivery solution keeps its journal until both provider state
and the exact persisted note are verified. Failed detail reads now refresh the
private report with a bounded reason instead of leaving an old report visible.

After a support email is verified, an uncertain solution is reconciled from
the original operation ID, sent-mail/attachment bytes, fresh exact customer
evidence and provider state. A definitive carrier rejection is displayed as
SUPPORT_SENT_PROVIDER_REJECTED with its bounded provider code and the expected
amount; it does not mean the incident is solved or COD is applied. No email or
solution is retried. A completed operation can update its original receipts
only after independent provider verification. Private receipts retain the
immutable original support plan for that readback; contacts never enter the
public feedback projection.

## VPS outcome reconciliation

The existing 30-minute VPS worker now re-reads a previously verified support case instead of reporting `ALREADY_VERIFIED` indefinitely. This observation has no email, solution, claim or financial writer. A different or reopened pending issue remains in human review: an old acceptance cannot authorize a new issue. Later customer corrections, ambiguous replies, uncertain shared claims, association failures and unavailable reads remain visible review reasons.

Only the fresh provider `raw.total_amount` and explicit `raw.currency === 'EUR'` can establish `ORDER_AMOUNT_DISCOUNT_VERIFIED` and `orderDiscountApplied: true` against the receipt's exact final cents. The normalizer's EUR default is not evidence. This verifies the order amount; `discountApplied` remains false and `carrierCodApplied` remains null because the parcel's collectable amount is not independently exposed by this contract.

The worker stores the contact-free observation in `app_state.accepted_discount_support_feedback_v1`. Its `cases` entries identify the current and originally supported issue, amount outcome, customer-response classification and review reason, without message text, phone, email, namespace, screenshots, message/mail identifiers or notes. Consumers must check each case's `checkedAt`, not only the aggregate update time. Pending cases with a previous support receipt remain eligible for observation after their response classification changes. At most ten verified receipts are re-read per cycle, rotating least recently checked first; existing new-send eligibility, the one-email batch bound and all persistent claims remain unchanged.

## Validation

Run `node --test --test-concurrency=1 autoconfirm/src/workflows/*.test.mjs autoconfirm/src/clients/dropea-v2*.test.mjs autoconfirm/src/clients/discount-support-gmail.test.mjs` from the repository root. Sequential execution avoids the existing shared local configuration-file initialization race on Windows.

Primary integration references: [Gmail sending](https://developers.google.com/workspace/gmail/api/guides/sending), [server-side OAuth](https://developers.google.com/workspace/gmail/api/auth/web-server), [Playwright browser installation](https://playwright.dev/docs/browsers). Runtime connection state and customer audit records remain private.
