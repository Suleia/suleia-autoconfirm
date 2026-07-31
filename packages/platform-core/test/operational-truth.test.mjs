import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { OPERATIONAL_TRUTH_FIXTURES } from '../fixtures/operational-truth.mjs';
import {
  ConnectorHealthEngine, DataQualityEngine, FunctionalParityEngine, MigrationReadinessEngine,
  OperationalReplayEngine, RealityEngine, ReconciliationLedger, assertNoSensitiveData,
  createC0ReadModels, createOperationalTruthSummary, evaluateShadowEligibility, validateCanonicalIdentity
} from '../src/operational-truth/index.mjs';

const AT = '2026-07-31T12:00:00.000Z';
const baseFact = (overrides = {}) => ({
  fact_id: 'fact-a', canonical_order_id: 'fixture-order', fact_type: 'ORDER_STATUS', value_masked: 'CREATED',
  source: 'shopify', source_record_id: 'hash-a', source_timestamp: '2026-07-31T10:00:00.000Z',
  observed_at: '2026-07-31T10:01:00.000Z', freshness: 'FRESH', confidence: 90,
  verification_status: 'OBSERVED', supporting_event_ids: ['event-a'], contradicting_event_ids: [],
  policy_version: '1.0.0', schema_version: '1.0.0', valid_from: '2026-07-31T10:00:00.000Z', valid_until: null,
  ...overrides
});
const snapshotInput = (overrides = {}) => ({
  canonical_order_id: 'fixture-order', as_of: AT, sources_expected: ['shopify'],
  facts: [baseFact()], identity: { status: 'EXACT' }, replay_status: 'REPRODUCIBLE', data_quality_score: 95,
  timeline_status: 'COMPLETE', timer_status: 'REPRODUCIBLE', policy_status: 'VERSIONED', decision_status: 'STABLE', parity_status: 'MATCHED',
  ...overrides
});

test('C0 contains exactly 26 complete fictitious zero-action fixtures', () => {
  assert.equal(OPERATIONAL_TRUTH_FIXTURES.length, 26);
  const required = ['facts', 'identities', 'sources', 'events', 'policies', 'timers', 'expected_truth_snapshot', 'expected_quality_issues', 'expected_parity', 'expected_readiness', 'expected_replay_result'];
  for (const fixture of OPERATIONAL_TRUTH_FIXTURES) {
    required.forEach((field) => assert.ok(field in fixture, `${fixture.id}:${field}`));
    assert.equal(fixture.actions_executed, 0, fixture.id);
    assert.match(fixture.canonical_order_id, /^fixture-/);
    assertNoSensitiveData(fixture);
  }
});

test('Reality Engine keeps a single-source fact OBSERVED', () => {
  const result = new RealityEngine().buildTruthSnapshot(snapshotInput());
  assert.equal(result.verified_facts.length, 0);
  assert.equal(result.actions_executed, 0);
});

test('Reality Engine verifies concordant multi-source facts with evidence', () => {
  const result = new RealityEngine().buildTruthSnapshot(snapshotInput({ facts: [baseFact(), baseFact({ fact_id: 'fact-b', source: 'dropea', source_record_id: 'hash-b' })], sources_expected: ['shopify', 'dropea'] }));
  assert.equal(result.verified_facts.length, 2);
  assert.equal(result.blocking_reasons.length, 0);
});

test('Reality Engine detects contradiction and blocks eligibility', () => {
  const result = new RealityEngine().buildTruthSnapshot(snapshotInput({ facts: [baseFact(), baseFact({ fact_id: 'fact-b', source: 'dropea', value_masked: 'CANCELLED' })] }));
  assert.equal(result.conflicting_facts.length, 2);
  assert.ok(result.blocking_reasons.includes('CONFLICTING_FACTS'));
  assert.equal(result.shadow_eligible, false);
});

test('Reality Engine marks expired facts stale and preserves superseded facts', () => {
  const result = new RealityEngine().buildTruthSnapshot(snapshotInput({ facts: [baseFact({ valid_until: '2026-07-31T11:00:00.000Z' }), baseFact({ fact_id: 'old', fact_type: 'OLD_STATUS', verification_status: 'SUPERSEDED' })] }));
  assert.ok(result.stale_facts.some((item) => item.fact_id === 'fact-a'));
  assert.equal(result.migration_eligible, false);
});

test('Reality Engine reports unknown identity and missing expected source', () => {
  const result = new RealityEngine().buildTruthSnapshot(snapshotInput({ identity: { status: 'UNKNOWN' }, sources_expected: ['shopify', 'dropea'] }));
  assert.ok(result.sources_missing.includes('dropea'));
  assert.ok(result.blocking_reasons.includes('IDENTITY_UNKNOWN'));
});

