const AT = '2026-07-31T12:00:00.000Z';
const fact = (overrides = {}) => ({
  fact_id: 'fact-status', canonical_order_id: 'fixture-order', fact_type: 'ORDER_STATUS', value_masked: 'CREATED',
  source: 'shopify', source_record_id: 'record-hash-a', source_timestamp: '2026-07-31T10:00:00.000Z',
  observed_at: '2026-07-31T10:01:00.000Z', freshness: 'FRESH', confidence: 95,
  verification_status: 'OBSERVED', supporting_event_ids: ['event-a'], contradicting_event_ids: [],
  policy_version: '1.0.0', schema_version: '1.0.0', valid_from: '2026-07-31T10:00:00.000Z', valid_until: null,
  ...overrides
});
const identity = (status = 'EXACT') => ({ status, links: status === 'UNKNOWN' ? [] : [
  { namespace: 'shopify_order_id', value_hash: 'hash-a', verification: status === 'EXACT' ? 'EXACT' : 'VERIFIED' },
  { namespace: 'dropea_external_reference', value_hash: 'hash-b', verification: status === 'EXACT' ? 'EXACT' : 'VERIFIED' }
] });
const event = (overrides = {}) => ({ event_id: 'event-a', event_type: 'ORDER_CREATED', occurred_at: '2026-07-31T10:00:00.000Z', payload: { status: 'CREATED' }, ...overrides });
const policy = (overrides = {}) => ({ policy_id: 'fixture-policy', version: '1.0.0', effective_from: '2026-07-01T00:00:00.000Z', effective_until: null, ...overrides });

function fixture(id, overrides = {}) {
  return Object.freeze({
    id, canonical_order_id: `fixture-${id}`, as_of: AT,
    facts: [fact()], identities: identity(), sources: ['shopify', 'dropea'], events: [event()], policies: [policy()], timers: [],
    expected_truth_snapshot: { identity_status: 'EXACT' }, expected_quality_issues: [],
    expected_parity: 'MATCHED', expected_readiness: 'SHADOW_READY', expected_replay_result: 'REPRODUCIBLE',
    actions_executed: 0, ...overrides
  });
}

export const OPERATIONAL_TRUTH_FIXTURES = Object.freeze([
  fixture('total-parity'),
  fixture('partial-identity', { identities: identity('PARTIAL'), expected_truth_snapshot: { identity_status: 'PARTIAL' }, expected_parity: 'NOT_COMPARABLE', expected_readiness: 'NOT_READY' }),
  fixture('conflicting-identity', { identities: { status: 'CONFLICTING', links: [
    { namespace: 'shopify_order_id', value_hash: 'hash-a', verification: 'EXACT' },
    { namespace: 'shopify_order_id', value_hash: 'hash-b', verification: 'EXACT' }
  ] }, expected_truth_snapshot: { identity_status: 'CONFLICTING' }, expected_parity: 'NOT_COMPARABLE', expected_readiness: 'NOT_READY' }),
  fixture('shopify-stale', { facts: [fact({ freshness: 'STALE' })], expected_quality_issues: ['SOURCE_STALE'], expected_readiness: 'NOT_READY' }),
  fixture('dropea-missing', { sources: ['shopify'], expected_quality_issues: ['EXPECTED_SOURCE_MISSING'], expected_readiness: 'NOT_READY' }),
  fixture('chatby-without-conversation-id', { expected_quality_issues: ['IDENTIFIER_MISSING'], expected_readiness: 'NOT_READY' }),
  fixture('gls-duplicate-tracking', { expected_quality_issues: ['TRACKING_DUPLICATE'], expected_readiness: 'NOT_READY' }),
  fixture('incomplete-timeline', { expected_quality_issues: ['TIMELINE_INCOMPLETE'], expected_readiness: 'NOT_READY' }),
  fixture('out-of-order-event', { events: [event({ event_id: 'event-b', occurred_at: '2026-07-31T11:00:00.000Z' }), event()], expected_quality_issues: ['EVENT_OUT_OF_ORDER'] }),
  fixture('different-timer', { timers: [{ timer_id: 'timer-a', expected_at: '2026-07-31T11:00:00.000Z', actual_at: '2026-07-31T11:05:00.000Z' }], expected_parity: 'DIVERGENT' }),
  fixture('different-policy', { policies: [policy({ version: '2.0.0' })], expected_parity: 'DIVERGENT' }),
  fixture('expected-decision-difference', { expected_parity: 'PARTIAL' }),
  fixture('unexpected-difference', { expected_parity: 'DIVERGENT', expected_readiness: 'NOT_READY' }),
  fixture('reproducible-replay'),
  fixture('non-reproducible-replay', { expected_replay_result: 'NON_REPRODUCIBLE', expected_readiness: 'NOT_READY' }),
  fixture('schema-drift', { expected_quality_issues: ['SCHEMA_DRIFT'], expected_readiness: 'NOT_READY' }),
  fixture('valid-backup'),
  fixture('rollback-not-validated', { expected_readiness: 'NOT_READY' }),
  fixture('healthy-connector-incomplete-data', { expected_quality_issues: ['DATA_INCOMPLETE'] }),
  fixture('healthy-transport-degraded-data', { expected_quality_issues: ['DATA_HEALTH_DEGRADED'] }),
  fixture('missing-page', { expected_quality_issues: ['PAGINATION_INCOMPLETE'], expected_readiness: 'NOT_READY' }),
  fixture('idempotent-duplicate'),
  fixture('ledger-survives-restart'),
  fixture('critical-risk', { expected_quality_issues: ['CRITICAL_RISK'], expected_readiness: 'NOT_READY' }),
  fixture('shadow-eligible'),
  fixture('shadow-ineligible', { expected_quality_issues: ['TIMELINE_INCOMPLETE'], expected_readiness: 'NOT_READY' })
]);

