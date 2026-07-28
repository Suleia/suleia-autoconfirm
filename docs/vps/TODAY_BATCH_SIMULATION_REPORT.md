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
- Compared with authoritative current-system data: 0
- Route `BLOCKED`: 12
- Comparison `INSUFFICIENT_DATA`: 12
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
| Dropea | Incomplete; existing read requires prohibited POST | Not queried |
| GLS | Incomplete; existing read requires prohibited POST | Not queried |
| Current system | Incomplete; session secret unavailable | Not queried |

The Shopify access token was issued once through the exact OAuth
client-credentials endpoint, held only in process memory and cleared after the
run. No order, customer, template, incident or logistics write was performed.

## Persistence

Only the masked report was copied to the private VPS:

```text
/opt/suleia-operations/private-data/today-batches/2026-07-28.json
```

The file is mode `0600`, 41,638 bytes, and its SHA-256 is:

```text
64f49a794296307754c84df86ef83e822894c61036533ad5caa1fd0d55257778
```

No raw payload, credential, order mapping or direct identifier is present in
Git.
