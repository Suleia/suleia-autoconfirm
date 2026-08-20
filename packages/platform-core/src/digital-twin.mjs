import crypto from 'node:crypto';
import { deriveTimers } from './timer-engine.mjs';
import { unknown } from './contracts.mjs';

const TERMINAL = new Set(['DELIVERED', 'CANCELLED', 'RETURNED']);

function last(events, type) {
  return events.filter((event) => event.event_type === type).at(-1) || null;
}

const CUSTOMER_INTENT_TYPES = new Map([
  ['CUSTOMER_RETURN_REQUESTED', 'RETURN'],
  ['CUSTOMER_DELIVERY_RECONFIRMED', 'RECEIVE'],
  ['CUSTOMER_AGENCY_PICKUP_REQUESTED', 'AGENCY_PICKUP'],
  ['CUSTOMER_CONFIRMED', 'CONFIRM'],
  ['CUSTOMER_CANCELLED', 'CANCEL'],
  ['CUSTOMER_CHANGED_MIND', 'CANCEL']
]);

const CARRIER_STATE_TYPES = new Map([
  ['CARRIER_SHIPMENT_NOT_ACCEPTED', 'SHIPMENT_NOT_ACCEPTED'],
  ['CARRIER_AGENCY_PICKUP_CONFIRMED', 'AGENCY_PICKUP_CONFIRMED'],
  ['GLS_PICKUP_AVAILABLE', 'AGENCY_PICKUP_CONFIRMED'],
  ['GLS_RETURNED', 'RETURNED_TO_ORIGIN'],
  ['GLS_DELIVERED', 'DELIVERED']
]);

function evidence(event, value) {
  if (!event) return null;
  return {
    event_id: event.event_id,
    event_type: event.event_type,
    value,
    occurred_at: event.occurred_at,
    source: event.source,
    trust_level: event.trust_level,
    freshness_status: event.freshness_status
  };
}

function latestCustomerIntent(events) {
  const candidates = events.flatMap((event) => {
    if (CUSTOMER_INTENT_TYPES.has(event.event_type)) {
      return [{ event, value: CUSTOMER_INTENT_TYPES.get(event.event_type) }];
    }
    const payloadIntent = String(event.payload?.intent || '').toUpperCase();
    if (event.event_type === 'CUSTOMER_REPLIED' && ['RETURN', 'RECEIVE', 'AGENCY_PICKUP'].includes(payloadIntent)) {
      return [{ event, value: payloadIntent }];
    }
    return [];
  });
  return candidates.at(-1) || null;
}

function latestCarrierState(events) {
  const candidates = events.flatMap((event) => {
    if (CARRIER_STATE_TYPES.has(event.event_type)) {
      return [{ event, value: CARRIER_STATE_TYPES.get(event.event_type) }];
    }
    const state = String(event.payload?.state || event.payload?.status || '').toUpperCase();
    if (event.event_type === 'GLS_STATUS_UPDATED' && state) return [{ event, value: state }];
    return [];
  });
  return candidates.at(-1) || null;
}

function freshnessDomain(eventType = '') {
  if (/^(?:CUSTOMER_|CHATBY_)/.test(eventType)) return 'CUSTOMER';
  if (/^(?:CARRIER_|GLS_)/.test(eventType)) return 'LOGISTICS';
  if (/^INCIDENT_/.test(eventType)) return 'INCIDENT';
  if (/^ORDER_/.test(eventType)) return 'ORDER';
  if (/^TIMER_/.test(eventType)) return 'TIMER';
  if (/^ACTION_/.test(eventType)) return 'ACTION';
  return eventType || 'UNKNOWN';
}

