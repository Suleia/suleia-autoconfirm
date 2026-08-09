import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSourceFreshness } from '../src/operational-truth/freshness.mjs';

const NOW = new Date('2026-10-25T01:30:00Z');
const atAge = (seconds) => new Date(NOW.getTime() - seconds * 1000).toISOString();
const dropea = (age, extra = {}) => evaluateSourceFreshness({
  source: 'DROPEA_PUBLIC_API_ES', source_observed_at: atAge(age), source_event_at: atAge(age + 3),
  ingested_at: atAge(age), last_successful_sync_at: atAge(age), sync_complete: true, ...extra
}, { now: NOW });

test('Dropea is fresh at 9 and 10 minutes and stale at 11 minutes', () => {
  assert.equal(dropea(540).freshness_status, 'FRESH');
  assert.equal(dropea(600).freshness_status, 'FRESH');
  assert.equal(dropea(660).freshness_status, 'STALE');
});

test('the audited 80650 second Dropea delay is STALE', () => {
  const result = dropea(80_650);
  assert.equal(result.age_seconds, 80_650);
  assert.equal(result.freshness_status, 'STALE');
});

test('future source time is CLOCK_SKEW and never FRESH', () => {
  assert.equal(dropea(0, { source_event_at: new Date(NOW.getTime() + 60_000).toISOString() }).freshness_status, 'CLOCK_SKEW');
});

test('null or invalid timestamps are UNKNOWN', () => {
  assert.equal(evaluateSourceFreshness(undefined, { now: NOW }).freshness_status, 'UNKNOWN');
  assert.equal(evaluateSourceFreshness({ source: 'dropea' }, { now: NOW }).freshness_status, 'UNKNOWN');
  assert.equal(evaluateSourceFreshness({ source: 'dropea', last_successful_sync_at: 'invalid' }, { now: NOW }).freshness_status, 'UNKNOWN');
});

test('partial synchronization and a newer failure are UNAVAILABLE', () => {
  assert.equal(dropea(60, { sync_complete: false }).freshness_status, 'UNAVAILABLE');
  assert.equal(dropea(60, { last_failure_at: atAge(30) }).freshness_status, 'UNAVAILABLE');
});

test('UTC calculation is stable across the Europe Madrid DST fallback instant', () => {
  const value = dropea(600);
  assert.equal(value.age_seconds, 600);
  assert.equal(value.freshness_status, 'FRESH');
});