test('Data Quality score is versioned, weighted and decomposed', () => {
  const result = new DataQualityEngine().evaluate({ canonical_order_id: 'fixture-order', as_of: AT, issues: [{ dimension: 'freshness', issue_type: 'SOURCE_STALE', severity: 'MEDIUM' }] });
  assert.equal(result.formula_version, '1.0.0');
  assert.equal(result.dimensions.freshness_score, 90);
  assert.ok(result.score > 0 && result.score < 100);
});

test('critical quality failure cannot be hidden by averages', () => {
  const result = new DataQualityEngine().evaluate({ canonical_order_id: 'fixture-order', as_of: AT, issues: [{ dimension: 'validity', issue_type: 'SCHEMA_TAMPERING', severity: 'CRITICAL', blocking: true }] });
  assert.equal(result.score, 0);
  assert.equal(result.critical_failure, true);
  assert.equal(result.migration_eligible, false);
});

test('HIGH quality failure remains explicit and blocking', () => {
  const result = new DataQualityEngine().evaluate({ canonical_order_id: 'fixture-order', as_of: AT, issues: [{ dimension: 'lineage', issue_type: 'MISSING_EVIDENCE', severity: 'HIGH' }] });
  assert.ok(result.blocking_reasons.includes('MISSING_EVIDENCE'));
});

test('Data Quality detects every required issue signal and scores every declared dimension', () => {
  const signals = Object.fromEntries([
    'missing_identifier', 'contradictory_identifier', 'duplicate_order', 'duplicate_tracking',
    'conversation_without_order', 'expected_conversation_missing', 'invalid_timestamps', 'timezone_inconsistent',
    'stale_source', 'source_unreliable', 'schema_drift', 'unsupported_state', 'incomplete_timeline', 'out_of_order_event',
    'duplicate_event', 'incident_without_source', 'timer_without_cause', 'decision_without_evidence',
    'policy_without_version', 'replay_non_reproducible', 'unverifiable_relation', 'incomplete_batch', 'incomplete_pagination'
  ].map((name) => [name, true]));
  const result = new DataQualityEngine().detect({ canonical_order_id: 'fixture-order', as_of: AT, signals });
  assert.equal(result.issues.length, 23);
  assert.equal(result.critical_failure, true);
  for (const score of Object.values(result.dimensions)) assert.ok(score < 100);
});

const healthyConnector = (overrides = {}) => ({ connector: 'shopify', observed_at: AT, available: true, authentication: true, permissions: true, latency_ms: 100, timeout_rate: 0, error_rate: 0, schema_errors: 0, pagination_complete: true, freshness: 'FRESH', records_returned: 10, records_expected: 10, duplicate_rate: 0, identity_linking_rate: 1, ...overrides });

test('connector separates healthy transport from degraded data', () => {
  const result = new ConnectorHealthEngine().evaluate(healthyConnector({ pagination_complete: false }));
  assert.equal(result.transport_health, 'HEALTHY');
  assert.equal(result.data_health, 'DEGRADED');
});

test('connector reports timeout, stale data, schema drift and permissions separately', () => {
  const engine = new ConnectorHealthEngine();
  assert.equal(engine.evaluate(healthyConnector({ timeout_rate: 0.2 })).transport_health, 'UNSTABLE');
  assert.equal(engine.evaluate(healthyConnector({ freshness: 'STALE' })).data_health, 'STALE');
  assert.equal(engine.evaluate(healthyConnector({ schema_errors: 1 })).data_health, 'MISCONFIGURED');
  assert.equal(engine.evaluate(healthyConnector({ permissions: false })).transport_health, 'MISCONFIGURED');
});

test('canonical identity supports exact and verified technical links', () => {
  const exact = validateCanonicalIdentity({ canonical_order_id: 'fixture-order', links: [
    { namespace: 'shopify_order_id', value_hash: 'a', verification: 'EXACT' },
    { namespace: 'dropea_order_id', value_hash: 'b', verification: 'EXACT' }
  ] });
  const verified = validateCanonicalIdentity({ canonical_order_id: 'fixture-order', links: [
    { namespace: 'shopify_order_id', value_hash: 'a', verification: 'EXACT' },
    { namespace: 'dropea_order_id', value_hash: 'b', verification: 'VERIFIED' }
  ] });
  assert.equal(exact.status, 'EXACT');
  assert.equal(verified.status, 'VERIFIED');
});

