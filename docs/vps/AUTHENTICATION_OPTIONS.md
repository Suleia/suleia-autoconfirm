# Authentication options

No identity provider is installed in this phase. The current bearer mechanism is limited to an isolated local or private staging rehearsal and must be replaced before public staging.

## Required security properties

- Authorization Code with PKCE for interactive clients.
- Short-lived access tokens.
- Explicit `orders:read` and `orders:simulate` scopes.
- No write scope.
- TOTP MFA for the review panel administrator.
- Secure, HTTP-only and same-site cookies.
- CSRF protection, login rate limiting and session audit.
- Token audience and issuer validation in the API and MCP server.
- Revocation without rotating database credentials.

## Compared options

| Option | Strengths | Cost on a small VPS | Main concern |
| --- | --- | --- | --- |
| ZITADEL self-hosted | OIDC/OAuth, PKCE, MFA, audit trail, PostgreSQL, relatively small runtime | The service itself can run near 512 MB; the Compose guide asks for at least 2 GB for the stack | Requires correct HTTP/2 proxying, careful master-key custody and a separate authorization review |
| authentik | Friendly administration, policies, OIDC/OAuth and MFA; official Compose path for small production | Official minimum is 2 CPU cores and 2 GB RAM | Default Compose can mount the Docker socket; this must be removed or isolated |
| Keycloak | Mature, broad protocol support, strong ecosystem and extensive operational guidance | Official guidance recommends a 2 GB limit even for smaller production-ready deployments | Heavier JVM footprint and more tuning than this staging workload currently needs |
| Minimal in-app OIDC server | Smallest apparent footprint | Unknown until security engineering and independent review | Highest security and maintenance risk; not recommended |

## Preliminary choice

Use ZITADEL for the first authentication rehearsal after explicit authorization. It fits the PostgreSQL and Caddy architecture, supports Authorization Code with PKCE and exposes auditable identity events. This is a design decision, not an installation decision.

The acceptance gate requires:

1. fixed versioned images, not `latest`;
2. a separate database role and schema;
3. master key stored outside Git;
4. HTTP/2 proxy validation;
5. one admin with TOTP and a recovery procedure;
6. audience, issuer, expiry and scope tests;
7. logout and revocation tests;
8. no Docker socket mount;
9. backup and restore rehearsal for identity data;
10. confirmation that the MCP client supports the selected OAuth discovery flow.

## Temporary staging fallback

A random bearer token of at least 32 bytes may be used only for a private, time-limited rehearsal. It must be sent over TLS, hashed in audit records, rotated after the rehearsal and restricted by network policy. It is not approved for public staging or production.

## Official references

- ZITADEL Compose: https://zitadel.com/docs/self-hosting/deploy/compose
- ZITADEL recommended OAuth flows: https://zitadel.com/docs/guides/integrate/login/oidc/oauth-recommended-flows
- ZITADEL requirements: https://zitadel.com/docs/self-hosting/manage/requirements
- authentik Compose: https://docs.goauthentik.io/install-config/install/docker-compose/
- Keycloak containers: https://www.keycloak.org/server/containers
- Keycloak sizing: https://www.keycloak.org/high-availability/single-cluster/concepts-memory-and-cpu-sizing
