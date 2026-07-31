import { C0_SCHEMA_VERSION, assertNoSensitiveData, stableId, zeroActionEnvelope } from './contracts.mjs';

export function createOperationalTruthSummary(input, { generatedAt } = {}) {
  const summary = {
    operational_truth_summary_id: stableId('summary', { generatedAt, input }), generated_at: generatedAt,
    connector_health: structuredClone(input.connector_health || []), data_quality: structuredClone(input.data_quality || {}),
    identities: {
      exact: input.identities?.exact || 0, verified: input.identities?.verified || 0,
      partial: input.identities?.partial || 0, conflicting: input.identities?.conflicting || 0
    },
    comparable_orders: input.comparable_orders || 0, non_comparable_orders: input.non_comparable_orders || 0,
    reproducible_replays: input.reproducible_replays || 0, failed_replays: input.failed_replays || 0,
    parity_by_module: structuredClone(input.parity_by_module || {}), discrepancies: structuredClone(input.discrepancies || []),
    risks: structuredClone(input.risks || []), migration_readiness: input.migration_readiness || 'NOT_READY',
    new_cost_eur: 0, schema_version: C0_SCHEMA_VERSION, ...zeroActionEnvelope()
  };
  assertNoSensitiveData(summary);
  return Object.freeze(summary);
}

export function createC0ReadModels(input) {
  const models = {
    truth_snapshot: structuredClone(input.truth_snapshot || null),
    connector_health: structuredClone(input.connector_health || []),
    data_quality: structuredClone(input.data_quality || null),
    reconciliation: structuredClone(input.reconciliation || []),
    parity: structuredClone(input.parity || null), replay_result: structuredClone(input.replay_result || null),
    migration_readiness: structuredClone(input.migration_readiness || null),
    operational_truth_summary: structuredClone(input.operational_truth_summary || null)
  };
  assertNoSensitiveData(models);
  return Object.freeze(models);
}

