import crypto from 'node:crypto';
import { collectPaginated, createReadOnlyTransport } from '../../../packages/platform-core/src/read-only-transport.mjs';

const ORDER_FIELD = 'dropea: numero';

function normalizeLabel(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

function normalizeReference(value) {
  return String(value || '').trim().replace(/^#/, '');
}

function hmac(value, key) {
  return crypto.createHmac('sha256', key).update(String(value)).digest('hex');
}

function responseRows(payload) {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.data) ? payload.data : [];
}

async function responseJson(response, source) {
  if (!response.ok) {
    const error = new Error(`${source} GET failed with HTTP ${response.status}`);
    error.code = `${source.toUpperCase()}_HTTP_${response.status}`;
    throw error;
  }
  return response.json();
}

function nextPage(payload, rows, currentPage) {
  const current = Number(payload?.meta?.current_page || currentPage);
  const last = Number(payload?.meta?.last_page || 0);
  if (last > current) return current + 1;
  if (last > 0) return null;
  return rows.length >= 100 ? currentPage + 1 : null;
}

function orderReference(subscriber) {
  const fields = Array.isArray(subscriber?.user_fields) ? subscriber.user_fields : [];
  const field = fields.find((item) => normalizeLabel(item?.name) === ORDER_FIELD);
  return normalizeReference(field?.value);
}

function payloadReferences(subscriber) {
  const accepted = new Set(['order_id', 'dropea_order_id', 'external_order_id', 'shopify_order_id', 'order_number']);
  const output = [];
  const visit = (value, path, depth = 0) => {
    if (depth > 5 || value === null || value === undefined) return;
    if (Array.isArray(value)) return value.forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1));
    if (typeof value !== 'object') return;
    for (const [name, item] of Object.entries(value)) {
      const nextPath = path ? `${path}.${name}` : name;
      if (accepted.has(normalizeLabel(name).replace(/\s+/g, '_')) && ['string', 'number'].includes(typeof item)) {
        const reference = normalizeReference(item);
        if (reference) output.push({ reference, method: `CHATBY_PAYLOAD:${nextPath}` });
      }
      visit(item, nextPath, depth + 1);
    }
  };
  for (const field of Array.isArray(subscriber?.user_fields) ? subscriber.user_fields : []) {
    const label = normalizeLabel(field?.name);
    if (!label.includes('payload')) continue;
    let value = field?.value;
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch { continue; }
    }
    visit(value, label);
  }
  return output;
}

function technicalReferences(subscriber) {
  const payload = payloadReferences(subscriber);
  const field = orderReference(subscriber);
  const references = [...payload, ...(field ? [{ reference: field, method: 'CHATBY_FIELD:DROPEA_NUMERO' }] : [])];
  return [...new Map(references.map((item) => [`${item.reference}:${item.method}`, item])).values()];
}

function referenceHashes(reference, key) {
  if (!reference) return [];
  return [...new Set([reference, `#${reference}`].map((value) => hmac(value, key)))];
}

