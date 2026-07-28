# Decision log

## D-009: Abort daily simulation without an authoritative GET-only Shopify source

Date: 2026-07-27

The all-orders-today batch must not use the current-system cache as a substitute
for Shopify completeness. The production Render service has Shopify client
credentials, but no Admin access token or shop domain available to the
read-only runner. Exchanging those credentials would require a prohibited
`POST`.

The preview therefore stops with `SHOPIFY_GET_CREDENTIALS_MISSING`. Chatby,
Dropea, GLS and current-system reads do not continue after this authoritative
source failure. No report with misleading zero counts is generated.

This decision preserves the checkpoint invariants:

- external writes remain impossible;
- no raw payload or PII is persisted;
- incomplete pagination is never presented as complete;
- `ACTIONS_EXECUTED=0`;
- `PII_PERSISTED_COUNT=0`.

## D-010: Allow one exact in-memory Shopify OAuth exchange

Date: 2026-07-28

The owner confirmed that the existing Shopify application credentials and shop
domain should be recovered and used to continue the private-VPS checkpoint.

The runner may perform one `POST` only to the allowlisted Shopify OAuth
client-credentials endpoint. The resulting access token is kept only in
process memory and cleared at exit. All order reads continue through the
method-enforced GET-only connector.

This narrow authentication exception does not authorize Shopify mutations,
Dropea or GLS POST queries, production actions, messages or raw-data
persistence.

## D-011: Authorize constrained Dropea and GLS semantic reads

Date: 2026-07-28

The owner authorized the existing Dropea GraphQL and GLS tracking operations
strictly for reading. Their HTTPS hosts, paths and body shapes are allowlisted;
no mutation, customer action, template delivery or logistics change is
permitted.

The current-system login endpoint may exchange the managed dashboard password
for an in-memory session cookie followed by a single GET read. Exact identities
may include explicit Dropea-tag references from Shopify, but fuzzy matching on
customer data remains forbidden.

## D-012: Separate customer intent from carrier evidence

Date: 2026-07-28

Return-to-origin and agency-pickup decisions require independent, current
evidence domains. Customer preference cannot manufacture a carrier state, and
carrier history cannot manufacture customer intent. A newer incompatible event
is recorded as a conflict and routes to human review without action.

## D-013: A current explicit return blocks commercial recovery

Date: 2026-07-28

When the latest explicit customer intent is `RETURN`, discount and
commercial-recovery proposals are disabled. If current carrier evidence also
reports `SHIPMENT_NOT_ACCEPTED`, the simulator selects
`RETURN_TO_ORIGIN`. Missing or contradictory carrier evidence produces
`NO_ACTION / HUMAN_REVIEW`.
