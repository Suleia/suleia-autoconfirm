# Enterprise Digital Twins design

Twins are reproducible, versioned read models derived from events. They do not
become sources of truth and cannot write to operational connectors.

## Common contract

Every twin has `twin_id`, `twin_type`, `canonical_technical_id`,
`snapshot_version`, `as_of`, `source_freshness`, `evidence_event_ids`,
`quality_flags`, `metrics`, `schema_version` and `run_mode=SIMULATION`.

## Initial twins

- **Customer:** pseudonymous order, delivery, incident, response, pickup,
  cancellation, discount and outcome aggregates.
- **Product:** sales, realised margin, incidents, returns, confirmation,
  carrier, campaign and recovery metrics.
- **Carrier:** delivery attempts, timings, absence, incidents, returns, pickup,
  data quality and freshness.
- **Campaign:** orders, products, conversion, confirmation, rejection, return,
  cost and realised margin.
- **Supplier:** cost, lead time, quality, stock, incident and return summaries.

Customer identity is pseudonymized with a controlled technical key. Direct PII
is neither duplicated nor used for cross-entity matching. Each snapshot can be
replayed from its evidence boundary.

Implementation is incremental: contract validation, fixture twins, relational
views, shadow comparison, then owner-reviewed read exposure.