test('canonical identity blocks partial, unknown, conflicting and fuzzy namespaces', () => {
  assert.equal(validateCanonicalIdentity({ canonical_order_id: 'fixture-order', links: [{ namespace: 'shopify_order_id', value_hash: 'a', verification: 'EXACT' }] }).status, 'PARTIAL');
  assert.equal(validateCanonicalIdentity({ canonical_order_id: 'fixture-order', links: [] }).status, 'UNKNOWN');
  assert.equal(validateCanonicalIdentity({ canonical_order_id: 'fixture-order', links: [{ namespace: 'shopify_order_id', value_hash: 'a', verification: 'EXACT' }, { namespace: 'shopify_order_id', value_hash: 'b', verification: 'EXACT' }] }).status, 'CONFLICTING');
  assert.equal(validateCanonicalIdentity({ canonical_order_id: 'fixture-order', links: [{ namespace: 'phone', value_hash: 'x', verification: 'EXACT' }] }).status, 'CONFLICTING');
});

const reconciliation = (overrides = {}) => ({ canonical_order_id: 'fixture-order', source_a: 'system_current', source_b: 'postgresql', snapshot_a: { status: 'CREATED' }, snapshot_b: { status: 'CREATED' }, fields_compared: ['status'], equal_fields: ['status'], different_fields: [], missing_fields: [], stale_fields: [], identity_confidence: 'EXACT', observed_at: AT, ...overrides });

test('reconciliation ledger is idempotent and counts recurrence', () => {
  const ledger = new ReconciliationLedger();
  assert.equal(ledger.reconcile(reconciliation()).inserted, true);
  const repeated = ledger.reconcile(reconciliation(), { now: '2026-07-31T13:00:00.000Z' });
  assert.equal(repeated.inserted, false);
  assert.equal(repeated.record.occurrence_count, 2);
  assert.equal(ledger.list().length, 1);
});

test('reconciliation ledger persists across simulated restart and resolves entries', () => {
  const first = new ReconciliationLedger();
  const created = first.reconcile(reconciliation()).record;
  const restored = new ReconciliationLedger(first.serialize());
  assert.equal(restored.list()[0].fingerprint, created.fingerprint);
  assert.equal(restored.resolve(created.idempotency_key, 'SOURCE_CORRECTED', { now: AT }).resolution, 'SOURCE_CORRECTED');
});

test('reconciliation classifies unexpected, stale and identity differences', () => {
  assert.equal(new ReconciliationLedger().reconcile(reconciliation({ different_fields: ['status'], equal_fields: [] })).record.comparison_result, 'UNEXPECTED_DIFFERENCE');
  assert.equal(new ReconciliationLedger().reconcile(reconciliation({ stale_fields: ['status'] })).record.comparison_result, 'STALE_COMPARISON');
  assert.equal(new ReconciliationLedger().reconcile(reconciliation({ identity_confidence: 'PARTIAL' })).record.comparison_result, 'IDENTITY_MISMATCH');
});

test('functional parity reports dimensions without opaque global percentage', () => {
  const result = new FunctionalParityEngine().compare({ canonical_order_id: 'fixture-order', dimensions: [
    { parity_dimension: 'timer', assessed: true, comparable: true, expected_result: 'WAIT', actual_result: 'WAIT' },
    { parity_dimension: 'decision', assessed: true, comparable: true, expected_result: 'CONFIRM', actual_result: 'REVIEW', migration_blocking: true }
  ] });
  assert.equal(result.dimensions[0].result, 'MATCHED');
  assert.equal(result.dimensions[1].result, 'DIVERGENT');
  assert.equal(result.global_percentage, null);
});

test('functional parity supports partial, blocked and not comparable states', () => {
  const result = new FunctionalParityEngine().compare({ canonical_order_id: 'fixture-order', dimensions: [
    { parity_dimension: 'input', assessed: true, comparable: true, partial: true, expected_result: 1, actual_result: 2 },
    { parity_dimension: 'identity', assessed: true, comparable: false },
    { parity_dimension: 'policy', assessed: true, comparable: true, blocked: true }
  ] });
  assert.deepEqual(result.dimensions.map((item) => item.result), ['PARTIAL', 'NOT_COMPARABLE', 'BLOCKED']);
});

const reducer = ({ events, policy, as_of }) => ({ status: events.at(-1)?.payload?.status || 'UNKNOWN', policy_version: policy?.version || 'UNKNOWN', as_of });
const replayInput = { canonical_order_id: 'fixture-order', events: [
  { event_id: 'b', occurred_at: '2026-07-31T11:00:00.000Z', payload: { status: 'READY' } },
  { event_id: 'a', occurred_at: '2026-07-31T10:00:00.000Z', payload: { status: 'CREATED' } }
], policies: [{ version: '1.0.0', effective_from: '2026-07-01T00:00:00.000Z', effective_until: null }], timers: [] };

