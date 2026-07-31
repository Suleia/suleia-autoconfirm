import { C0_SCHEMA_VERSION, TRUTH_STATUSES, assertIso, assertNoSensitiveData, stableId, zeroActionEnvelope } from './contracts.mjs';

function normalizeFact(fact, asOf) {
  assertIso(fact.source_timestamp, 'fact.source_timestamp');
  assertIso(fact.observed_at, 'fact.observed_at');
  const expired = fact.valid_until && Date.parse(fact.valid_until) < Date.parse(asOf);
  const freshness = expired || fact.freshness === 'STALE' ? 'STALE' : (fact.freshness || 'FRESH');
  return {
    fact_id: fact.fact_id || stableId('fact', fact),
    canonical_order_id: String(fact.canonical_order_id || ''),
    fact_type: String(fact.fact_type || 'UNKNOWN'),
    value_masked: fact.value_masked ?? 'UNKNOWN',
    source: String(fact.source || 'UNKNOWN'),
    source_record_id: String(fact.source_record_id || ''),
    source_timestamp: fact.source_timestamp,
    observed_at: fact.observed_at,
    freshness,
    confidence: Number.isFinite(fact.confidence) ? fact.confidence : 0,
    verification_status: fact.verification_status || 'OBSERVED',
    supporting_event_ids: [...(fact.supporting_event_ids || [])],
    contradicting_event_ids: [...(fact.contradicting_event_ids || [])],
    policy_version: fact.policy_version || 'UNKNOWN',
    schema_version: fact.schema_version || C0_SCHEMA_VERSION,
    valid_from: fact.valid_from || fact.source_timestamp,
    valid_until: fact.valid_until || null
  };
}

function resolveGroup(facts) {
  const active = facts.filter((fact) => fact.freshness !== 'STALE' && fact.verification_status !== 'SUPERSEDED');
  if (!active.length) return facts.map((fact) => ({ ...fact, verification_status: 'STALE' }));
  const values = new Set(active.map((fact) => JSON.stringify(fact.value_masked)));
  if (values.size > 1) return facts.map((fact) => ({ ...fact, verification_status: 'CONFLICTING' }));
  const sources = new Set(active.map((fact) => fact.source));
  return facts.map((fact) => ({
    ...fact,
    verification_status: fact.freshness === 'STALE' ? 'STALE'
      : sources.size >= 2 && fact.supporting_event_ids.length ? 'VERIFIED'
        : fact.verification_status === 'VERIFIED' ? 'PARTIALLY_VERIFIED' : fact.verification_status
  }));
}

export class RealityEngine {
  buildTruthSnapshot(input, { asOf } = {}) {
    const reference = assertIso(asOf || input.as_of, 'as_of');
    const facts = (input.facts || []).map((fact) => normalizeFact(fact, reference));
    const grouped = Map.groupBy(facts, (fact) => fact.fact_type);
    const resolvedFacts = [...grouped.values()].flatMap(resolveGroup);
    for (const fact of resolvedFacts) {
      if (!TRUTH_STATUSES.includes(fact.verification_status)) throw new Error(`Unsupported truth status: ${fact.verification_status}`);
    }
    const byStatus = (status) => resolvedFacts.filter((fact) => fact.verification_status === status);
    const available = [...new Set(resolvedFacts.map((fact) => fact.source))].toSorted();
    const expected = [...(input.sources_expected || [])].toSorted();
    const missing = expected.filter((source) => !available.includes(source));
    const conflicts = byStatus('CONFLICTING');
    const stale = byStatus('STALE');
    const identityStatus = input.identity?.status || 'UNKNOWN';
    const blocking = [
      ...(missing.length ? ['EXPECTED_SOURCE_MISSING'] : []),
      ...(conflicts.length ? ['CONFLICTING_FACTS'] : []),
      ...(stale.length ? ['STALE_FACTS'] : []),
      ...(!['EXACT', 'VERIFIED'].includes(identityStatus) ? [`IDENTITY_${identityStatus}`] : []),
      ...(input.replay_status !== 'REPRODUCIBLE' ? ['REPLAY_NOT_REPRODUCIBLE'] : [])
    ];
    const snapshot = {
      truth_snapshot_id: stableId('truth', { order: input.canonical_order_id, reference, resolvedFacts }),
      canonical_order_id: String(input.canonical_order_id || ''), generated_at: reference, as_of: reference,
      environment: 'staging', sources_expected: expected, sources_available: available,
      sources_missing: missing, source_states: structuredClone(input.source_states || {}),
      verified_facts: byStatus('VERIFIED'), partially_verified_facts: byStatus('PARTIALLY_VERIFIED'),
      conflicting_facts: conflicts, stale_facts: stale,
      unknown_facts: [...byStatus('UNKNOWN'), ...byStatus('MISSING')],
      identity_status: identityStatus, timeline_status: input.timeline_status || 'UNKNOWN',
      timer_status: input.timer_status || 'UNKNOWN', policy_status: input.policy_status || 'UNKNOWN',
      decision_status: input.decision_status || 'UNKNOWN', replay_status: input.replay_status || 'NOT_ASSESSED',
      parity_status: input.parity_status || 'NOT_ASSESSED', data_quality_score: input.data_quality_score ?? 0,
      truth_confidence: resolvedFacts.length ? Math.round(resolvedFacts.reduce((sum, fact) => sum + fact.confidence, 0) / resolvedFacts.length) : 0,
      migration_eligible: blocking.length === 0 && input.data_quality_score >= 80,
      shadow_eligible: blocking.length === 0 && input.data_quality_score >= 80,
      blocking_reasons: [...new Set(blocking)].toSorted(), schema_version: C0_SCHEMA_VERSION,
      ...zeroActionEnvelope()
    };
    assertNoSensitiveData(snapshot);
    return Object.freeze(snapshot);
  }
}

