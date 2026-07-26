import crypto from 'node:crypto';
import { deriveTimers } from './timer-engine.mjs';
import { unknown } from './contracts.mjs';

const TERMINAL = new Set(['DELIVERED', 'CANCELLED', 'RETURNED']);

function last(events, type) {
  return events.filter((event) => event.event_type === type).at(-1) || null;
}

function sourceQuality(events) {
  const sources = new Set(events.map((event) => event.source));
  const stale = events.filter((event) => event.freshness_status === 'STALE').map((event) => event.source);
  return {
    sources: [...sources],
    stale_sources: [...new Set(stale)],
    completeness: Math.min(1, sources.size / 4),
    freshness: stale.length ? 'STALE' : 'FRESH'
  };
}

export class OrderDigitalTwinBuilder {
  constructor(eventStore) {
    this.eventStore = eventStore;
  }

  buildCurrentTwin(orderId, now = new Date()) {
    return this.#build(orderId, this.eventStore.replay(orderId), now);
  }

  buildTwinAt(orderId, timestamp) {
    return this.#build(orderId, this.eventStore.replay(orderId, timestamp), new Date(timestamp));
  }

  rebuildTwin(orderId, now = new Date()) {
    return this.buildCurrentTwin(orderId, now);
  }

  compareTwins(left, right) {
    const changes = {};
    for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
      if (JSON.stringify(left[key]) !== JSON.stringify(right[key])) changes[key] = { before: left[key], after: right[key] };
    }
    return changes;
  }

  #build(orderId, events, now) {
    const created = last(events, 'ORDER_CREATED');
    const status = last(events, 'ORDER_STATUS_CHANGED')?.payload?.status || created?.payload?.status || 'UNKNOWN';
    const confirmed = last(events, 'CUSTOMER_CONFIRMED');
    const cancelled = last(events, 'CUSTOMER_CANCELLED');
    const changedMind = last(events, 'CUSTOMER_CHANGED_MIND');
    const incidentOpened = last(events, 'INCIDENT_OPENED');
    const incidentResolved = last(events, 'INCIDENT_RESOLVED');
    const pickup = last(events, 'GLS_PICKUP_AVAILABLE');
    const delivered = last(events, 'GLS_DELIVERED');
    const actionProposals = events.filter((event) => event.event_type === 'ACTION_PROPOSED');
    const quality = sourceQuality(events);
    const contradictions = [];
    if (confirmed && (cancelled || changedMind)) contradictions.push('CUSTOMER_INTENT_CONTRADICTION');
    if (delivered && status !== 'DELIVERED') contradictions.push('DELIVERY_STATUS_CONTRADICTION');
    const incidentActive = Boolean(incidentOpened && (!incidentResolved || new Date(incidentResolved.occurred_at) < new Date(incidentOpened.occurred_at)));
    const intent = changedMind || cancelled
      ? 'CANCEL'
      : confirmed ? 'CONFIRM'
        : last(events, 'CUSTOMER_REPLIED') ? 'REPLIED' : 'UNKNOWN';
    const snapshot = {
      order_id: String(orderId),
      snapshot_version: crypto.createHash('sha256').update(events.map((event) => event.checksum).join(':')).digest('hex').slice(0, 16),
      built_at: now.toISOString(),
      status: unknown(status),
      customer_intent: intent,
      confirmation_at: confirmed?.occurred_at || null,
      cancellation_at: (changedMind || cancelled)?.occurred_at || null,
      incident: incidentActive
        ? { active: true, type: incidentOpened.payload?.type || 'UNKNOWN', opened_at: incidentOpened.occurred_at }
        : { active: false, type: 'UNKNOWN', opened_at: null },
      logistics: {
        pickup_available: Boolean(pickup),
        delivered: Boolean(delivered),
        terminal: TERMINAL.has(status)
      },
      timers: deriveTimers(events, now),
      source_quality: quality,
      contradictions,
      warnings: [
        ...(quality.freshness === 'STALE' ? ['CRITICAL_SOURCE_STALE'] : []),
        ...(events.length === 0 ? ['NO_EVENTS'] : []),
        ...(actionProposals.length > 1 ? ['DUPLICATE_ACTION_PROPOSAL'] : [])
      ],
      evidence_event_ids: events.map((event) => event.event_id),
      event_count: events.length
    };
    return Object.freeze(snapshot);
  }
}
