export const FRESHNESS_THRESHOLDS_SECONDS = Object.freeze({
  chatby: 300,
  dropea: 600,
  gls: 900,
  shopify: 900
});

const parseTimestamp = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.NaN;
};

export function freshnessThresholdForSource(source, overrides = {}) {
  const normalized = String(source || '').toLowerCase();
  const key = Object.keys(FRESHNESS_THRESHOLDS_SECONDS).find((candidate) => normalized.includes(candidate));
  const configured = key ? overrides[key] ?? FRESHNESS_THRESHOLDS_SECONDS[key] : overrides.default;
  return Number.isFinite(Number(configured)) && Number(configured) >= 0 ? Number(configured) : null;
}

export function evaluateSourceFreshness(input = {}, { now = new Date(), thresholds = {}, clockSkewToleranceSeconds = 5 } = {}) {
  const measuredAt = parseTimestamp(now);
  const sourceObservedAt = parseTimestamp(input.source_observed_at);
  const sourceEventAt = parseTimestamp(input.source_event_at);
  const ingestedAt = parseTimestamp(input.ingested_at);
  const lastSuccessfulSyncAt = parseTimestamp(input.last_successful_sync_at);
  const lastFailureAt = parseTimestamp(input.last_failure_at);
  const threshold = input.freshness_threshold_seconds ?? freshnessThresholdForSource(input.source, thresholds);
  const timestampValues = [measuredAt, sourceObservedAt, sourceEventAt, ingestedAt, lastSuccessfulSyncAt, lastFailureAt]
    .filter((value) => value !== null);
  const invalid = !Number.isFinite(measuredAt) || timestampValues.some((value) => Number.isNaN(value));
  const pollAgeSeconds = Number.isFinite(lastSuccessfulSyncAt) ? Math.floor((measuredAt - lastSuccessfulSyncAt) / 1000) : null;
  const sourceEventAgeSeconds = Number.isFinite(sourceEventAt) ? Math.floor((measuredAt - sourceEventAt) / 1000) : null;
  const ingestionLagSeconds = Number.isFinite(ingestedAt) && Number.isFinite(sourceEventAt)
    ? Math.floor((ingestedAt - sourceEventAt) / 1000) : null;
  const futureSkewSeconds = [sourceObservedAt, sourceEventAt, ingestedAt, lastSuccessfulSyncAt]
    .filter(Number.isFinite)
    .reduce((maximum, value) => Math.max(maximum, Math.floor((value - measuredAt) / 1000)), 0);
  const negativeLagSkewSeconds = Number.isFinite(ingestionLagSeconds) && ingestionLagSeconds < 0
    ? Math.abs(ingestionLagSeconds) : 0;
  const clockSkewSeconds = Math.max(futureSkewSeconds, negativeLagSkewSeconds);
  let status = 'UNKNOWN';
  let reason = 'MISSING_OR_INVALID_TIMESTAMPS';
  if (!invalid && Number.isFinite(threshold) && Number.isFinite(lastSuccessfulSyncAt)) {
    const futureTimestamp = futureSkewSeconds > clockSkewToleranceSeconds;
    const negativeIngestionLag = Number.isFinite(ingestionLagSeconds) && ingestionLagSeconds < -clockSkewToleranceSeconds;
    if (futureTimestamp || negativeIngestionLag) {
      status = 'CLOCK_SKEW';
      reason = 'TIMESTAMP_CLOCK_SKEW';
    } else if (input.sync_complete === false || (Number.isFinite(lastFailureAt) && lastFailureAt >= lastSuccessfulSyncAt)) {
      status = 'UNAVAILABLE';
      reason = input.sync_complete === false ? 'SYNC_INCOMPLETE' : 'LATEST_SYNC_FAILED';
    } else if (pollAgeSeconds > threshold) {
      status = 'STALE';
      reason = 'POLL_STALE';
    } else if (Number.isFinite(sourceEventAgeSeconds) && sourceEventAgeSeconds > threshold + clockSkewToleranceSeconds) {
      status = 'STALE';
      reason = 'SOURCE_EVENT_STALE';
    } else {
      status = 'FRESH';
      reason = 'WITHIN_THRESHOLD';
    }
  }
  return Object.freeze({
    source_observed_at: Number.isFinite(sourceObservedAt) ? new Date(sourceObservedAt).toISOString() : null,
    source_event_at: Number.isFinite(sourceEventAt) ? new Date(sourceEventAt).toISOString() : null,
    ingested_at: Number.isFinite(ingestedAt) ? new Date(ingestedAt).toISOString() : null,
    last_successful_sync_at: Number.isFinite(lastSuccessfulSyncAt) ? new Date(lastSuccessfulSyncAt).toISOString() : null,
    age_seconds: Number.isFinite(pollAgeSeconds) ? Math.max(0, pollAgeSeconds) : null,
    poll_age_seconds: Number.isFinite(pollAgeSeconds) ? Math.max(0, pollAgeSeconds) : null,
    source_event_age_seconds: Number.isFinite(sourceEventAgeSeconds) ? Math.max(0, sourceEventAgeSeconds) : null,
    ingestion_lag_seconds: Number.isFinite(ingestionLagSeconds) ? ingestionLagSeconds : null,
    clock_skew_seconds: invalid ? null : clockSkewSeconds,
    freshness_threshold_seconds: Number.isFinite(threshold) ? threshold : null,
    freshness_status: status,
    freshness_reason: reason
  });
}
