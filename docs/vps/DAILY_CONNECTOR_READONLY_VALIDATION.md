# Daily connector read-only validation

Date: 2026-07-27

## Controls verified

- A shared transport allowlists source hosts.
- Only `GET` and `HEAD` can reach the network.
- Requests with bodies are rejected.
- `POST`, `PUT`, `PATCH` and `DELETE` are rejected before `fetch`.
- Pagination detects repeated cursors, maximum pages and runtime exhaustion.
- Retries are bounded.
- Shopify uses the REST Orders endpoint with `created_at_min`,
  `created_at_max`, `status=any` and cursor pagination.
- Chatby association uses exact order references, never name, phone or address.
- The current-system dashboard is marked non-authoritative for completeness.
- Dropea and GLS are marked unavailable because their existing reads require
  `POST`; the runner does not bypass this restriction.

## Live preview

The Render API was consulted using `GET` only. Only variable names and
presence were inspected during diagnosis; values were neither logged nor
persisted. The target service has Chatby credentials and Shopify client
credentials, but lacks the two values required by the GET-only Shopify reader:
an Admin access token and shop domain.

Result: `ABORTED / SHOPIFY_GET_CREDENTIALS_MISSING`.

No connector write method was called and no source payload was persisted.