function sourceQuality(events) {
  const sources = new Set(events.map((event) => event.source));
  const latestByDomain = new Map();
  for (const event of events) {
    const key = `${event.source}:${freshnessDomain(event.event_type)}`;
    const previous = latestByDomain.get(key);
    if (!previous
      || new Date(event.occurred_at) > new Date(previous.occurred_at)
      || (event.occurred_at === previous.occurred_at && event.stream_version > previous.stream_version)) {
      latestByDomain.set(key, event);
    }
  }
  const stale = [...latestByDomain.entries()]
    .filter(([, event]) => event.freshness_status === 'STALE');
  return {
    sources: [...sources],
    stale_sources: [...new Set(stale.map(([, event]) => event.source))],
    stale_domains: stale.map(([key]) => key),
    completeness: Math.min(1, sources.size / 4),
    freshness: stale.length ? 'STALE' : 'FRESH'
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
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
    const customerIntentEvidence = latestCustomerIntent(events);
    const carrierStateEvidence = latestCarrierState(events);
    const incidentHistory = events
      .filter((event) => event.event_type.startsWith('INCIDENT_') || CARRIER_STATE_TYPES.has(event.event_type) || event.event_type === 'GLS_STATUS_UPDATED')
      .map((event) => evidence(event, CARRIER_STATE_TYPES.get(event.event_type) || event.payload?.state || event.payload?.type || 'UNKNOWN'));
    const actionProposals = events.filter((event) => event.event_type === 'ACTION_PROPOSED');
    const quality = sourceQuality(events);
    const contradictions = [];
    const latestCancellation = [cancelled, changedMind]
      .filter(Boolean)
      .toSorted((left, right) => (
        new Date(left.occurred_at) - new Date(right.occurred_at)
        || Number(left.stream_version || 0) - Number(right.stream_version || 0)
      ))
      .at(-1);
    if (confirmed && latestCancellation && confirmed.occurred_at === latestCancellation.occurred_at) {
      contradictions.push('CUSTOMER_INTENT_CONTRADICTION');
    }
    if (delivered && status !== 'DELIVERED') contradictions.push('DELIVERY_STATUS_CONTRADICTION');
    const incidentActive = Boolean(incidentOpened && (!incidentResolved || new Date(incidentResolved.occurred_at) < new Date(incidentOpened.occurred_at)));
    const intent = customerIntentEvidence?.value
      || (last(events, 'CUSTOMER_REPLIED') ? 'REPLIED' : 'UNKNOWN');
    const conflictingEvidence = [];
    const pickupEvidence = incidentHistory.find((item) => item.value === 'AGENCY_PICKUP_CONFIRMED');
    if (pickupEvidence && carrierStateEvidence?.value === 'RETURNED_TO_ORIGIN') {
      conflictingEvidence.push('AGENCY_PICKUP_SUPERSEDED_BY_RETURN');
    }
    const returnRequest = events.filter((event) => event.event_type === 'CUSTOMER_RETURN_REQUESTED').at(-1);
    const receiveAgain = events.filter((event) => event.event_type === 'CUSTOMER_DELIVERY_RECONFIRMED').at(-1);
    if (returnRequest && receiveAgain && new Date(receiveAgain.occurred_at) > new Date(returnRequest.occurred_at)) {
      conflictingEvidence.push('CUSTOMER_RETURN_REVOKED');
    }
    const latestRelevant = [
      customerIntentEvidence ? evidence(customerIntentEvidence.event, customerIntentEvidence.value) : null,
      carrierStateEvidence ? evidence(carrierStateEvidence.event, carrierStateEvidence.value) : null
    ].filter(Boolean).sort((left, right) => new Date(left.occurred_at) - new Date(right.occurred_at)).at(-1) || null;
    const snapshot = {
      order_id: String(orderId),
      state_version: events.reduce((highest, event) => Math.max(highest, Number(event.stream_version || 0)), 0),
      snapshot_version: crypto.createHash('sha256').update(events.map((event) => event.checksum).join(':')).digest('hex').slice(0, 16),
      built_at: now.toISOString(),
      status: unknown(status),
      customer_intent: intent,
      customer_intent_evidence: customerIntentEvidence ? evidence(customerIntentEvidence.event, customerIntentEvidence.value) : null,
      confirmation_at: confirmed?.occurred_at || null,
      cancellation_at: latestCancellation?.occurred_at || null,
      incident: incidentActive
        ? { active: true, type: incidentOpened.payload?.type || 'UNKNOWN', opened_at: incidentOpened.occurred_at }
        : { active: false, type: 'UNKNOWN', opened_at: null },
      logistics: {
        pickup_available: Boolean(pickup),
        delivered: Boolean(delivered),
        terminal: TERMINAL.has(status),
        carrier_state: carrierStateEvidence?.value || 'UNKNOWN',
        carrier_evidence: carrierStateEvidence ? evidence(carrierStateEvidence.event, carrierStateEvidence.value) : null
      },
      incident_history: incidentHistory,
      latest_relevant_event: latestRelevant,
      evidence_freshness: latestRelevant?.freshness_status || quality.freshness,
      conflicting_evidence: conflictingEvidence,
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
    return deepFreeze(snapshot);
  }
}
