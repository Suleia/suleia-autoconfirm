# Monitoring

## Health

- Reverse proxy reachable.
- API `/health`.
- MCP `/health`.
- PostgreSQL readiness.
- Decision, ingestion and scheduler process health.

## Alerts

- Service unavailable for five minutes.
- Backup older than 26 hours.
- Disk above 75% warning and 85% critical.
- PostgreSQL connections above 80% of limit.
- Job queue age above threshold.
- Source freshness stale.
- Any decision with `actions_executed <> 0`.
- Any PII scan failure.

## Logs

Use structured JSON, correlation IDs and masked payloads. Do not log request authorization headers, raw messages, full phone numbers, email addresses, addresses or database URLs.
