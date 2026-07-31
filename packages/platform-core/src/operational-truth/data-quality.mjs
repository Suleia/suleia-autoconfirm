import { C0_SCHEMA_VERSION, stableId, zeroActionEnvelope } from './contracts.mjs';

export const QUALITY_WEIGHTS = Object.freeze({
  identity_score: 18, completeness_score: 14, freshness_score: 12,
  consistency_score: 14, validity_score: 10, timeline_score: 10,
  policy_score: 8, replay_score: 8, lineage_score: 6
});

const PENALTIES = Object.freeze({ INFO: 0, LOW: 3, MEDIUM: 10, HIGH: 25, CRITICAL: 100 });
const DIMENSION_BUCKETS = Object.freeze({
  identity: 'identity_score', identity_confidence: 'identity_score', completeness: 'completeness_score',
  freshness: 'freshness_score', consistency: 'consistency_score', uniqueness: 'consistency_score',
  source_reliability: 'consistency_score', validity: 'validity_score', schema_conformity: 'validity_score',
  timeline: 'timeline_score', temporal_coherence: 'timeline_score', policy: 'policy_score',
  replay: 'replay_score', replay_reproducibility: 'replay_score', lineage: 'lineage_score',
  lineage_completeness: 'lineage_score'
});

const SIGNALS = Object.freeze([
  ['missing_identifier', 'identity_confidence', 'IDENTIFIER_MISSING', 'HIGH'],
  ['contradictory_identifier', 'identity_confidence', 'IDENTIFIER_CONTRADICTORY', 'CRITICAL'],
  ['duplicate_order', 'uniqueness', 'ORDER_DUPLICATE', 'HIGH'],
  ['duplicate_tracking', 'uniqueness', 'TRACKING_DUPLICATE', 'HIGH'],
  ['conversation_without_order', 'lineage_completeness', 'CONVERSATION_WITHOUT_ORDER', 'HIGH'],
  ['expected_conversation_missing', 'completeness', 'EXPECTED_CONVERSATION_MISSING', 'HIGH'],
  ['invalid_timestamps', 'validity', 'TIMESTAMP_INVALID', 'HIGH'],
  ['timezone_inconsistent', 'temporal_coherence', 'TIMEZONE_INCONSISTENT', 'HIGH'],
  ['stale_source', 'freshness', 'SOURCE_STALE', 'HIGH'],
  ['source_unreliable', 'source_reliability', 'SOURCE_UNRELIABLE', 'HIGH'],
  ['schema_drift', 'schema_conformity', 'SCHEMA_DRIFT', 'CRITICAL'],
  ['unsupported_state', 'validity', 'STATE_UNSUPPORTED', 'HIGH'],
  ['incomplete_timeline', 'temporal_coherence', 'TIMELINE_INCOMPLETE', 'HIGH'],
  ['out_of_order_event', 'temporal_coherence', 'EVENT_OUT_OF_ORDER', 'MEDIUM'],
  ['duplicate_event', 'uniqueness', 'EVENT_DUPLICATE', 'HIGH'],
  ['incident_without_source', 'lineage_completeness', 'INCIDENT_WITHOUT_SOURCE', 'HIGH'],
  ['timer_without_cause', 'lineage_completeness', 'TIMER_WITHOUT_CAUSING_EVENT', 'HIGH'],
  ['decision_without_evidence', 'lineage_completeness', 'DECISION_WITHOUT_EVIDENCE', 'CRITICAL'],
  ['policy_without_version', 'policy', 'POLICY_WITHOUT_VERSION', 'CRITICAL'],
  ['replay_non_reproducible', 'replay_reproducibility', 'REPLAY_NON_REPRODUCIBLE', 'CRITICAL'],
  ['unverifiable_relation', 'identity_confidence', 'RELATION_UNVERIFIABLE', 'HIGH'],
  ['incomplete_batch', 'completeness', 'BATCH_INCOMPLETE', 'HIGH'],
  ['incomplete_pagination', 'completeness', 'PAGINATION_INCOMPLETE', 'CRITICAL']
]);

function issue(orderId, raw, reference) {
  const normalized = {
    issue_id: raw.issue_id || stableId('quality', { orderId, type: raw.issue_type, source: raw.source, evidence: raw.evidence }),
    canonical_order_id: String(orderId), dimension: raw.dimension, issue_type: raw.issue_type,
    severity: raw.severity || 'MEDIUM', source: raw.source || 'fixture', first_seen_at: raw.first_seen_at || reference,
    last_seen_at: raw.last_seen_at || reference, evidence: structuredClone(raw.evidence || {}),
    blocking: raw.blocking ?? ['HIGH', 'CRITICAL'].includes(raw.severity), remediation: raw.remediation || 'REVIEW_SOURCE_DATA',
    status: raw.status || 'OPEN', schema_version: C0_SCHEMA_VERSION
  };
  return Object.freeze(normalized);
}

export class DataQualityEngine {
  detect(input, { asOf } = {}) {
    const issues = SIGNALS.filter(([signal]) => input.signals?.[signal]).map(([, dimension, issue_type, severity]) => ({
      dimension, issue_type, severity, source: input.signals.source || 'fixture',
      evidence: { signal_present: true }, blocking: ['HIGH', 'CRITICAL'].includes(severity)
    }));
    return this.evaluate({ ...input, issues: [...(input.issues || []), ...issues] }, { asOf });
  }

  evaluate(input, { asOf } = {}) {
    const reference = asOf || input.as_of;
    const issues = (input.issues || []).map((item) => issue(input.canonical_order_id, item, reference));
    const dimensions = {};
    for (const name of Object.keys(QUALITY_WEIGHTS)) {
      const relevant = issues.filter((item) => DIMENSION_BUCKETS[item.dimension] === name);
      dimensions[name] = Math.max(0, 100 - relevant.reduce((sum, item) => sum + PENALTIES[item.severity], 0));
    }
    const weighted = Object.entries(QUALITY_WEIGHTS).reduce((sum, [name, weight]) => sum + dimensions[name] * weight, 0) / 100;
    const critical = issues.some((item) => item.severity === 'CRITICAL');
    const blocking = issues.filter((item) => item.blocking).map((item) => item.issue_type);
    const score = critical ? 0 : Math.round(weighted);
    return Object.freeze({
      canonical_order_id: String(input.canonical_order_id), score, formula_version: C0_SCHEMA_VERSION,
      weights: QUALITY_WEIGHTS, dimensions, issues, critical_failure: critical,
      migration_eligible: !critical && blocking.length === 0,
      shadow_eligible: !critical && blocking.length === 0 && dimensions.identity_score > 0 && dimensions.replay_score > 0,
      blocking_reasons: [...new Set(blocking)].toSorted(), ...zeroActionEnvelope()
    });
  }
}