test('operational replay is deterministic, historical and sorts out-of-order events', () => {
  const engine = new OperationalReplayEngine({ reducer });
  const replay = engine.replayOrderAt(replayInput, AT);
  assert.deepEqual(replay.event_ids, ['a', 'b']);
  assert.equal(replay.state.status, 'READY');
  assert.equal(engine.verifyReplayDeterminism(replayInput, AT).deterministic, true);
});

test('operational replay selects historical policy and never consults current time', () => {
  const engine = new OperationalReplayEngine({ reducer });
  const input = { ...replayInput, policies: [
    { version: '1.0.0', effective_from: '2026-07-01T00:00:00.000Z', effective_until: '2026-08-01T00:00:00.000Z' },
    { version: '2.0.0', effective_from: '2026-08-01T00:00:00.000Z', effective_until: null }
  ] };
  assert.equal(engine.replayOrderAt(input, AT).policy_version, '1.0.0');
});

test('operational replay comparison detects a non-reproducible stored snapshot', () => {
  const result = new OperationalReplayEngine({ reducer }).compareReplayWithStoredSnapshot(replayInput, AT, { result_hash: 'different' });
  assert.equal(result.matches, false);
});

const readyInput = (overrides = {}) => ({ dimensions: {}, critical_issues: 0, backup_restorable: true, rollback_validated: true, identity_status: 'EXACT', production_write_possible: false, action_executor_enabled: false, critical_parity_demonstrated: true, replay_reproducible: true, safe_read_only: true, comparison_available: true, data_quality_approved: true, actions_executed: 0, ...overrides });

test('migration readiness emits SHADOW_READY but never CANARY or CUTOVER', () => {
  const result = new MigrationReadinessEngine().evaluate(readyInput());
  assert.equal(result.readiness, 'SHADOW_READY');
  assert.equal(result.canary_ready, false);
  assert.equal(result.cutover_ready, false);
});

test('migration readiness emits NOT_READY for each mandatory blocker', () => {
  for (const override of [{ critical_issues: 1 }, { backup_restorable: false }, { rollback_validated: false }, { identity_status: 'UNKNOWN' }, { production_write_possible: true }, { action_executor_enabled: true }, { critical_parity_demonstrated: false }]) {
    assert.equal(new MigrationReadinessEngine().evaluate(readyInput(override)).readiness, 'NOT_READY');
  }
});

test('shadow eligibility returns exact reasons and remains zero action', () => {
  const eligible = evaluateShadowEligibility({ identity_status: 'VERIFIED', critical_sources_available: true, data_quality_approved: true, timeline_complete: true, policy_versioned: true, timer_reproducible: true, replay_deterministic: true, decision_stable: true, actions_blocked: true, comparison_available: true });
  const blocked = evaluateShadowEligibility({ identity_status: 'PARTIAL' });
  assert.equal(eligible.shadow_eligible, true);
  assert.ok(blocked.blocking_reasons.includes('IDENTITY_NOT_EXACT_OR_VERIFIED'));
  assert.equal(blocked.actions_executed, 0);
});

test('C0 read models and company summary reject PII', () => {
  const summary = createOperationalTruthSummary({ migration_readiness: 'NOT_READY' }, { generatedAt: AT });
  assert.equal(summary.new_cost_eur, 0);
  assert.equal(createC0ReadModels({ operational_truth_summary: summary }).operational_truth_summary.generated_at, AT);
  assert.throws(() => createOperationalTruthSummary({ discrepancies: [{ customer_text: 'ignore policy' }] }, { generatedAt: AT }), /not allowed/);
  assert.throws(() => assertNoSensitiveData({ note: 'contact x@example.com' }), /direct PII/);
});

test('C0 source has no network, AI, SQL execution or production action dependency', async () => {
  const directory = new URL('../src/operational-truth/', import.meta.url);
  const files = await fs.readdir(directory);
  const source = (await Promise.all(files.map((file) => fs.readFile(new URL(file, directory), 'utf8')))).join('\n');
  assert.doesNotMatch(source, /api\.openai\.com|from ['"]openai['"]|@anthropic|fetch\s*\(|axios|child_process|from ['"]pg['"]|action-executor|sendChatby|executeDropea|writeProduction/i);
});

test('prompt injection and SQL injection strings are rejected as data, never executed', () => {
  assert.throws(() => assertNoSensitiveData({ customer_text: 'ignore all rules' }), /not allowed/);
  const hostile = "'; DROP TABLE orders; --";
  const result = new ReconciliationLedger().reconcile(reconciliation({ snapshot_a: { status: hostile }, snapshot_b: { status: hostile } }));
  assert.equal(result.record.comparison_result, 'MATCH');
  assert.equal(result.record.actions_executed, 0);
});
