import crypto from 'node:crypto';
import { InMemoryEventStore } from './event-store.mjs';
import { LocalIngestionPipeline } from './ingestion-pipeline.mjs';
import { OrderDigitalTwinBuilder } from './digital-twin.mjs';
import { DeterministicDecisionEngine } from './decision-engine.mjs';
import { containsDirectPii } from './masking.mjs';
import { deadlineFrom } from './timer-engine.mjs';
import { isWithinBusinessDay } from './business-day.mjs';

const BATCH_TYPE = 'TODAY_REAL_MASKED_SIMULATION';

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function countPiiFields(value) {
  if (Array.isArray(value)) return value.reduce((total, item) => total + countPiiFields(item), 0);
  if (!value || typeof value !== 'object') return 0;
  return Object.entries(value).reduce((total, [key, item]) => {
    const direct = /name|phone|mobile|email|address|direccion|postal|zip|dni|nie|iban|card|conversation|message|note|comment/i.test(key);
    return total + (direct && item ? 1 : 0) + countPiiFields(item);
  }, 0);
}

function canonicalStatus(order) {
  if (order.cancelled_at) return 'CANCELLED';
  return String(order.status || order.fulfillment_status || order.financial_status || 'UNKNOWN').toUpperCase();
}

function eventPayload(order) {
  return {
    status: canonicalStatus(order),
    financial_status: order.financial_status || 'UNKNOWN',
    fulfillment_status: order.fulfillment_status || 'UNKNOWN',
    currency: order.currency || 'UNKNOWN',
    item_count: Number(order.item_count || 0),
    source_created_at: order.created_at,
    tracking_present: Boolean(order.tracking_present),
    incident_present: Boolean(order.incident_present)
  };
}

function semanticEvents(order, maskedOrderId) {
  const events = [{
    source: 'SHOPIFY',
    source_record_id: order.identity_key,
    order_id: maskedOrderId,
    event_type: 'ORDER_CREATED',
    occurred_at: order.created_at,
    payload: eventPayload(order),
    trust_level: 'HIGH'
  }];

  if (canonicalStatus(order) !== 'UNKNOWN') {
    events.push({
      source: 'SHOPIFY',
      source_record_id: `${order.identity_key}:status`,
      order_id: maskedOrderId,
      event_type: 'ORDER_STATUS_CHANGED',
      occurred_at: order.updated_at || order.created_at,
      payload: { status: canonicalStatus(order) },
      trust_level: 'HIGH'
    });
  }

  const signal = order.chatby_signal;
  if (signal?.intent === 'CONFIRM' || signal?.intent === 'CANCEL' || signal?.intent === 'CHANGED_MIND') {
    const eventType = signal.intent === 'CONFIRM'
      ? 'CUSTOMER_CONFIRMED'
      : signal.intent === 'CHANGED_MIND' ? 'CUSTOMER_CHANGED_MIND' : 'CUSTOMER_CANCELLED';
    events.push({
      source: 'CHATBY',
      source_record_id: signal.source_record_id_hash || hash(`${order.identity_key}:${signal.occurred_at}:${signal.intent}`),
      order_id: maskedOrderId,
      event_type: eventType,
      occurred_at: signal.occurred_at,
      payload: { intent: signal.intent, evidence_type: signal.evidence_type || 'SEMANTIC_SIGNAL' },
      trust_level: 'HIGH'
    });
    if (signal.intent === 'CONFIRM') {
      events.push({
        source: 'CHATBY',
        source_record_id: hash(`${order.identity_key}:confirmation-timer`),
        order_id: maskedOrderId,
        event_type: 'TIMER_STARTED',
        occurred_at: signal.occurred_at,
        payload: {
          timer_id: `confirmation-${maskedOrderId}`,
          workflow: 'CONFIRMATION_WAIT_1H',
          deadline_at: deadlineFrom(signal.occurred_at, 1)
        },
        trust_level: 'HIGH'
      });
    }
  }

  if (order.incident_present) {
    events.push({
      source: 'DROPEA',
      source_record_id: hash(`${order.identity_key}:incident`),
      order_id: maskedOrderId,
      event_type: 'INCIDENT_OPENED',
      occurred_at: order.incident_at || order.updated_at || order.created_at,
      payload: { type: order.incident_type || 'UNKNOWN' },
      trust_level: order.direct_dropea_read ? 'HIGH' : 'MEDIUM',
      freshness_status: order.direct_dropea_read ? 'FRESH' : 'STALE'
    });
  }

  if (order.logistics_state === 'DELIVERED') {
    events.push({
      source: 'GLS',
      source_record_id: hash(`${order.identity_key}:delivered`),
      order_id: maskedOrderId,
      event_type: 'GLS_DELIVERED',
      occurred_at: order.logistics_at || order.updated_at || order.created_at,
      payload: { state: 'DELIVERED' },
      trust_level: order.direct_gls_read ? 'HIGH' : 'MEDIUM',
      freshness_status: order.direct_gls_read ? 'FRESH' : 'STALE'
    });
  }
  return events;
}

