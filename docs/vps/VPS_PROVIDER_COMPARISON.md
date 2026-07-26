# VPS staging pre-purchase comparison

Checked against official provider information on 2026-07-26. No purchase,
provisioning, public deployment or production connection has been made.
All checkout totals must be revalidated immediately before ordering.

## Current shortlist

The staging workload needs PostgreSQL, application services, a read-only MCP
server, Caddy, monitoring and enough capacity for integration and restore
tests.

| Item | Economic | Recommended |
| --- | --- | --- |
| Provider | Contabo | Contabo |
| Product | Cloud VPS 4 | Cloud VPS 6 |
| Contract | One month | One month |
| Region | European Union | European Union |
| Compute | 4 vCPU, 8 GB RAM | 6 vCPU, 12 GB RAM |
| Included storage | 100 GB SSD | 200 GB SSD |
| Public network | IPv4, 200 Mbit/s | IPv4, 300 Mbit/s |
| Provider snapshots | 1 | 2 |
| Auto Backup | Daily, 10 versions | Daily, 10 versions |
| Server, ex VAT | EUR 5.50 | EUR 7.50 |
| Auto Backup, ex VAT | EUR 1.65 | EUR 3.35 |
| Monthly total, ex VAT | EUR 7.15 | EUR 10.85 |
| Spanish VAT (21%) | EUR 1.50 | EUR 2.28 |
| **Estimated total, VAT included** | **EUR 8.65** | **EUR 13.13** |

## Recommendation

Choose **Contabo Cloud VPS 6** on a one-month contract with Auto Backup.

Reasons:

1. Twelve GB RAM gives PostgreSQL, Docker and restore drills useful headroom.
2. Six vCPU supports parallel container builds and integration tests.
3. The included 200 GB SSD avoids a separate block-volume dependency.
4. The one-month term limits commitment while staging is validated.
5. The estimated total remains well below the EUR 25 monthly ceiling.
6. Compared with Cloud VPS 4, the incremental cost is small relative to the
   additional memory, compute and storage.

Cloud VPS 4 remains viable for a minimal proof, but its lower capacity would
increase the chance of resource pressure during database restores and
concurrent container starts.

## Previous target

Hetzner CX33 was the earlier recommendation. The owner could not complete the
presented onboarding flow without a VAT ID, so it is no longer the active
purchase target. No Hetzner resource was purchased.

## Backup policy

Provider backup and application backup serve different purposes:

- Enable Contabo Auto Backup for daily host-level recovery with ten retained
  versions.
- Generate an encrypted daily logical PostgreSQL backup.
- Verify the newest logical dump after creation.
- Run a weekly restore drill in an isolated database.
- Do not treat provider snapshots as the only database backup.
- Before masked real-data import, separately authorize an encrypted off-site
  backup target.

## Limits and scalability

- Shared-vCPU VPS plans are appropriate for staging, not guaranteed
  CPU-intensive production workloads.
- A powered-off server may remain billable until cancelled.
- Provider backup does not replace database-level consistency checks.
- Currency, taxes and promotional pricing can change at checkout.
- No DNS, public endpoint or production connector is authorized by the VPS
  purchase.

## Official references

- Contabo Cloud VPS plans:
  https://contabo.com/es/vps/
- Contabo Cloud VPS 6 configuration:
  https://contabo.com/es/vps/cloud-vps-core-6
- Contabo ordering guide:
  https://help.contabo.com/es/support/solutions/articles/103000394299-c%C3%B3mo-hacer-un-pedido
- Contabo account types:
  https://help.contabo.com/es/support/solutions/articles/103000365847--c%C3%B3mo-puedes-cambiar-tu-tipo-de-cuenta-

## Authorization boundary

The next action is a purchase and payment decision. Do not submit customer
details, payment details or the final order until the owner explicitly confirms
the final checkout total and the Contabo purchase.
