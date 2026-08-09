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
  const ageSeconds = Number.isFinite(lastSuccessfulSyncAt) ? Math.floor((measuredAt - lastSuccessfulSyncAt) / 1000) : null;
  const ingestionLagSeconds = Number.isFinite(ingestedAt) && Number.isFinite(sourceEventAt)
    ? Math.floor((ingestedAt - sourceEventAt) / 1000) : null;
  const clockSkewSeconds = Number.isFinite(sourceEventAt) && Number.isFinite(sourceObservedAt)
    ? Math.floor((sourceEventAt - sourceObservedAt) / 1000)
    : Number.isFinite(lastSuccessfulSyncAt) ? Math.floor((lastSuccessfulSyncAt - measuredAt) / 1000) : null;
  let status = 'UNKNOWN';
  if (!invalid && Number.isFinite(threshold) && Number.isFinite(lastSuccessfulSyncAt)) {
    const futureTimestamp = [sourceObservedAt, sourceEventAt, ingestedAt, lastSuccessfulSyncAt]
      .filter(Number.isFinite).some((value) => value > measuredAt + clockSkewToleranceSeconds * 1000);
    const negativeIngestionLag = Number.isFinite(ingestionLagSeconds) && ingestionLagSeconds < -clockSkewToleranceSeconds;
    if (futureTimestamp || negativeIngestionLag) status = 'CLOCK_SKEW';
    else if (input.sync_complete === false || (Number.isFinite(lastFailureAt) && lastFailureAt >= lastSuccessfulSyncAt)) status = 'UNAVAILABLE';
    else status = ageSeconds > threshold ? 'STALE' : 'FRESH';
  }
  return Object.freeze({
    source_observed_at: Number.isFinite(sourceObservedAt) ? new Date(sourceObservedAt).toISOString() : null,
    source_event_at: Number.isFinite(sourceEventAt) ? new Date(sourceEventAt).toISOString() : null,
    ingested_at: Number.isFinite(ingestedAt) ? new Date(ingestedAt).toISOString() : null,
    last_successful_sync_at: Number.isFinite(lastSuccessfulSyncAt) ? new Date(lastSuccessfulSyncAt).toISOString() : null,
    age_seconds: Number.isFinite(ageSeconds) ? Math.max(0, ageSeconds) : null,
    ingestion_lag_seconds: Number.isFinite(ingestionLagSeconds) ? ingestionLagSeconds : null,
    clock_skew_seconds: Number.isFinite(clockSkewSeconds) ? clockSkewSeconds : null,
    freshness_threshold_seconds: Number.isFinite(threshold) ? threshold : null,
    freshness_status: status
  });
}