function compareWithCurrent(decision, current) {
  if (!current) return { result: 'INSUFFICIENT_DATA', reasons: ['CURRENT_SYSTEM_ORDER_NOT_AVAILABLE'] };
  const currentAction = String(current.action || current.agentAction || current.status || 'UNKNOWN').toUpperCase();
  const proposed = String(decision.proposed_action || 'UNKNOWN').toUpperCase();
  if (currentAction === proposed) return { result: 'MATCH', reasons: [] };
  if (currentAction.includes('WAIT') && proposed.includes('WAIT')) return { result: 'PARTIAL_MATCH', reasons: ['WAIT_VARIANT'] };
  if (current.too_recent || decision.proposed_action.startsWith('WAIT_')) {
    return { result: 'EXPECTED_DIFFERENCE', reasons: ['ORDER_TOO_RECENT_OR_TIMER_ACTIVE'] };
  }
  return { result: 'UNEXPECTED_DIFFERENCE', reasons: ['CURRENT_ACTION_DIFFERS_FROM_SIMULATION'] };
}

function privateEventView(event) {
  return {
    event_id: event.event_id,
    event_type: event.event_type,
    occurred_at: event.occurred_at,
    source: event.source,
    payload: event.payload,
    checksum: event.checksum,
    trust_level: event.trust_level,
    freshness_status: event.freshness_status,
    masking_version: event.masking_version,
    run_mode: event.run_mode
  };
}

function routeCounts(results) {
  return results.reduce((counts, result) => {
    counts[result.route] = (counts[result.route] || 0) + 1;
    return counts;
  }, {});
}

function comparisonCounts(results) {
  return results.reduce((counts, result) => {
    counts[result.comparison_result] = (counts[result.comparison_result] || 0) + 1;
    return counts;
  }, {});
}

