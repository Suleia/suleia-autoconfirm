import crypto from 'node:crypto';
import { containsDirectPii } from '../masking.mjs';
import { GOVERNANCE_EVENT_TYPES, deepFreeze } from './contracts.mjs';
import { containsSecret } from './compliance-engine.mjs';
import { minimizeUntrustedPayload } from './untrusted-content.mjs';

export class GovernanceEventStore {
  #events = [];
  #dedupe = new Set();

  append(input, { now = new Date() } = {}) {
    if (!GOVERNANCE_EVENT_TYPES.includes(input.event_type)) {
      throw new Error(`Unsupported governance event type: ${input.event_type}`);
    }
    const payload = minimizeUntrustedPayload(input.payload ?? {});
    if (containsDirectPii(payload) || containsSecret(payload)) {
      throw new Error('Governance events cannot contain PII or secrets');
    }
    const deduplicationKey = String(input.deduplication_key ?? '');
    if (!deduplicationKey) throw new Error('Governance events require a deduplication_key');
    if (this.#dedupe.has(deduplicationKey)) {
      return { inserted: false, event: this.#events.find((event) => event.deduplication_key === deduplicationKey) };
    }
    const event = deepFreeze({
      event_id: crypto.randomUUID(),
      event_type: input.event_type,
      occurred_at: new Date(now).toISOString(),
      correlation_id: input.correlation_id ?? null,
      deduplication_key: deduplicationKey,
      payload,
      append_only: true,
      run_mode: 'SIMULATION'
    });
    this.#dedupe.add(deduplicationKey);
    this.#events.push(event);
    return { inserted: true, event: structuredClone(event) };
  }

  list({ correlationId = null } = {}) {
    return this.#events
      .filter((event) => !correlationId || event.correlation_id === correlationId)
      .map((event) => structuredClone(event));
  }
}
