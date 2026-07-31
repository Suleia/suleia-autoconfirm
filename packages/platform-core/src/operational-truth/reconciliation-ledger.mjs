import { C0_SCHEMA_VERSION, canonical, fingerprint, stableId, zeroActionEnvelope } from './contracts.mjs';

function classify(input) {
  if (!['EXACT', 'VERIFIED'].includes(input.identity_confidence)) return 'IDENTITY_MISMATCH';
  if (input.stale_fields?.length) return 'STALE_COMPARISON';
  if (input.reproducible === false) return 'NON_REPRODUCIBLE';
  if (input.missing_fields?.length && !(input.equal_fields?.length)) return 'INSUFFICIENT_DATA';
  if (input.different_fields?.length) return input.expected_difference ? 'EXPECTED_DIFFERENCE' : 'UNEXPECTED_DIFFERENCE';
  if (input.missing_fields?.length) return 'PARTIAL_MATCH';
  return 'MATCH';
}

function makeRecord(input, now) {
  const comparable = {
    canonical_order_id: String(input.canonical_order_id), source_a: input.source_a, source_b: input.source_b,
    snapshot_a: canonical(input.snapshot_a || {}), snapshot_b: canonical(input.snapshot_b || {}),
    fields_compared: [...(input.fields_compared || [])].toSorted(), equal_fields: [...(input.equal_fields || [])].toSorted(),
    different_fields: [...(input.different_fields || [])].toSorted(), missing_fields: [...(input.missing_fields || [])].toSorted(),
    stale_fields: [...(input.stale_fields || [])].toSorted(), identity_confidence: input.identity_confidence || 'UNKNOWN'
  };
  const recordFingerprint = fingerprint(comparable);
  return {
    reconciliation_id: stableId('reconciliation', recordFingerprint), ...comparable,
    comparison_result: classify(input), difference_classification: input.difference_classification || classify(input),
    first_seen_at: now, last_seen_at: now, occurrence_count: 1, resolved_at: null, resolution: null,
    fingerprint: recordFingerprint, idempotency_key: input.idempotency_key || recordFingerprint,
    schema_version: C0_SCHEMA_VERSION, ...zeroActionEnvelope()
  };
}

export class ReconciliationLedger {
  #records = new Map();

  constructor(serialized = null) {
    if (serialized) {
      const parsed = typeof serialized === 'string' ? JSON.parse(serialized) : structuredClone(serialized);
      for (const record of parsed.records || []) this.#records.set(record.idempotency_key, Object.freeze(record));
    }
  }

  reconcile(input, { now } = {}) {
    const reference = now || input.observed_at;
    const candidate = makeRecord(input, reference);
    const existing = this.#records.get(candidate.idempotency_key);
    if (existing) {
      const repeated = Object.freeze({ ...existing, last_seen_at: reference, occurrence_count: existing.occurrence_count + 1 });
      this.#records.set(candidate.idempotency_key, repeated);
      return { inserted: false, record: structuredClone(repeated) };
    }
    this.#records.set(candidate.idempotency_key, Object.freeze(candidate));
    return { inserted: true, record: structuredClone(candidate) };
  }

  resolve(idempotencyKey, resolution, { now } = {}) {
    const existing = this.#records.get(idempotencyKey);
    if (!existing) throw new Error('Reconciliation entry not found');
    const updated = Object.freeze({ ...existing, resolved_at: now, resolution });
    this.#records.set(idempotencyKey, updated);
    return structuredClone(updated);
  }

  list() { return [...this.#records.values()].map((record) => structuredClone(record)); }
  serialize() { return JSON.stringify({ schema_version: C0_SCHEMA_VERSION, records: this.list() }); }
}
