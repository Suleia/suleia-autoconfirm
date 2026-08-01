import { assertNoSensitiveData, zeroActionEnvelope } from './contracts.mjs';
import { ReconciliationLedger } from './reconciliation-ledger.mjs';

export const RECONCILIATION_PAIRS = Object.freeze([
  ['dropea_webhook', 'dropea_get'],
  ['chatby_webhook', 'chatby_get'],
  ['event_store', 'digital_twin'],
  ['legacy_system', 'decision_memory'],
  ['timers', 'digital_twin']
]);

function compareSnapshots(left, right) {
  const fields = [...new Set([...Object.keys(left || {}), ...Object.keys(right || {})])].sort();
  const equal = [];
  const different = [];
  const missing = [];
  for (const field of fields) {
    if (!(field in (left || {})) || !(field in (right || {}))) missing.push(field);
    else if (JSON.stringify(left[field]) === JSON.stringify(right[field])) equal.push(field);
    else different.push(field);
  }
  return { fields, equal, different, missing };
}

export function reconcileOperationalSources({
  canonicalOrderId,
  identityStatus,
  snapshots,
  sourceHealth = {},
  observedAt,
  ledger = new ReconciliationLedger()
}) {
  assertNoSensitiveData(snapshots, 'reconciliation.snapshots');
  const records = [];
  for (const [sourceA, sourceB] of RECONCILIATION_PAIRS) {
    const left = snapshots[sourceA];
    const right = snapshots[sourceB];
    const comparison = compareSnapshots(left, right);
    const missingSource = !left || !right;
    const result = ledger.reconcile({
      canonical_order_id: canonicalOrderId,
      source_a: sourceA,
      source_b: sourceB,
      snapshot_a: left || {},
      snapshot_b: right || {},
      fields_compared: comparison.fields,
      equal_fields: comparison.equal,
      different_fields: comparison.different,
      missing_fields: comparison.missing,
      stale_fields: [sourceA, sourceB].filter((source) => sourceHealth[source]?.freshness === 'STALE'),
      identity_confidence: identityStatus,
      observed_at: observedAt,
      expected_difference: sourceHealth[`${sourceA}:${sourceB}`]?.expected_difference === true,
      pagination_complete: [sourceA, sourceB].every((source) => sourceHealth[source]?.pagination_complete !== false),
      out_of_order: [sourceA, sourceB].some((source) => sourceHealth[source]?.out_of_order === true),
      missing_event: missingSource,
      blocked: [sourceA, sourceB].some((source) => sourceHealth[source]?.blocked === true)
    }, { now: observedAt });
    records.push(result.record);
  }
  return Object.freeze({
    canonical_order_id: String(canonicalOrderId),
    records,
    counts: Object.fromEntries([
      'MATCH', 'EXPECTED_DIFFERENCE', 'UNEXPECTED_DIFFERENCE', 'STALE', 'MISSING_EVENT',
      'OUT_OF_ORDER', 'IDENTITY_MISMATCH', 'PAGINATION_INCOMPLETE', 'BLOCKED'
    ].map((state) => [state, records.filter((record) => record.operational_state === state).length])),
    reconciliation_complete: records.every((record) => !['BLOCKED', 'MISSING_EVENT', 'PAGINATION_INCOMPLETE'].includes(record.operational_state)),
    ledger,
    ...zeroActionEnvelope()
  });
}
