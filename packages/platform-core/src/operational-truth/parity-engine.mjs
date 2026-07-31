import { C0_SCHEMA_VERSION, PARITY_RESULTS, stableId, zeroActionEnvelope } from './contracts.mjs';

function resultFor(dimension) {
  if (!dimension.assessed) return 'NOT_ASSESSED';
  if (!dimension.comparable) return 'NOT_COMPARABLE';
  if (dimension.blocked) return 'BLOCKED';
  if (dimension.expected_result === dimension.actual_result) return 'MATCHED';
  if (dimension.partial) return 'PARTIAL';
  return 'DIVERGENT';
}

export class FunctionalParityEngine {
  compare(input) {
    const dimensions = (input.dimensions || []).map((dimension) => {
      const result = resultFor(dimension);
      if (!PARITY_RESULTS.includes(result)) throw new Error('Invalid parity result');
      return Object.freeze({
        parity_dimension: dimension.parity_dimension, expected_result: dimension.expected_result ?? null,
        actual_result: dimension.actual_result ?? null, evidence: structuredClone(dimension.evidence || {}),
        difference_reason: dimension.difference_reason || null, severity: dimension.severity || 'INFO',
        migration_blocking: Boolean(dimension.migration_blocking || ['BLOCKED', 'NOT_COMPARABLE'].includes(result)),
        recommended_action: dimension.recommended_action || (result === 'MATCHED' ? 'NONE' : 'REVIEW'), result
      });
    });
    return Object.freeze({
      parity_id: stableId('parity', { order: input.canonical_order_id, dimensions }),
      canonical_order_id: String(input.canonical_order_id), dimensions,
      counts: Object.fromEntries(PARITY_RESULTS.map((result) => [result, dimensions.filter((item) => item.result === result).length])),
      migration_blocked: dimensions.some((item) => item.migration_blocking),
      global_percentage: null, schema_version: C0_SCHEMA_VERSION, ...zeroActionEnvelope()
    });
  }
}

