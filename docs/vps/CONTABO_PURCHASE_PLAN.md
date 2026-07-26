# Contabo purchase plan

Date: 2026-07-26

No server has been purchased.

## Recommended configuration

- Product: Contabo Cloud VPS 6.
- Contract: one month.
- Region: European Union.
- Operating system: latest supported Ubuntu LTS.
- Compute: 6 vCPU and 12 GB RAM.
- Storage: included 200 GB SSD.
- Network: included IPv4 and 300 Mbit/s port.
- Provider protection: Auto Backup enabled.
- Additional products: none.

## Estimated monthly cost

- Cloud VPS 6: EUR 7.50 before VAT.
- Auto Backup: EUR 3.35 before VAT.
- Subtotal: EUR 10.85 before VAT.
- Estimated Spanish VAT at 21%: EUR 2.28.
- Estimated total: **EUR 13.13 per month including VAT**.

The final checkout total must be checked before payment. No purchase is
authorized merely by this document.

## Why this option

Cloud VPS 6 is preferred over Cloud VPS 4 because the small price difference
adds 50% more RAM, two additional vCPU, twice the included SSD storage, a
faster network port and one extra provider snapshot. This gives PostgreSQL,
Docker, MCP, monitoring and restore tests enough headroom without exceeding
the EUR 25 monthly ceiling.

The one-month contract is deliberately selected for the first staging
checkpoint. A 24-month commitment should only be considered after the
container, database, backup and MCP acceptance tests have passed.

## Checkout checklist

1. Select Cloud VPS 6.
2. Select one-month billing.
3. Select a European Union location with no location surcharge.
4. Keep the included 200 GB SSD.
5. Select Ubuntu LTS.
6. Enable Auto Backup.
7. Keep the included IPv4.
8. Do not add Windows, cPanel, Plesk, Object Storage or paid monitoring.
9. Use a private customer account if no VAT ID is available.
10. Verify the final total before accepting the payment.

## After purchase

Do not send the root password in chat or commit it. The first-login process is:

1. Record the server IPv4 privately.
2. Log in once with the temporary provider credential.
3. Run the phase-one bootstrap.
4. Verify key-based access with the dedicated Suleia SSH key.
5. Run the phase-two SSH hardening.
6. Keep ports 80 and 443 closed until public staging is separately approved.

