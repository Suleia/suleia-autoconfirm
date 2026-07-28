# Daily connector read-only validation

Date: 2026-07-28

## Controls

- Default business-source transport accepts only `GET` and `HEAD`.
- `PUT`, `PATCH` and `DELETE` operations fail before network access.
- The only semantic `POST` reads are the exact allowlisted Dropea GraphQL
  query and GLS tracking lookup. Hosts, paths and request shapes are fixed.
- Pagination has bounded retries, repeated-cursor detection, maximum pages and
  runtime exhaustion controls.
- Shopify uses the REST Orders endpoint with the exact `created_at` interval.
- Chatby association requires an exact order reference and never uses name,
  telephone or address similarity.
- Dropea completed one read page and returned no orders created in the exact
  interval.
- GLS completed five tracking lookups without failures.
- The current-system login used an ephemeral cookie and its cache remained
  explicitly non-authoritative.

## Credential bootstrap

The existing Shopify shop domain and client credentials were recovered from
approved local configuration without logging their values. One exact OAuth
client-credentials `POST` issued an ephemeral token. This authentication call
did not read or modify orders. The other allowlisted non-GET requests were
semantic reads to Dropea and GLS plus current-system login.
The token existed only in memory and was cleared at process exit.

## Live result

- Shopify: complete, 1 page and 12 orders.
- Chatby: complete, 9 pages.
- Dropea: complete, 1 page, 0 interval records.
- GLS: complete, 5 tracking records.
- Current-system cache: consultable, 1 page, 12 records.
- Orders outside the interval: 0.
- Business-source writes: 0.
- Operational actions: 0.
