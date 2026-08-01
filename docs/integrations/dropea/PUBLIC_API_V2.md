# Dropea Public API integration

Status: `SHADOW_READ_ONLY` / `SIMULATION_ONLY`

## Contract source

- OpenAPI 3.0.3, API version 0.1.0.
- Pinned at `contracts/external/dropea/public-api/0.1.0/openapi.json`.
- SHA-256: `80e6419cec28ecef6a0cfabc9733e549a152760ababbdb587a0c664873866315`.
- Official market hosts: Spain, Italy and Portugal only.

The pinned file is the executable source of truth. A checksum or operation
inventory change blocks startup until it is reviewed.

## Credential boundary

The shadow connector accepts a JWT only when its claims contain exactly:

- `dp:users:read`
- `dp:stores:read`
- `dp:products:read`
- `dp:orders:read`
- `dp:issues:read`
- `dp:webhooks:read`

Any missing, write or unknown permission blocks the connector. Tokens are read
from protected runtime secret storage and are never logged or persisted in the
event store.

## Transport controls

- `GET` is the only HTTP method implemented by the V2 client.
- The internal ceiling is 45 requests per rolling minute, below Dropea's
  documented 60-per-minute limit.
- `Retry-After` is honored for HTTP 429.
- Retries are bounded and limited to 429/500/502/503/504 or transport errors.
- A circuit breaker prevents retry storms.
- Pagination is complete and bounded by page and record safety limits.
- Success and pagination envelopes are validated before ingestion.
- Audit events contain operation IDs and outcomes, never token or response PII.

## Shadow runtime

The ingestion worker can enable the public connector only with
`DROPEA_PUBLIC_API_ENABLED=true`. Its token is supplied through the protected
VPS environment as `DROPEA_PUBLIC_API_TOKEN`; it is never copied into source
control. Startup inspects the JWT claims and fails closed unless they equal the
six read scopes above.

Each cycle reads the complete bounded order and issue collections. Orders are
canonicalized and HMAC-linked first. An issue is projected only when its
`order_id` has an exact order identity in the same complete snapshot. Orphan
issues are counted as blocked and mark connector data health `DEGRADED`; no
heuristic identity matching is allowed. All projected records retain
`actions_executed=0` and `production_writes=0`.

## Deliberately unavailable operations

All create, update, cancel, confirm, resolve, link, unlink and webhook mutation
operations in the contract are inventoried but have no callable client method.
They remain forbidden during shadow operation.

## Rollback

The existing legacy connector remains the active source until explicit cutover
authorization. Disable the V2 shadow source and select the legacy connector;
no production state needs to be reverted because this client cannot write.
