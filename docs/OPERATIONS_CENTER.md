# Suleia Operations Center

Status: private shadow application, `SHADOW_READ_ONLY` and `SIMULATION_ONLY`.

The interface has exactly two primary sections: **Pedidos** and
**Incidencias**. It contains no storefront-status column, badge, comparison or
filter. Every screen reads PostgreSQL read models on the VPS; opening a page
never calls Dropea, Chatby, GLS or another external source.

## Security

- HTTPS is terminated by the existing Caddy edge.
- The existing Keycloak realm provides Authorization Code + PKCE, session
  expiry, brute-force protection and optional user OTP.
- The API verifies issuer, audience, RS256 signature, the
  `operations_reader` role and `operations:read` scope.
- The browser uses an expiring token in session storage; the API has no cookie,
  no CSRF-bearing session and no write route.
- The PostgreSQL login inherits a dedicated role with
  `default_transaction_read_only=on`.
- API reads are rate-limited and access logs contain only a principal hash.

## Read models

Migration `006_operations_center_read_models.sql` creates optimized order,
incident, conversation, decision, discount, timeline, connector-health and
freshness surfaces. Queue indexes cover status, active state, due time, risk,
priority, latest message, update time, decision and freshness.

The incidence queue predicate is fixed to `PENDING` and active. The discount
table enforces at most 5 EUR and `email_sent=false`. All order, incident and
decision records enforce zero actions and shadow-only mode.

## Experience

Both queues support persistent in-view filters, bounded pagination, keyboard
row access, an accessible detail drawer, Decision Card, masked timeline,
freshness warnings, a manual refresh button and silent refresh every 45
seconds. Empty and unavailable states are explicit.

No interactive browser was used during implementation or validation, in
accordance with the repository rule. Validation is static, contractual and
API-level until the authorized VPS deployment check.
