import crypto from 'node:crypto';
import { EVENT_TYPES, RUN_MODE } from './contracts.mjs';

const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;

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

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function normalizedTimestamp(value, field) {
  const milliseconds = new Date(value).getTime();
  if (!Number.isFinite(milliseconds)) throw new Error(`Invalid event timestamp: ${field}`);
  return { value: new Date(milliseconds).toISOString(), milliseconds };
}

export function createEvent(input, clock = () => new Date()) {
  if (!EVENT_TYPES.includes(input.event_type)) throw new Error(`Unsupported event type: ${input.event_type}`);
  const created = normalizedTimestamp(clock(), 'created_at');
  const createdAt = created.value;
  const occurred = normalizedTimestamp(input.occurred_at ?? createdAt, 'occurred_at');
  const received = normalizedTimestamp(input.received_at ?? createdAt, 'received_at');
  if (occurred.milliseconds > received.milliseconds) {
    throw new Error('Invalid event chronology: occurred_at is after received_at');
  }
  if (received.milliseconds > created.milliseconds + MAX_FUTURE_CLOCK_SKEW_MS) {
    throw new Error('Invalid event chronology: received_at exceeds trusted clock skew');
  }
  const orderId = String(input.order_id ?? '').trim();
  if (!orderId) throw new Error('Missing required field: order_id');
  const streamVersion = Number(input.stream_version ?? 1);
  if (!Number.isSafeInteger(streamVersion) || streamVersion < 1) {
    throw new Error('Invalid event stream_version');
  }
  const payload = input.payload && typeof input.payload === 'object' ? structuredClone(input.payload) : {};
  const event = {
    event_id: input.event_id || crypto.randomUUID(),
    order_id: orderId,
    event_type: input.event_type,
    occurred_at: occurred.value,
    received_at: received.value,
    source: input.source || 'fixture',
    source_record_id: input.source_record_id || null,
    stream_version: streamVersion,
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
  return deepFreeze(event);
}

export class InMemoryEventStore {
  #events = [];
  #dedupe = new Set();
  #streamVersions = new Map();

  append(input) {
    const deduplicationKey = input.deduplication_key
      || `${input.source || 'fixture'}:${input.source_record_id || input.event_id || crypto.randomUUID()}`;
    if (this.#dedupe.has(deduplicationKey)) {
      return { inserted: false, event: this.#events.find((item) => item.deduplication_key === deduplicationKey) };
    }
    const orderId = String(input.order_id ?? '').trim();
    const streamVersion = (this.#streamVersions.get(orderId) || 0) + 1;
    const event = createEvent({
      ...input,
      order_id: orderId,
      deduplication_key: deduplicationKey,
      stream_version: streamVersion
    });
    this.#dedupe.add(event.deduplication_key);
    this.#events.push(event);
    this.#streamVersions.set(orderId, streamVersion);
    return { inserted: true, event };
  }

  list(orderId) {
    return this.#events
      .filter((event) => !orderId || event.order_id === String(orderId))
      .toSorted((left, right) => {
        const temporal = new Date(left.occurred_at) - new Date(right.occurred_at);
        if (temporal !== 0) return temporal;
        return left.stream_version - right.stream_version;
      })
      .map((event) => structuredClone(event));
  }

  replay(orderId, until = null) {
    const limit = until ? normalizedTimestamp(until, 'replay_until').milliseconds : Number.POSITIVE_INFINITY;
    return this.list(orderId).filter((event) => new Date(event.occurred_at).getTime() <= limit);
  }
}
