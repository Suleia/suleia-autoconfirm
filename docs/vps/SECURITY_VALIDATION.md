# Security validation

All checks must pass before public staging.

## Configuration

- [ ] Every mandatory safety flag has the expected value.
- [ ] No production credential is present.
- [ ] Secrets are untracked and mode `0600`.
- [ ] MCP write tools are disabled.
- [ ] External LLM calls are disabled.

## Network

- [ ] Only ports 22, 80 and 443 are reachable.
- [ ] PostgreSQL is not public.
- [ ] Docker socket is not mounted.
- [ ] TLS is valid.
- [ ] Security headers are present.

## Authorization

- [ ] Missing MCP credential returns 401.
- [ ] Invalid scope returns 403.
- [ ] Rate limit is enforced.
- [ ] Database MCP user cannot insert, update, delete or execute unsafe functions.

## Data

- [ ] PII scan passes for response and logs.
- [ ] Only one masked fixture is loaded initially.
- [ ] Event update/delete fails.
- [ ] Every simulation has zero executed actions.
- [ ] Staging cannot reach a production write endpoint.

## Recovery

- [ ] Backup checksum passes.
- [ ] Isolated restore succeeds.
- [ ] Recovery time and recovery point are measured.