function occurredAt(message) {
  const value = message?.ts ?? message?.created_at ?? message?.createdAt ?? message?.timestamp;
  const numeric = Number(value);
  const date = Number.isFinite(numeric) && numeric > 0
    ? new Date(numeric > 1e12 ? numeric : numeric * 1000)
    : new Date(value || 0);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function direction(message) {
  const value = String(message?.type || message?.direction || message?.sender || '').toLowerCase();
  if (['in', 'inbound', 'incoming', 'received', 'customer', 'subscriber', 'user'].includes(value)) return 'INBOUND';
  if (['out', 'outbound', 'outgoing', 'sent', 'agent', 'bot'].includes(value)) return 'OUTBOUND';
  return 'SYSTEM';
}

function messageText(message) {
  return [
    message?.content,
    message?.text,
    message?.payload?.text,
    message?.payload?.title,
    message?.button_text
  ].filter((value) => typeof value === 'string').join(' ')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function classifyIntent(message) {
  const text = messageText(message);
  if (!text) return 'UNKNOWN';
  if (/(quiero el descuento|acepto el descuento|descuento.*si)/.test(text)) return 'DISCOUNT_ACCEPTED';
  if (/(no quiero el descuento|rechazo el descuento|sin descuento)/.test(text)) return 'DISCOUNT_REJECTED';
  if (/(recoger.*agencia|recogida.*agencia|pickup)/.test(text)) return 'PICKUP_AT_AGENCY';
  if (/(cambiar.*direccion|cambio.*direccion|direccion incorrecta)/.test(text)) return 'CHANGE_ADDRESS';
  if (/(reintentar.*entrega|nuevo intento|volver.*entregar)/.test(text)) return 'DELIVERY_RETRY';
  if (/(no quiero el pedido|cancel|rechaz|devolver|devolucion)/.test(text)) return 'FINAL_REJECTION';
  if (/(si quiero el pedido|quiero mi pedido|confirmo|confirmado|lo quiero)/.test(text)) return 'CUSTOMER_STILL_WANTS_ORDER';
  return 'UNKNOWN';
}

function messageType(message) {
  const value = String(message?.msg_type || message?.message_type || '').toLowerCase();
  if (['postback', 'button', 'quick_reply'].includes(value)) return 'BUTTON';
  if (value.includes('template')) return 'TEMPLATE';
  if (value === 'text') return 'TEXT';
  return 'UNKNOWN';
}

function technicalMessageId(message, issueId, key) {
  const source = message?.id || message?.mid || `${occurredAt(message)}:${direction(message)}:${messageType(message)}:${messageText(message)}`;
  return hmac(`${issueId}:${source}`, key);
}

function templateHash(message, key) {
  const value = message?.template_name ?? message?.template?.name ?? message?.payload?.template_name;
  return value ? hmac(value, key) : null;
}

function conversationMetrics(messages, issueCreatedAt, now = new Date()) {
  const valid = messages.map((message) => ({ message, at: occurredAt(message) })).filter((item) => item.at)
    .sort((left, right) => new Date(left.at) - new Date(right.at));
  const inbound = valid.filter((item) => direction(item.message) === 'INBOUND');
  const outbound = valid.filter((item) => direction(item.message) === 'OUTBOUND');
  const buttons = inbound.filter((item) => messageType(item.message) === 'BUTTON');
  const templates = outbound.filter((item) => messageType(item.message) === 'TEMPLATE');
  const latest = valid.at(-1)?.at || null;
  const issueAt = new Date(issueCreatedAt).getTime();
  return Object.freeze({
    last_customer_message_at: inbound.at(-1)?.at || null,
    last_suleia_message_at: outbound.at(-1)?.at || null,
    last_button: buttons.length ? classifyIntent(buttons.at(-1).message) : null,
    latest_template_message: templates.at(-1)?.message || null,
    customer_replied: inbound.some((item) => new Date(item.at).getTime() >= issueAt),
    conversation_age_seconds: latest ? Math.max(0, Math.floor((now.getTime() - new Date(latest).getTime()) / 1000)) : null,
    conversation_freshness: latest && new Date(latest).getTime() >= issueAt ? 'FRESH' : latest ? 'STALE' : 'UNKNOWN',
    message_count: valid.length,
    current_messages: valid.filter((item) => new Date(item.at).getTime() >= issueAt).map((item) => item.message)
  });
}

async function readMessages({ transport, base, token, userNs, maxPages }) {
  const pages = await collectPaginated({
    firstCursor: 1,
    maxPages,
    fetchPage: async (page) => {
      const url = new URL('/api/subscriber/chat-messages', base.origin);
      url.searchParams.set('user_ns', userNs);
      url.searchParams.set('limit', '100');
      url.searchParams.set('page', String(page));
      const payload = await responseJson(await transport(url, {
        method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }
      }), 'chatby_messages');
      const rows = responseRows(payload);
      return { items: rows, next_cursor: nextPage(payload, rows, Number(page)) };
    }
  });
  if (!pages.complete) {
    const error = new Error(`Chatby message pagination incomplete: ${pages.reason}`);
    error.code = 'CHATBY_MESSAGE_PAGINATION_INCOMPLETE';
    throw error;
  }
  return pages;
}

export async function syncChatbyReadOnly({
  pool,
  projector,
  token,
  hmacKey,
  baseUrl = 'https://app.chatby.io/api',
  maxPages = 200,
  maxConversations = 500,
  fetchImpl = globalThis.fetch
}) {
  if (!token) return Object.freeze({
    ok: false, enabled: true, consultable: false, error: 'CHATBY_GET_CREDENTIAL_MISSING',
    actions_executed: 0, production_writes: 0, messages_sent: 0
  });
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' || base.hostname !== 'app.chatby.io') {
    throw new Error('CHATBY_READ_HOST_NOT_ALLOWLISTED');
  }
  const transport = createReadOnlyTransport({ fetchImpl, allowedHosts: [base.hostname], maxRetries: 3 });
  const subscribers = await collectPaginated({
    firstCursor: 1,
    maxPages,
    fetchPage: async (page) => {
      const url = new URL('/api/subscribers', base.origin);
      url.searchParams.set('limit', '100');
      url.searchParams.set('page', String(page));
      const payload = await responseJson(await transport(url, {
        method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }
      }), 'chatby_subscribers');
      const rows = responseRows(payload);
      return { items: rows, next_cursor: nextPage(payload, rows, Number(page)) };
    }
  });
  if (!subscribers.complete) {
    const error = new Error(`Chatby subscriber pagination incomplete: ${subscribers.reason}`);
    error.code = 'CHATBY_SUBSCRIBER_PAGINATION_INCOMPLETE';
    throw error;
  }

  const candidates = await pool.query(`SELECT o.canonical_order_id,o.external_order_id_hash,o.dropea_order_id,
      o.created_at_utc AS order_created_at,i.canonical_issue_id,i.created_at_utc AS issue_created_at,
      i.updated_at_utc AS issue_updated_at
    FROM integration.dropea_orders o
    JOIN integration.dropea_issues i USING(canonical_order_id)
    WHERE i.status='PENDING' AND i.is_active=true
    ORDER BY i.updated_at_utc DESC`);
  const byExternalHash = new Map();
  const byDropeaOrderId = new Map();
  for (const row of candidates.rows) {
    if (row.external_order_id_hash) {
      const existing = byExternalHash.get(row.external_order_id_hash) || [];
      existing.push(row); byExternalHash.set(row.external_order_id_hash, existing);
    }
    const dropeaOrderId = normalizeReference(row.dropea_order_id);
    if (dropeaOrderId) {
      const existing = byDropeaOrderId.get(dropeaOrderId) || [];
      existing.push(row); byDropeaOrderId.set(dropeaOrderId, existing);
    }
  }
  const matchesByIssue = new Map();
  let referenceConflicts = 0;
  for (const subscriber of subscribers.items) {
    const matchedWithEvidence = [];
    for (const evidence of technicalReferences(subscriber)) {
      for (const row of referenceHashes(evidence.reference, hmacKey).flatMap((hash) => byExternalHash.get(hash) || [])) {
        matchedWithEvidence.push({ row, evidence });
      }
      for (const row of byDropeaOrderId.get(evidence.reference) || []) matchedWithEvidence.push({ row, evidence });
    }
    const matchedByTechnicalIdentity = new Map();
    for (const item of matchedWithEvidence) {
      const matchKey = `${item.row.canonical_order_id}:${item.row.canonical_issue_id}:${String(subscriber.user_ns || '')}`;
      if (!matchedByTechnicalIdentity.has(matchKey)) matchedByTechnicalIdentity.set(matchKey, { ...item, subscriber });
    }
    const matched = [...matchedByTechnicalIdentity.values()];
    if (new Set(matched.map((item) => item.row.canonical_order_id)).size > 1) {
      referenceConflicts += 1;
      continue;
    }
    for (const item of matched) {
      const list = matchesByIssue.get(item.row.canonical_issue_id) || [];
      list.push(item);
      matchesByIssue.set(item.row.canonical_issue_id, list);
    }
  }

  const foundOrders = new Set();
  let availableIssues = 0;
  let eventsInserted = 0;
  let conversationsRead = 0;
  let identityConflicts = 0;
  const statusCounts = { NONE: 0, FOUND: 0, MULTIPLE: 0, STALE: 0, BROKEN: 0, UNKNOWN: 0 };
  let conversationBudget = maxConversations;
  for (const issue of candidates.rows) {
    const entries = matchesByIssue.get(issue.canonical_issue_id) || [];
    const subscribersByTechnicalId = new Map();
    for (const entry of entries) {
      const technicalId = String(entry.subscriber.user_ns || '');
      if (!subscribersByTechnicalId.has(technicalId)) subscribersByTechnicalId.set(technicalId, entry);
    }
    const subscribersForIssue = [...subscribersByTechnicalId.values()];
    if (!subscribersForIssue.length) {
      statusCounts.NONE += 1;
      await projector.upsertChatbyConversationLink?.({
        canonical_order_id: issue.canonical_order_id, canonical_issue_id: issue.canonical_issue_id,
        conversation_status: 'NONE', reason_code: 'NO_EXACT_TECHNICAL_REFERENCE',
        identity_method: 'NONE', conversation_freshness: 'UNKNOWN', message_count: 0
      });
      continue;
    }
    if (subscribersForIssue.length !== 1 || !subscribersForIssue[0].subscriber.user_ns) {
      identityConflicts += 1;
      statusCounts.MULTIPLE += 1;
      await projector.upsertChatbyConversationLink?.({
        canonical_order_id: issue.canonical_order_id, canonical_issue_id: issue.canonical_issue_id,
        conversation_status: 'MULTIPLE', reason_code: 'MULTIPLE_EXACT_TECHNICAL_CONVERSATIONS',
        identity_method: 'CONFLICT', conversation_freshness: 'UNKNOWN', message_count: 0
      });
      continue;
    }
    if (conversationBudget <= 0) {
      statusCounts.UNKNOWN += 1;
      await projector.upsertChatbyConversationLink?.({
        canonical_order_id: issue.canonical_order_id, canonical_issue_id: issue.canonical_issue_id,
        conversation_status: 'UNKNOWN', reason_code: 'CONVERSATION_READ_BUDGET_EXHAUSTED',
        identity_method: subscribersForIssue[0].evidence.method,
        conversation_freshness: 'UNKNOWN', message_count: 0
      });
      continue;
    }
    conversationBudget -= 1;
    const { subscriber, evidence } = subscribersForIssue[0];
    let messages;
    try {
      messages = await readMessages({ transport, base, token, userNs: String(subscriber.user_ns), maxPages });
    } catch (error) {
      statusCounts.BROKEN += 1;
      await projector.upsertChatbyConversationLink?.({
        canonical_order_id: issue.canonical_order_id, canonical_issue_id: issue.canonical_issue_id,
        conversation_status: 'BROKEN', reason_code: error.code || 'CHATBY_MESSAGE_READ_FAILED',
        identity_method: evidence.method, conversation_freshness: 'UNKNOWN', message_count: 0,
        chatby_conversation_id_hash: hmac(subscriber.user_ns, hmacKey),
        chatby_contact_id_hash: hmac(subscriber.user_id || subscriber.user_ns, hmacKey)
      });
      continue;
    }
    conversationsRead += 1;
    const metrics = conversationMetrics(messages.items, issue.issue_created_at);
    const conversationHash = hmac(subscriber.user_ns, hmacKey);
    const contactHash = hmac(subscriber.user_id || subscriber.user_ns, hmacKey);
    for (const message of metrics.current_messages) {
      const at = occurredAt(message);
      const intent = classifyIntent(message);
      const type = messageType(message);
      const messageHash = technicalMessageId(message, issue.canonical_issue_id, hmacKey);
      const event = {
        chatby_conversation_id_hash: conversationHash,
        chatby_contact_id_hash: contactHash,
        chatby_message_id_hash: messageHash,
        canonical_order_id: issue.canonical_order_id,
        canonical_issue_id: issue.canonical_issue_id,
        direction: direction(message),
        message_type: type,
        template_id_hash: null,
        button_payload: type === 'BUTTON' && intent !== 'UNKNOWN' ? intent : null,
        sanitized_text: intent === 'UNKNOWN' ? 'UNCLASSIFIED_MESSAGE_PRESENT' : `INTENT:${intent}`,
        occurred_at: at,
        source_event_id: `chatby:${messageHash}`,
        incident_version: new Date(issue.issue_updated_at).toISOString(),
        relevance_status: 'CURRENT_ORDER_EXACT_MATCH',
        intent,
        intent_confidence: type === 'BUTTON' && intent !== 'UNKNOWN' ? 1 : intent !== 'UNKNOWN' ? 0.85 : 0,
        payload_hash: hmac(`${messageHash}:${issue.canonical_issue_id}:${at}:${intent}`, hmacKey),
        actions_executed: 0,
        production_writes: 0
      };
      const inserted = await projector.recordChatbyConversationEvent(event);
      if (inserted.inserted) eventsInserted += 1;
    }
    await projector.upsertChatbyConversationLink?.({
      canonical_order_id: issue.canonical_order_id, canonical_issue_id: issue.canonical_issue_id,
      chatby_conversation_id_hash: conversationHash, chatby_contact_id_hash: contactHash,
      conversation_status: 'FOUND', reason_code: 'EXACT_TECHNICAL_REFERENCE',
      identity_method: evidence.method, evidence_hash: hmac(`${evidence.method}:${evidence.reference}`, hmacKey),
      last_customer_message_at: metrics.last_customer_message_at,
      last_suleia_message_at: metrics.last_suleia_message_at,
      last_button: metrics.last_button,
      latest_template_hash: metrics.latest_template_message ? templateHash(metrics.latest_template_message, hmacKey) : null,
      customer_replied: metrics.customer_replied,
      conversation_age_seconds: metrics.conversation_age_seconds,
      conversation_freshness: metrics.conversation_freshness,
      message_count: metrics.message_count
    });
    await projector.markChatbyConversationAvailable?.({
      canonical_order_id: issue.canonical_order_id, canonical_issue_id: issue.canonical_issue_id
    });
    statusCounts.FOUND += 1;
    foundOrders.add(issue.canonical_order_id);
    availableIssues += 1;
  }
  const complete = statusCounts.BROKEN === 0;
  if (complete && projector.recordSourceFreshness) {
    await projector.recordSourceFreshness({
      source: 'chatby', last_success_at: new Date().toISOString(), lag_seconds: 0, status: 'FRESH'
    });
  }
  return Object.freeze({
    ok: complete,
    enabled: true,
    consultable: true,
    error: complete ? null : 'CHATBY_MESSAGE_READ_INCOMPLETE',
    subscribers_read: subscribers.items.length,
    subscriber_pages: subscribers.page_count,
    exact_orders: foundOrders.size,
    available_issues: availableIssues,
    conversations_read: conversationsRead,
    events_inserted: eventsInserted,
    identity_conflicts: identityConflicts + referenceConflicts,
    reference_conflicts: referenceConflicts,
    conversation_statuses: statusCounts,
    pagination_complete: true,
    external_methods: ['GET'],
    actions_executed: 0,
    production_writes: 0,
    messages_sent: 0
  });
}

export const chatbyReadOnlyInternals = Object.freeze({
  normalizeLabel, normalizeReference, orderReference, occurredAt, direction,
  messageType, classifyIntent, referenceHashes, payloadReferences, technicalReferences,
  conversationMetrics
});
