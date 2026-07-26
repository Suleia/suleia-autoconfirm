# Cost report

Date: 2026-07-26

No infrastructure has been purchased.

## Economic option

Hetzner CX23 in Nuremberg:

- 2 shared vCPU, 4 GB RAM, 40 GB local disk.
- 40 GB additional volume.
- Primary IPv4 and free IPv6.
- Seven provider backup slots.
- Estimated total before VAT: EUR 8.95/month.
- Spanish VAT at 21%: EUR 1.88/month.
- **Estimated total including VAT: EUR 10.83/month.**

## Recommended option

Hetzner CX33 in Nuremberg:

- 4 shared vCPU, 8 GB RAM, 80 GB local disk.
- 80 GB additional volume.
- Primary IPv4 and free IPv6.
- Seven provider backup slots.
- Estimated total before VAT: EUR 14.31/month.
- Spanish VAT at 21%: EUR 3.01/month.
- **Estimated total including VAT: EUR 17.32/month.**

This is the recommended staging configuration. It remains EUR 7.68 below the
authorized EUR 25/month ceiling.

## Not included

- Domain registration or DNS changes.
- Independent off-site encrypted backup storage.
- Any OpenAI API usage.
- Production migration.
- Paid monitoring services.
- Administrator labour.
- Usage-based manual snapshots.

## Software

Ubuntu LTS, Docker Engine, Docker Compose, Caddy, PostgreSQL, Node.js and
Uptime Kuma have no license cost for this deployment.

## Billing caveats

- Prices are hourly with a monthly cap.
- A powered-off resource is still billed until deleted.
- Attached volumes are not covered by server backups or snapshots.
- Volume size can grow but cannot shrink.
- Final checkout must be verified before purchase because provider pricing and
  VAT handling can change.
