# VPS provider comparison

Checked against official provider pages on 2026-07-26. Prices can change and must be rechecked at checkout. No purchase has been made.

| Provider and candidate | Published resources | Published price before VAT | Notes |
| --- | --- | --- | --- |
| OVHcloud VPS-2 | 4 vCores, 8 GB RAM, 75 GB NVMe | From EUR 7.21/month | Daily backup, unlimited traffic and anti-DDoS included |
| Hetzner CAX21 | 4 ARM vCPU, 8 GB RAM, 80 GB | EUR 10.49/month plus optional IPv4 | 20 TB EU traffic; ARM compatibility must be verified |
| Scaleway DEV1-M | 3 vCPU, 4 GB RAM | About EUR 14.74/month | Storage and public IPv4 are additional |

## Official sources

- OVHcloud: https://www.ovhcloud.com/es-es/vps/
- Hetzner current price adjustment: https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/
- Hetzner plan resources: https://www.hetzner.com/de/cloud/cost-optimized
- Scaleway: https://www.scaleway.com/en/pricing/virtual-instances/

## Preliminary recommendation

Use OVHcloud VPS-2 for the first isolated staging rehearsal, subject to:

1. final checkout price and EU location confirmation;
2. confirmation that the daily backup can be restored independently;
3. a separate encrypted off-site PostgreSQL backup;
4. load testing with the expected data volume;
5. explicit purchase authorization.

Hetzner CAX21 is a strong alternative if ARM compatibility is validated. Scaleway is operationally capable but currently costs more for a smaller development instance once storage and IPv4 are included.