export function runTodayBatch({
  sourceOrders,
  currentSystemOrders = [],
  bounds,
  sourceStatus = {},
  now = new Date(),
  preview = false
}) {
  const startedAt = new Date();
  const inside = sourceOrders.filter((order) => isWithinBusinessDay(order.created_at, bounds));
  const outsideCount = sourceOrders.length - inside.length;
  const unique = new Map();
  for (const order of inside) {
    const identity = String(order.identity_key || '');
    if (!identity) continue;
    if (!unique.has(identity)) unique.set(identity, order);
  }
  const sorted = [...unique.values()].sort((left, right) => (
    new Date(left.created_at) - new Date(right.created_at)
      || String(left.identity_key).localeCompare(String(right.identity_key))
  ));
  const currentByReference = new Map();
  for (const current of currentSystemOrders) {
    for (const reference of current.identity_references || []) {
      if (!currentByReference.has(String(reference))) currentByReference.set(String(reference), []);
      currentByReference.get(String(reference)).push(current);
    }
  }

  if (preview) {
    return {
      batch_type: BATCH_TYPE,
      status: Object.values(sourceStatus).every((source) => source.complete !== false) ? 'PREVIEW_COMPLETE' : 'PREVIEW_INCOMPLETE',
      business_date: bounds.business_date,
      timezone: bounds.time_zone,
      utc_start: bounds.utc_start,
      utc_end: bounds.utc_end_exclusive,
      estimated_orders: sorted.length,
      pages_required: Object.fromEntries(Object.entries(sourceStatus).map(([name, value]) => [name, value.page_count ?? null])),
      sources_consultable: Object.fromEntries(Object.entries(sourceStatus).map(([name, value]) => [name, Boolean(value.consultable)])),
      orders_with_conversation: sorted.filter((order) => order.chatby_signal).length,
      orders_with_tracking: sorted.filter((order) => order.tracking_present).length,
      orders_with_incident: sorted.filter((order) => order.incident_present).length,
      possible_integration_errors: Object.values(sourceStatus).filter((source) => source.error).length,
      outside_interval_rejected: outsideCount,
      actions_executed: 0,
      pii_persisted_count: 0
    };
  }

  const results = [];
  let piiDetected = 0;
  const sourceIncomplete = Object.values(sourceStatus).some((source) => source.complete === false);
  for (let index = 0; index < sorted.length; index += 1) {
    const order = sorted[index];
    const maskedOrderId = `TODAY-MASKED-${String(index + 1).padStart(4, '0')}`;
    piiDetected += countPiiFields(order.raw_ephemeral || order);
    const eventStore = new InMemoryEventStore();
    const pipeline = new LocalIngestionPipeline(eventStore);
    for (const event of semanticEvents(order, maskedOrderId)) pipeline.ingest(event);
    const twin = new OrderDigitalTwinBuilder(eventStore).buildCurrentTwin(maskedOrderId, now);
    const decision = new DeterministicDecisionEngine().simulate(twin);
    const currentMatches = new Set();
    for (const reference of order.identity_references || []) {
      for (const item of currentByReference.get(String(reference)) || []) currentMatches.add(item);
    }
    const comparison = currentMatches.size > 1
      ? { result: 'INSUFFICIENT_DATA', reasons: ['POSSIBLE_IDENTITY_MISMATCH'] }
      : compareWithCurrent(decision, [...currentMatches][0] || null);
    const result = {
      masked_order_id: maskedOrderId,
      created_at: order.created_at,
      sources_available: twin.source_quality.sources,
      freshness: {
        status: twin.source_quality.freshness,
        stale_sources: twin.source_quality.stale_sources
      },
      completeness: twin.source_quality.completeness,
      workflow: decision.workflow,
      current_state: twin.status,
      active_timers: twin.timers,
      customer_intent: twin.customer_intent,
      logistics_state: order.logistics_state || 'UNKNOWN',
      incident_state: twin.incident.active ? 'ACTIVE' : 'UNKNOWN',
      proposed_action: decision.proposed_action,
      route: sourceIncomplete ? 'BLOCKED' : decision.route,
      risk: decision.risk_level,
      qa_status: sourceIncomplete ? 'FAIL' : decision.qa_status,
      confidence: decision.final_confidence,
      comparison_result: comparison.result,
      difference_reasons: comparison.reasons,
      blocking_reasons: [
        ...decision.blocking_reasons,
        ...(sourceIncomplete ? ['BATCH_SOURCE_INCOMPLETE'] : []),
        ...(currentMatches.size > 1 ? ['POSSIBLE_IDENTITY_MISMATCH'] : [])
      ],
      decision_status: decision.proposed_action.startsWith('WAIT_') ? 'PENDING_TIMER' : 'SIMULATED',
      timer_status: twin.timers.some((timer) => timer.status === 'ACTIVE') ? 'ACTIVE' : 'NONE',
      events: eventStore.list(maskedOrderId).map(privateEventView),
      digital_twin: twin,
      actions_executed: 0,
      run_mode: 'SIMULATION'
    };
    if (containsDirectPii(result)) throw new Error(`PII masking gate rejected ${maskedOrderId}`);
    results.push(result);
  }

  const completedAt = new Date();
  const report = {
    batch: {
      batch_id: crypto.randomUUID(),
      batch_type: BATCH_TYPE,
      status: sourceIncomplete ? 'INCOMPLETE' : 'COMPLETED',
      business_date: bounds.business_date,
      timezone: bounds.time_zone,
      local_start: bounds.local_start,
      local_end_exclusive: bounds.local_end_exclusive,
      utc_start: bounds.utc_start,
      utc_end: bounds.utc_end_exclusive,
      started_at: startedAt.toISOString(),
      completed_at: completedAt.toISOString(),
      total_source_orders: inside.length,
      total_unique_orders: sorted.length,
      total_processed: results.length,
      total_skipped: inside.length - sorted.length,
      total_failed: 0,
      total_masked: results.length,
      total_simulated: results.length,
      total_compared: results.filter((item) => item.comparison_result !== 'INSUFFICIENT_DATA').length,
      route_counts: routeCounts(results),
      comparison_counts: comparisonCounts(results),
      total_actions_executed: 0,
      pii_detected_count: piiDetected,
      pii_persisted_count: 0,
      masking_version: 'v2',
      policy_versions: ['vps-staging-v1'],
      outside_interval_rejected: outsideCount,
      duration_ms: completedAt - startedAt,
      source_status: sourceStatus,
      error_summary: sourceIncomplete ? ['ONE_OR_MORE_SOURCES_INCOMPLETE'] : []
    },
    orders: results
  };
  if (containsDirectPii(report)) throw new Error('PII found in final masked batch report');
  if (report.batch.total_actions_executed !== 0) throw new Error('ACTIONS_EXECUTED must remain zero');
  return report;
}

export { BATCH_TYPE };
