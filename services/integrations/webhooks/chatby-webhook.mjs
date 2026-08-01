import { hmacTechnicalId, validateSignedWebhook } from './secure-ingress.mjs';

export const CHATBY_WEBHOOK_TOPICS = Object.freeze([
  'message.incoming', 'message.outgoing', 'button.clicked',
  'template.status.changed', 'conversation.updated'
]);

const EVENT_TYPE = Object.freeze({
  'message.incoming': 'CHATBY_MESSAGE_RECEIVED',
  'message.outgoing': 'CHATBY_MESSAGE_SENT',
  'button.clicked': 'CHATBY_BUTTON_CLICKED',
  'template.status.changed': 'CHATBY_TEMPLATE_STATUS_CHANGED',
  'conversation.updated': 'CHATBY_CONVERSATION_UPDATED'
});

export function receiveChatbyWebhook({
  rawBody,
  headers,
  secret,
  technicalHmacKey,
  ingestionPipeline,
  resolveIdentity,
  enqueue = () => {},
  now = Date.now,
  signatureHeader = 'x-chatby-signature',
  eventIdHeader = 'x-chatby-event-id',
  topicHeader = 'x-chatby-topic',
  timestampHeader = null
}) {
  const validated = validateSignedWebhook({
    rawBody,
    headers,
    secret,
    signatureHeader,
    eventIdHeader,
    topicHeader,
    timestampHeader,
    allowedTopics: CHATBY_WEBHOOK_TOPICS,
    now
  });
  const conversationId = validated.payload.conversation_id;
  if (!conversationId) throw new Error('CHATBY_WEBHOOK_CONVERSATION_ID_MISSING');
  const identity = resolveIdentity(validated.payload);
  if (!identity?.canonical_order_id || !['EXACT', 'VERIFIED'].includes(identity.status)) {
    throw new Error('CHATBY_WEBHOOK_IDENTITY_NOT_EXACT_OR_VERIFIED');
  }
  const result = ingestionPipeline.ingest({
    source: 'CHATBY',
    source_record_id: validated.event_id,
    order_id: identity.canonical_order_id,
    event_type: EVENT_TYPE[validated.topic],
    occurred_at: validated.occurred_at,
    trust_level: 'HIGH',
    payload: {
      topic: validated.topic,
      chatby_ref_hash: hmacTechnicalId(conversationId, technicalHmacKey),
      message_ref_hash: validated.payload.message_id
        ? hmacTechnicalId(validated.payload.message_id, technicalHmacKey)
        : null,
      direction: ['incoming', 'outgoing'].includes(validated.payload.direction)
        ? validated.payload.direction
        : null,
      button_ref_hash: validated.payload.button_id
        ? hmacTechnicalId(validated.payload.button_id, technicalHmacKey)
        : null,
      template_status: /^[A-Z0-9_.-]{1,64}$/i.test(String(validated.payload.template_status || ''))
        ? String(validated.payload.template_status).toUpperCase()
        : null,
      content_present: typeof validated.payload.content === 'string' && validated.payload.content.length > 0,
      content_hash: typeof validated.payload.content === 'string'
        ? hmacTechnicalId(validated.payload.content, technicalHmacKey)
        : null,
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
    production_writes: 0,
    messages_sent: 0
  });
}
