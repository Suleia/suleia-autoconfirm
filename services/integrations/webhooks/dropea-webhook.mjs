import { validateSignedWebhook } from './secure-ingress.mjs';

export const DROPEA_WEBHOOK_TOPICS = Object.freeze([
  'order.created', 'order.status.changed', 'order.cancelled',
  'issue.created', 'issue.status.changed', 'issue.resolved'
]);

const EVENT_TYPE = Object.freeze({
  'order.created': 'ORDER_CREATED',
  'order.status.changed': 'ORDER_STATUS_CHANGED',
  'order.cancelled': 'ORDER_CANCELLED',
  'issue.created': 'INCIDENT_OPENED',
  'issue.status.changed': 'INCIDENT_UPDATED',
  'issue.resolved': 'INCIDENT_RESOLVED'
});

function validateResource(payload) {
  if (!Number.isInteger(payload.resource_id) || !payload.resource || typeof payload.resource !== 'object') {
    throw new Error('DROPEA_WEBHOOK_RESOURCE_INVALID');
  }
  if (Number(payload.resource.id) !== payload.resource_id) throw new Error('DROPEA_WEBHOOK_RESOURCE_ID_MISMATCH');
  if (payload.topic.startsWith('order.')) {
    for (const field of ['id', 'status', 'line_items', 'total_amount', 'currency', 'created_at', 'updated_at']) {
      if (payload.resource[field] === undefined || payload.resource[field] === null) throw new Error(`DROPEA_WEBHOOK_ORDER_${field.toUpperCase()}_MISSING`);
    }
  } else {
    for (const field of ['id', 'tracking_number', 'owner_id', 'carrier', 'type', 'status', 'initial_carrier_code', 'initial_carrier_description', 'is_active', 'created_at', 'updated_at', 'pickup_point']) {
      if (!(field in payload.resource)) throw new Error(`DROPEA_WEBHOOK_ISSUE_${field.toUpperCase()}_MISSING`);
    }
  }
}

export function receiveDropeaWebhook({
  rawBody,
  headers,
  secret,
  ingestionPipeline,
  resolveIdentity,
  enqueue = () => {},
  now = Date.now
}) {
  const validated = validateSignedWebhook({
    rawBody,
    headers,
    secret,
    signatureHeader: 'x-dropea-signature',
    eventIdHeader: 'x-dropea-event-id',
    topicHeader: 'x-dropea-topic',
    allowedTopics: DROPEA_WEBHOOK_TOPICS,
    allowedMarkets: ['ES', 'IT', 'PT'],
    now
  });
  validateResource(validated.payload);
  const identity = resolveIdentity(validated.payload);
  if (!identity?.canonical_order_id || !['EXACT', 'VERIFIED', 'PARTIAL'].includes(identity.status)) {
    throw new Error('DROPEA_WEBHOOK_IDENTITY_UNRESOLVED');
  }
  const result = ingestionPipeline.ingest({
    source: 'DROPEA',
    source_record_id: validated.event_id,
    order_id: identity.canonical_order_id,
    event_type: EVENT_TYPE[validated.topic],
    occurred_at: validated.occurred_at,
    trust_level: 'HIGH',
    payload: {
      topic: validated.topic,
      market: validated.payload.market,
      resource_id: validated.payload.resource_id,
      resource: validated.payload.resource,
      identity_status: identity.status
    }
  });
  if (result.inserted) {
    queueMicrotask(() => enqueue({ event: result.event, ephemeral_payload: validated.payload }));
  }
  return Object.freeze({
    accepted: true,
    inserted: result.inserted,
    event_id: result.event.event_id,
    identity_status: identity.status,
    process_async: result.inserted,
    actions_executed: 0,
    production_writes: 0
  });
}
