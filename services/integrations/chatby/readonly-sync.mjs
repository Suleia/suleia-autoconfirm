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
  const matchesByOrder = new Map();
  let referenceConflicts = 0;
  for (const subscriber of subscribers.items) {
    const reference = orderReference(subscriber);
    if (!reference) continue;
    const matched = [...new Map([
      ...referenceHashes(reference, hmacKey).flatMap((hash) => byExternalHash.get(hash) || []),
      ...(byDropeaOrderId.get(reference) || [])
    ].map((row) => [`${row.canonical_order_id}:${row.canonical_issue_id}`, row])).values()];
    if (new Set(matched.map((row) => row.canonical_order_id)).size > 1) {
      referenceConflicts += 1;
      continue;
    }
    for (const row of matched) {
      const list = matchesByOrder.get(row.canonical_order_id) || [];
      list.push({ subscriber, issue: row });
      matchesByOrder.set(row.canonical_order_id, list);
    }
  }

  let exactOrders = 0;
  let availableIssues = 0;
  let eventsInserted = 0;
  let conversationsRead = 0;
  let identityConflicts = 0;
  const orderEntries = [...matchesByOrder.entries()].slice(0, maxConversations);
  for (const [orderId, entries] of orderEntries) {
    const subscribersForOrder = [...new Map(entries.map((entry) => [String(entry.subscriber.user_ns || ''), entry.subscriber])).values()];
    const issuesForOrder = [...new Map(entries.map((entry) => [entry.issue.canonical_issue_id, entry.issue])).values()];
    if (subscribersForOrder.length !== 1 || issuesForOrder.length !== 1 || !subscribersForOrder[0].user_ns) {
      identityConflicts += 1;
      continue;
    }
    const subscriber = subscribersForOrder[0];
    const issue = issuesForOrder[0];
    const messages = await readMessages({
      transport, base, token, userNs: String(subscriber.user_ns), maxPages
    });
    conversationsRead += 1;
    const issueCreatedAt = new Date(issue.issue_created_at).getTime();
    const currentMessages = messages.items.filter((message) => {
      const timestamp = occurredAt(message);
      return timestamp && new Date(timestamp).getTime() >= issueCreatedAt;
    });
    const conversationHash = hmac(subscriber.user_ns, hmacKey);
    const contactHash = hmac(subscriber.user_id || subscriber.user_ns, hmacKey);
    for (const message of currentMessages) {
      const at = occurredAt(message);
      const intent = classifyIntent(message);
      const type = messageType(message);
      const messageHash = technicalMessageId(message, issue.canonical_issue_id, hmacKey);
      const event = {
        chatby_conversation_id_hash: conversationHash,
        chatby_contact_id_hash: contactHash,
        chatby_message_id_hash: messageHash,
        canonical_order_id: orderId,
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
    await projector.markChatbyConversationAvailable({
      canonical_order_id: orderId,
      canonical_issue_id: issue.canonical_issue_id
    });
    exactOrders += 1;
    availableIssues += 1;
  }
  return Object.freeze({
    ok: true,
    enabled: true,
    consultable: true,
    subscribers_read: subscribers.items.length,
    subscriber_pages: subscribers.page_count,
    exact_orders: exactOrders,
    available_issues: availableIssues,
    conversations_read: conversationsRead,
    events_inserted: eventsInserted,
    identity_conflicts: identityConflicts + referenceConflicts,
    reference_conflicts: referenceConflicts,
    pagination_complete: true,
    external_methods: ['GET'],
    actions_executed: 0,
    production_writes: 0,
    messages_sent: 0
  });
}

export const chatbyReadOnlyInternals = Object.freeze({
  normalizeLabel, normalizeReference, orderReference, occurredAt, direction,
  messageType, classifyIntent, referenceHashes
});
