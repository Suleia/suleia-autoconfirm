# Today real masked simulation report

Date: 2026-07-27

Business timezone: `Europe/Madrid`

Batch status: `ABORTED`

## Time boundary

- Local start: `2026-07-27T00:00:00`
- Local end, exclusive: `2026-07-28T00:00:00`
- UTC start: `2026-07-26T22:00:00.000Z`
- UTC end, exclusive: `2026-07-27T22:00:00.000Z`
- Order date field: `created_at`

## Preview result

The mandatory non-persistent preview stopped before reading any order because
the Render service exposes Shopify client credentials but no Shopify Admin
access token or shop domain. Exchanging client credentials for a token would
require `POST`, which this checkpoint explicitly blocks.

Consequently, the number of orders, pages, conversations, tracking records,
incidents and comparisons is **not determined**. It must not be reported as
zero, because the authoritative order source was not consulted.

## Connector status

| Source | Status | Reason |
| --- | --- | --- |
| Shopify | Not consultable | `SHOPIFY_GET_CREDENTIALS_MISSING` |
| Chatby | Not queried | Preview stopped after the Shopify gate |
| Dropea | Not consultable directly | Existing read integration requires `POST` |
| GLS | Not consultable directly | Existing read integration requires `POST` |
| Current system | Not queried | Preview stopped after the Shopify gate |

## Mandatory outcomes

- `ACTIONS_EXECUTED=0`
- `PII_PERSISTED_COUNT=0`
- External writes: none
- Masked report persisted: no
- Production modified: no
- Render modified: no
- Supabase modified: no
- OpenAI or other AI APIs used: no

The checkpoint is not complete. A later run requires a pre-existing Shopify
Admin access token and shop domain available to the read-only runner; no
credential exchange or production configuration change is authorized here.
