# Today real masked simulation report

Date: 2026-07-28

Business timezone: `Europe/Madrid`

Batch status: `INCOMPLETE`

## Time boundary

- Local start: `2026-07-28T00:00:00`
- Local end, exclusive: `2026-07-29T00:00:00`
- UTC start: `2026-07-27T22:00:00.000Z`
- UTC end, exclusive: `2026-07-28T22:00:00.000Z`
- Order date field: `created_at`

## Results

- Source orders: 12
- Unique orders: 12
- Processed: 12
- Skipped: 0
- Failed: 0
- Masked: 12
- Simulated: 12
- Compared with current-system cache data: 3
- Route `BLOCKED`: 12
- Comparison `PARTIAL_MATCH`: 3
- Comparison `INSUFFICIENT_DATA`: 9
- Orders outside the interval: 0
- PII elements detected and redacted: 39
- `PII_PERSISTED_COUNT=0`
- `ACTIONS_EXECUTED=0`

The non-persistent preview found five orders with tracking, no reliably linked
Chatby conversation and no verified incident. These are aggregate counts only.

## Connector status

| Source | Status | Pagination |
| --- | --- | --- |
| Shopify | Complete, GET-only order reads | 1 page, 12 orders |
| Chatby | Complete subscriber pagination; no exact order-reference matches | 9 pages |
| Dropea | Complete allowlisted GraphQL read; no interval records | 1 page |
| GLS | Complete allowlisted tracking reads | 5 queries, 5 records |
| Current system | Consultable; cache explicitly non-authoritative | 1 page, 12 records |

The Shopify access token was issued once through the exact OAuth
client-credentials endpoint, held only in process memory and cleared after the
run. The current-system session was created through the exact login endpoint
and held only in memory. Shopify identities were linked only through explicit
Dropea-tagged technical references; fuzzy customer matching was not used. No
order, customer, template, incident or logistics write was performed.

## Persistence

Only the masked report was copied to the private VPS:

```text
/opt/suleia-operations/private-data/today-batches/2026-07-28-authorized-read-posts.json
```

The file is mode `0600`, 56,933 bytes, and its SHA-256 is:

```text
d495209cd8df914b191ed10eedc5e43273706afe4a76613f7a530a3439294d43
```

No raw payload, credential, order mapping or direct identifier is present in
Git.
