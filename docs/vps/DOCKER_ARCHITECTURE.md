# Docker architecture

The Compose file is at `infrastructure/docker/compose.yaml`.

## Security defaults

- Node containers run as non-root.
- Filesystems are read-only.
- Temporary paths use small `tmpfs` mounts.
- Linux capabilities are dropped.
- `no-new-privileges` is enabled.
- Container logs rotate.
- CPU and memory limits are declared.
- Only Caddy publishes ports.

## Staging defaults

All services inherit the mandatory simulation envelope. Connectors and schedulers remain disabled. The MCP uses fixture mode until an isolated PostgreSQL staging dataset is authorized.

## Start criteria

Do not start Compose until:

1. Docker is available in an isolated test host.
2. A populated untracked `.env` has been created from `.env.vps.example`.
3. Passwords and bearer tokens are generated randomly.
4. Static safety checks pass.
5. No production connector credential is present.
