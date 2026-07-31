import { C0_SCHEMA_VERSION, CONNECTOR_STATES, SOURCES, stableId, zeroActionEnvelope } from './contracts.mjs';

function transportState(sample) {
  if (sample.blocked) return 'BLOCKED';
  if (!sample.authentication || !sample.permissions) return 'MISCONFIGURED';
  if (!sample.available) return 'UNAVAILABLE';
  if ((sample.timeout_rate || 0) > 0.1 || (sample.error_rate || 0) > 0.1) return 'UNSTABLE';
  if ((sample.timeout_rate || 0) > 0 || (sample.error_rate || 0) > 0 || (sample.latency_ms || 0) > 2_000) return 'DEGRADED';
  return 'HEALTHY';
}

function dataState(sample) {
  if (sample.schema_errors > 0 || sample.schema_valid === false) return 'MISCONFIGURED';
  if (sample.pagination_complete === false) return 'DEGRADED';
  if (sample.freshness === 'STALE') return 'STALE';
  if (sample.records_expected > 0 && sample.records_returned === 0) return 'UNAVAILABLE';
  if ((sample.duplicate_rate || 0) > 0 || (sample.identity_linking_rate ?? 1) < 0.9) return 'DEGRADED';
  return 'HEALTHY';
}

export class ConnectorHealthEngine {
  evaluate(sample, { observedAt } = {}) {
    if (!SOURCES.includes(sample.connector)) throw new Error(`Unsupported connector: ${sample.connector}`);
    const transport_health = transportState(sample);
    const data_health = dataState(sample);
    if (!CONNECTOR_STATES.includes(transport_health) || !CONNECTOR_STATES.includes(data_health)) throw new Error('Invalid connector state');
    return Object.freeze({
      connector_health_id: stableId('connector', { connector: sample.connector, observedAt, sample }),
      connector: sample.connector, observed_at: observedAt || sample.observed_at,
      transport_health, data_health, availability: Boolean(sample.available),
      authentication: Boolean(sample.authentication), permissions: Boolean(sample.permissions),
      latency_ms: sample.latency_ms ?? null, timeout_rate: sample.timeout_rate || 0, error_rate: sample.error_rate || 0,
      schema_errors: sample.schema_errors || 0, pagination_complete: sample.pagination_complete !== false,
      freshness: sample.freshness || 'UNKNOWN', records_returned: sample.records_returned || 0,
      duplicate_rate: sample.duplicate_rate || 0, identity_linking_rate: sample.identity_linking_rate ?? 0,
      rate_limit_usage: sample.rate_limit_usage ?? null, circuit_breaker_state: sample.circuit_breaker_state || 'CLOSED',
      last_successful_read: sample.last_successful_read || null, last_failed_read: sample.last_failed_read || null,
      schema_version: C0_SCHEMA_VERSION, ...zeroActionEnvelope()
    });
  }
}

