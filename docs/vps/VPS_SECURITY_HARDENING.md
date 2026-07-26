# VPS security hardening

## Before application deployment

1. Install the latest Ubuntu LTS security updates.
2. Create a named sudo user and disable direct root SSH.
3. Require SSH keys; disable password authentication.
4. Restrict SSH by source IP where practical.
5. Enable UFW with default deny; allow only SSH, HTTP and HTTPS.
6. Install and configure fail2ban.
7. Enable unattended security updates.
8. Set NTP and UTC.
9. Install Docker from the official repository.
10. Configure Docker log rotation and do not expose its socket.

## Application controls

- Caddy is the only internet-facing container.
- PostgreSQL has no public port.
- Secrets live in root-owned files with mode `0600`, not Git.
- Service login users receive one PostgreSQL group role.
- MCP requires TLS, bearer authentication and scopes.
- PII masking is mandatory before persistence or response.
- Audit logging is mandatory.
- Production connectors remain absent from staging.

## Operational controls

- Daily encrypted database backup.
- Weekly restore drill in an isolated database.
- Provider snapshot before upgrades.
- Monthly package and image update window.
- Alert on backup age, disk use, database health and service health.
- Quarterly credential rotation.

## Verification

Use `SECURITY_VALIDATION.md` before any public endpoint is authorized.
