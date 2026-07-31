import { C0_SCHEMA_VERSION, assertIso, canonical, fingerprint, zeroActionEnvelope } from './contracts.mjs';

function latestPolicy(policies, timestamp) {
  return policies.filter((policy) => Date.parse(policy.effective_from) <= Date.parse(timestamp)
    && (!policy.effective_until || Date.parse(policy.effective_until) > Date.parse(timestamp)))
    .toSorted((a, b) => Date.parse(a.effective_from) - Date.parse(b.effective_from)).at(-1) || null;
}

export class OperationalReplayEngine {
  constructor({ reducer }) {
    if (typeof reducer !== 'function') throw new Error('Replay reducer is required');
    this.reducer = reducer;
  }

  replayOrderAt(input, timestamp) {
    assertIso(timestamp, 'timestamp');
    const events = (input.events || []).filter((event) => Date.parse(event.occurred_at) <= Date.parse(timestamp))
      .toSorted((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at) || String(a.event_id).localeCompare(String(b.event_id)));
    const policy = latestPolicy(input.policies || [], timestamp);
    const state = this.reducer({ events: structuredClone(events), policy: structuredClone(policy), timers: structuredClone(input.timers || []), as_of: timestamp });
    const replay = {
      canonical_order_id: String(input.canonical_order_id), replayed_at: timestamp, as_of: timestamp,
      event_ids: events.map((event) => event.event_id), policy_version: policy?.version || 'UNKNOWN',
      state: canonical(state), result_hash: fingerprint({ events, policy, state, timestamp }),
      reproducible: true, schema_version: C0_SCHEMA_VERSION, ...zeroActionEnvelope()
    };
    return Object.freeze(replay);
  }

  replayDecisionAt(input, timestamp) { return this.replayOrderAt(input, timestamp); }

  compareReplayWithStoredSnapshot(input, timestamp, storedSnapshot) {
    const replay = this.replayOrderAt(input, timestamp);
    const storedHash = storedSnapshot.result_hash || fingerprint(storedSnapshot.state);
    return Object.freeze({ replay, stored_hash: storedHash, matches: replay.result_hash === storedHash || fingerprint(replay.state) === storedHash });
  }

  verifyReplayDeterminism(input, timestamp) {
    const first = this.replayOrderAt(input, timestamp);
    const second = this.replayOrderAt(structuredClone(input), timestamp);
    return Object.freeze({ deterministic: first.result_hash === second.result_hash, first_hash: first.result_hash, second_hash: second.result_hash });
  }
}

