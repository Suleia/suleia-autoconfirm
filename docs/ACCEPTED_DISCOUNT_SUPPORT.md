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

The scheduler checks every 15 minutes. Existing emails, persisted claims and uncertain writes require operator reconciliation. The worker does not automatically migrate or replay historical acceptances. Solution verification confirms the exact issue/order and provider status; the provider's read contract may not expose the literal submitted note. Reconcile COD changes separately with support/provider evidence.

## Validation

Run `node --test --test-concurrency=1 autoconfirm/src/workflows/*.test.mjs autoconfirm/src/clients/dropea-v2*.test.mjs autoconfirm/src/clients/discount-support-gmail.test.mjs` from the repository root. Sequential execution avoids the existing shared local configuration-file initialization race on Windows.

Primary integration references: [Gmail sending](https://developers.google.com/workspace/gmail/api/guides/sending), [server-side OAuth](https://developers.google.com/workspace/gmail/api/auth/web-server), [Playwright browser installation](https://playwright.dev/docs/browsers). Runtime connection state and customer audit records remain private.
