# Daily connector read-only validation

Date: 2026-07-28

## Controls

- Business-source transport accepts only `GET` and `HEAD`.
- Requests with bodies and all source `POST`, `PUT`, `PATCH` and `DELETE`
  operations fail before network access.
- Pagination has bounded retries, repeated-cursor detection, maximum pages and
  runtime exhaustion controls.
- Shopify uses the REST Orders endpoint with the exact `created_at` interval.
- Chatby association requires an exact order reference and never uses name,
  telephone or address similarity.
- Dropea and GLS remained blocked because their existing query integrations
  require `POST`.
- The current-system cache remained unavailable and was not treated as
  authoritative.

## Credential bootstrap

The existing Shopify shop domain and client credentials were recovered from
approved local configuration without logging their values. One exact OAuth
client-credentials `POST` issued an ephemeral token. This authentication call
did not read or modify orders and was the only non-GET request in the run.
The token existed only in memory and was cleared at process exit.

## Live result

- Shopify: complete, 1 page and 12 orders.
- Chatby: complete, 9 pages.
- Orders outside the interval: 0.
- Business-source writes: 0.
- Operational actions: 0.
