# Financial evidence reconciliation — 2026-10-31

## Scope and runtime
Finance only. Render base 67ad2cf56a213101aad358638b366a44fe061529;
VPS API base 58e976909927325c23a5bf5979a7fb37cb72aa62.
Keep every other module, configuration, financial tariff, fixed expense, customer
workflow, timer and budget policy unchanged. No database migration is needed.

## Demonstrated correction
A final provider total of zero is a valid value. Clamping a negative residual
to zero charged nominal logistics despite that published total. Preserve signed
residuals, including their product allocation, so components reconcile to the
provider total once. Product COGS outside the provider total remains separate.
Missing components or tax rates cannot reconstruct a final expense as zero.
Reject arithmetic/inventory mismatches before publishing a snapshot.

## Source hierarchy and limitations
Published order expense totals, complete reconstructed components, operational
amounts and versioned business tariffs are distinct bases. A returned-order
cost belongs to its exact order, not its quantity. Current provider states and
order amounts support provisional cohort recognition, not bank receipt proof.
A timestamp-free V2 refusal can have an explicit final return charge; recognize
that financial outcome only with shipment evidence and a positive published
expense, without inventing the return event date.

Keep prior exact-ID/same-outcome date-only observations with explicit legacy
provenance if a later provider response omits the date. calculated_at is never
a debit or COD-settlement date. Amounts for undated costs stay in cohort results;
economic-date totals remain unavailable until their dates are evidenced.
Theoretical provider-rate tax and unexplained residuals are separate. Neither
is promoted to a verified invoice. Paid provider status is separate from cash.

## Monetary advertising
The financial reader queries account-level monetary spend through GET only,
verifies EUR and Europe/Madrid, rejects duplicate/wrong-account/out-of-range rows
and unsafe pagination. A completely paginated account query can identify
no-activity dates explicitly. No attributed purchase values, budget mutations,
campaign configuration or autopilot code are involved.

## Automation
Reuse the existing financial scheduler. Refresh the current cohort, then at most
one stale older unresolved cohort sequentially. No second timer or parallel sweep.
Expose financial-only synchronization status through the authenticated finance
read. Preserve the last snapshot if reconciliation or source generation fails.

## Panel

The inventory remains all provider orders created in the selected month. Within
that inventory, an explicit external purchase timestamp determines the daily
cohort instead of a delayed import timestamp. Missing purchase dates are marked
as provider-creation fallback, never verified purchase dates. An invalid, future
or cross-month external date stops replacement of the valid snapshot and requires
inventory reconciliation; it is never silently reassigned to a different month.
Keep the provider creation day separately and preserve exact-order legacy event
evidence across the purchase-day correction.
Retain existing KPIs and charts. Add source assurance, a separate economic-date
diagnostic and a paginated private order-contribution ledger/export. Headline
values remain the purchase cohort. Do not allocate Meta or general overhead to
individual orders. Arithmetic consistency is not provider-final certification.

## Validation and release
Private source snapshots include every October order/detail, an independent
Meta account read, a Shopify ID bridge, finance SQL backups and the runtime
before-state. Real-snapshot regression covers May–October and exact daily sums.
Private reports/ledger and any customer details must never enter GitHub.
Release only finance files over the captured current runtime; compare every
other application/static hash and operational configuration, and preserve a
code-only rollback to the actual predecessor. No customer or budget writes.

