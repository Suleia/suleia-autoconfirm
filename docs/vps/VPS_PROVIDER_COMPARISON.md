# VPS staging pre-purchase comparison

Checked against official provider information on 2026-07-26. No purchase,
provisioning, public deployment or production connection has been made.
All checkout totals must be revalidated immediately before ordering.

## Shortlist

The staging workload needs PostgreSQL, the application services, the read-only
MCP server, Caddy, monitoring and enough headroom to run integration tests.
The two viable options below use x86-64 to avoid introducing ARM image
compatibility risk.

| Item | Economic | Recommended |
| --- | --- | --- |
| Provider | Hetzner Cloud | Hetzner Cloud |
| Region | Nuremberg, Germany (`nbg1`) | Nuremberg, Germany (`nbg1`) |
| Server | CX23 | CX33 |
| Compute | 2 shared vCPU, 4 GB RAM | 4 shared vCPU, 8 GB RAM |
| Local disk | 40 GB | 80 GB |
| Additional volume | 40 GB | 80 GB |
| Total provisioned storage | About 80 GB | About 160 GB |
| Included traffic | 20 TB EU outbound allowance; inbound/internal free | 20 TB EU outbound allowance; inbound/internal free |
| Public network | Primary IPv4 plus free IPv6 | Primary IPv4 plus free IPv6 |
| Provider backups | Seven rotating server backup slots | Seven rotating server backup slots |
| Monthly server, ex VAT | EUR 5.49 | EUR 8.49 |
| Additional volume, ex VAT | EUR 1.76 | EUR 3.52 |
| Primary IPv4, ex VAT | EUR 0.60 | EUR 0.60 |
| Provider backup, ex VAT | EUR 1.10 | EUR 1.70 |
| Monthly total, ex VAT | EUR 8.95 | EUR 14.31 |
| Spanish VAT (21%) | EUR 1.88 | EUR 3.01 |
| **Estimated monthly total, VAT included** | **EUR 10.83** | **EUR 17.32** |

The volume calculation uses the current published/calculator rate of
EUR 0.044 per GB-month. The provider backup is 20% of the server price and
provides seven slots. Totals are rounded to cents and do not include a domain,
because no DNS change is authorized.

## Recommendation

Choose the **Hetzner CX33 recommended option at an estimated EUR 17.32/month
including Spanish VAT**.

Reasons:

1. Four vCPU and 8 GB RAM give the database, MCP server, monitoring and test
   workloads enough headroom without approaching the EUR 25/month ceiling.
2. x86-64 avoids an unnecessary ARM compatibility gate.
3. About 160 GB provisioned storage matches the requested recommended range.
4. The project can be rescaled later and the attached volume can be expanded
   in 1 GB increments.
5. The expected total leaves about EUR 7.68/month of budget margin.

The economic CX23 option is acceptable for a short proof of deployment, but
4 GB RAM gives less safety during migrations, restore drills and concurrent
container starts. Upgrading later is possible, but the recommended option
reduces the risk of diagnosing resource pressure as an application defect.

## Backup and snapshot policy

Provider backups and application backups serve different purposes:

- Enable Hetzner's seven-slot rotating backups for the server disk.
- Keep PostgreSQL data on the local server disk so those backups include the
  database files.
- Use the attached volume for encrypted logical PostgreSQL backups, validation
  artefacts and restore drills.
- Generate a daily encrypted `pg_dump`, retain seven daily copies and verify
  the newest dump after creation.
- Take a manual provider snapshot before operating-system upgrades, Docker
  upgrades or database migration rehearsals. Snapshots are usage-based and
  are not included in the monthly estimate.
- Delete temporary snapshots after the change has been validated.

Important limitation: Hetzner server backups and snapshots do not include
attached volumes. The volume is triple-replicated for hardware resilience, but
replication is not a backup. Before any real masked-data import, an independent
off-site encrypted backup target must be separately authorized.

## Limits and scalability

- CX shared-vCPU plans are intended for development, testing and low-to-medium
  sustained load, not continuous CPU-intensive production processing.
- Volumes can be expanded but not shrunk.
- A volume can attach to only one server at a time.
- Up to 16 volumes and 10 TB total volume capacity are supported per server.
- Server backup cost rises with the selected server plan.
- Resources continue to be billed while they exist, even when powered off.
- Cost alerts are notifications, not a hard spending cap.

## Other providers reviewed

### OVHcloud

OVHcloud is a sound fallback and includes a daily one-day backup, anti-DDoS and
unlimited traffic. Current Spain pricing is:

- VPS-1: 2 vCore, 4 GB, 40 GB NVMe, EUR 4.61/month VAT included.
- VPS-2: 4 vCore, 8 GB, 75 GB NVMe, EUR 8.72/month VAT included.
- VPS-3: 6 vCore, 12 GB, 100 GB NVMe, EUR 12.58/month VAT included.
- VPS-4: 8 vCore, 24 GB, 200 GB NVMe, EUR 24.15/month VAT included.

The plans do not match the requested 80 GB and 120-160 GB targets as closely.
VPS-4 also leaves effectively no room under the EUR 25 ceiling once an
optional seven-day backup is added.

### Scaleway

Scaleway DEV1-M is about EUR 14.74/month before VAT for 3 vCPU and 4 GB RAM,
with storage and public IPv4 charged separately. DEV1-L exceeds the budget
once VAT and storage are included. It is therefore not recommended for this
checkpoint.

## Official references

- Hetzner 2026 cloud prices:
  https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/
- Hetzner cloud features and regions:
  https://www.hetzner.com/cloud/
- Hetzner block storage:
  https://www.hetzner.com/cloud/block-storage/
- Hetzner volume limits and backup exclusion:
  https://docs.hetzner.com/cloud/volumes/overview/
- Hetzner backup billing:
  https://docs.hetzner.com/cloud/billing/faq/
- Hetzner Primary IPv4 pricing:
  https://docs.hetzner.com/general/infrastructure-and-availability/ipv4-pricing/
- OVHcloud Spain VPS prices and included services:
  https://www.ovhcloud.com/es-es/vps/
- OVHcloud backup and snapshot options:
  https://www.ovhcloud.com/es-es/vps/options/
- Scaleway virtual instance pricing:
  https://www.scaleway.com/en/pricing/virtual-instances/

## Authorization boundary

The next action is a purchasing decision. Do not create an account, contract a
server, enter payment details, provision infrastructure or expose an endpoint
until the owner explicitly confirms the provider and monthly cost.
