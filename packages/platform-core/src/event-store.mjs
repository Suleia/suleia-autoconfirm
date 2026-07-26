import crypto from 'node:crypto';
import { EVENT_TYPES, RUN_MODE } from './contracts.mjs';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function checksum(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export function createEvent(input, clock = () => new Date()) {
  if (!EVENT_TYPES.includes(input.event_type)) throw new Error(`Unsupported event type: ${input.event_type}`);
  const createdAt = clock().toISOString();
  const payload = input.payload && typeof input.payload === 'object' ? structuredClone(input.payload) : {};
  const event = {
    event_id: input.event_id || crypto.randomUUID(),
    order_id: String(input.order_id || ''),
    event_type: input.event_type,
    occurred_at: input.occurred_at || createdAt,
    received_at: input.received_at || createdAt,
    source: input.source || 'fixture',
    source_record_id: input.source_record_id || null,
    schema_version: input.schema_version || 1,
    payload,
    checksum: '',
    deduplication_key: input.deduplication_key || `${input.source || 'fixture'}:${input.source_record_id || input.event_id || crypto.randomUUID()}`,
    trust_level: input.trust_level || 'MEDIUM',
    freshness_status: input.freshness_status || 'FRESH',
    masking_version: input.masking_version || 'v1',
    correlation_id: input.correlation_id || null,
    causation_id: input.causation_id || null,
    run_mode: RUN_MODE,
    supersedes_event_id: input.supersedes_event_id || null,
    created_at: createdAt
  };
  event.checksum = checksum({ ...event, checksum: undefined });
  return Object.freeze(event);
}

export class InMemoryEventStore {
  #events = [];
  #dedupe = new Set();

  append(input) {
    const event = createEvent(input);
    if (this.#dedupe.has(event.deduplication_key)) {
      return { inserted: false, event: this.#events.find((item) => item.deduplication_key === event.deduplication_key) };
    }
    this.#dedupe.add(event.deduplication_key);
    this.#events.push(event);
    return { inserted: true, event };
  }

  list(orderId) {
    return this.#events
      .filter((event) => !orderId || event.order_id === String(orderId))
      .toSorted((left, right) => new Date(left.occurred_at) - new Date(right.occurred_at))
      .map((event) => structuredClone(event));
  }

  replay(orderId, until = null) {
    const limit = until ? new Date(until).getTime() : Number.POSITIVE_INFINITY;
    return this.list(orderId).filter((event) => new Date(event.occurred_at).getTime() <= limit);
  }
}
