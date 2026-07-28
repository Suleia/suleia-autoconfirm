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
