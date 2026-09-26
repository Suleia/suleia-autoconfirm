import { rejectedIntent } from './recipient-rejected-policy.mjs';
export const INCIDENT_DISCOUNT_DELAY_HOURS = 24;
export const INCIDENT_DISCOUNT_MAX_EUR = 5;
export const INCIDENT_MERCHANDISE_TEMPLATE = 'dropea_incidencia_mercancia_v1';
export const INCIDENT_MERCHANDISE_TEMPLATE_LEDGER_NAME = 'es_ES dropea_incidencia_mercancia_v1';

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function parseDateMs(value) {
  if (!value) return Number.NaN;
  const numeric = Number(value);
  const date = Number.isFinite(numeric) && numeric > 0
    ? new Date(numeric > 1e12 ? numeric * 1 : numeric * 1000)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? Number.NaN : date.getTime();
}

export function messageTimestamp(message) {
  const raw = message?.raw || message || {};
  return parseDateMs(
    message?.created_at || message?.createdAt || message?.timestamp
      || message?.sent_at || message?.sentAt || message?.ts
      || raw?.created_at || raw?.createdAt || raw?.timestamp
      || raw?.sent_at || raw?.sentAt || raw?.ts
  );
}

function messageText(message) {
  const raw = message?.raw || message || {};
  return [
    message?.text,
    message?.message,
    message?.content,
    message?.caption,
    message?.button_text,
    message?.buttonText,
    raw?.template_name,
    raw?.templateName,
    raw?.name,
    raw?.content?.name,
    raw?.payload?.name,
    raw?.payload?.title,
    raw?.payload?.body
  ].filter(Boolean).map((value) => (
    typeof value === 'string' ? value : JSON.stringify(value)
  )).join(' ');
}

function templateSlug(value) {
  return normalize(value)
    .replace(/^es_es[\s_-]+/, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function extractWamid(value, visited = new Set()) {
  if (!value) return null;
  if (typeof value === 'string') {
    const match = value.match(/wamid\.[A-Za-z0-9_.:-]+/);
    return match?.[0] || null;
  }
  if (typeof value !== 'object' || visited.has(value)) return null;
  visited.add(value);
  for (const key of ['mid', 'message_id', 'messageId', 'wamid', 'id']) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.startsWith('wamid.')) return candidate;
  }
  for (const child of Object.values(value)) {
    const found = extractWamid(child, visited);
    if (found) return found;
  }
  return null;
}

export function isCustomerInteraction(message) {
  const raw = message?.raw || message || {};
  const direction = normalize([
    message?.from,
    message?.sender,
    message?.role,
    message?.type,
    message?.direction,
    raw?.direction,
    raw?.sender_type,
    raw?.senderType,
    raw?.author,
    raw?.source
  ].filter(Boolean).join(' '));

  if (raw.is_from_customer === true || raw.isFromCustomer === true || raw.from_customer === true) return true;
  if (raw.from_me === false || raw.fromMe === false || raw.incoming === true || raw.is_incoming === true) return true;
  if (raw.is_echo === true || raw.isEcho === true || raw.from_me === true || raw.fromMe === true) return false;
  if (/\b(in|incoming|inbound|received|customer|subscriber|user|client|cliente)\b/.test(direction)) return true;
  if (/\b(out|outgoing|outbound|sent|agent|bot|admin|system|store|tienda)\b/.test(direction)) return false;
  return false;
}

export function findVerifiedTemplateDelivery(messages = [], templateName) {
  const target = templateSlug(templateName);
  const matches = (Array.isArray(messages) ? messages : [])
    .map((message) => ({
      message,
      timestamp: messageTimestamp(message),
      wamid: extractWamid(message)
    }))
    .filter((entry) => (
      entry.wamid
      && !isCustomerInteraction(entry.message)
      && templateSlug(messageText(entry.message)).includes(target)
    ))
    .sort((left, right) => left.timestamp - right.timestamp);
  const latest = matches.at(-1);
  return latest
    ? {
        sentAt: Number.isFinite(latest.timestamp) ? new Date(latest.timestamp).toISOString() : null,
        wamid: latest.wamid
      }
    : null;
}

function verifiedPersistentDelivery(delivery) {
  const status = normalize(delivery?.status);
  const timestamp = parseDateMs(delivery?.sent_at || delivery?.sentAt);
  if (!['sent', 'already_seen'].includes(status) || !Number.isFinite(timestamp)) return null;
  return {
    sentAt: new Date(timestamp).toISOString(),
    wamid: extractWamid(delivery?.raw) || null,
    source: 'persistent_delivery_ledger'
  };
}

function latestVerifiedDelivery(messages, templateName, persistentDelivery = null) {
  return [
    findVerifiedTemplateDelivery(messages, templateName),
    verifiedPersistentDelivery(persistentDelivery)
  ]
    .filter((entry) => entry?.sentAt)
    .sort((left, right) => parseDateMs(left.sentAt) - parseDateMs(right.sentAt))
    .at(-1) || null;
}

export function customerInteractionAfter(messages = [], since) {
  const sinceMs = parseDateMs(since);
  return (Array.isArray(messages) ? messages : [])
    .filter(isCustomerInteraction)
    .map((message) => ({ message, timestamp: messageTimestamp(message) }))
    .find((entry) => (
      !Number.isFinite(sinceMs)
      || !Number.isFinite(entry.timestamp)
      || entry.timestamp > sinceMs
    )) || null;
}

function rejectedGoodsIncident(incident) {
  const source = normalize([
    incident?.incidentType,
    incident?.incidenceCode,
    incident?.carrierState,
    incident?.description
  ].filter(Boolean).join(' '));
  return /rejected_goods|no_acepta_expedicion|no acepta expedicion|mercancia rechazada|shipment_not_accepted/.test(source);
}

export function incidentDiscountPolicy({
  incident,
  messages = [],
  now = Date.now(),
  discountTemplateName,
  merchandisePersistentDelivery = null,
  discountPersistentDelivery = null
} = {}) {
  if (!rejectedGoodsIncident(incident)) return { eligible: false, reason: 'incident_not_rejected_goods' };
  const status = normalize(incident?.issueStatus || incident?.status || 'pending');
  const activeResolvableStatus = status === 'managing_with_client'
    || /pending|pendiente|open|abiert|unresolved|resolver/.test(status);
  if (!activeResolvableStatus) {
    return { eligible: false, reason: 'incident_not_pending' };
  }
  if (incident?.chatbyReadVerified !== true) return { eligible: false, reason: 'chatby_context_unverified' };

  const merchandiseDelivery = latestVerifiedDelivery(
    messages,
    INCIDENT_MERCHANDISE_TEMPLATE,
    merchandisePersistentDelivery
  );
  if (!merchandiseDelivery?.sentAt) return { eligible: false, reason: 'merchandise_template_not_verified' };
  const incidentAtMs = parseDateMs(incident?.incidenceDate || incident?.createdAt);
  const merchandiseAtMs = parseDateMs(merchandiseDelivery.sentAt);
  const existingDiscount = discountTemplateName
    ? latestVerifiedDelivery(messages, discountTemplateName, discountPersistentDelivery)
    : null;
  if (existingDiscount) {
    return {
      eligible: false,
      reason: 'discount_template_already_sent',
      merchandiseTemplateSentAt: merchandiseDelivery.sentAt,
      discountTemplateSentAt: existingDiscount.sentAt
    };
  }

  // The merchandise template is intentionally idempotent per order. When the
  // carrier opens a later rejected-goods incidence for the same order, reuse
  // that verified delivery instead of sending the lifecycle template twice.
  // The later incidence becomes the new 24-hour anchor and any customer
  // interaction after the original delivery still blocks the discount.
  const carriedForwardAcrossIncident = Number.isFinite(incidentAtMs)
    && merchandiseAtMs < incidentAtMs - (5 * 60 * 1000);

  if (customerInteractionAfter(messages, merchandiseDelivery.sentAt)) {
    return {
      eligible: false,
      reason: 'customer_interaction_after_merchandise_template',
      merchandiseTemplateSentAt: merchandiseDelivery.sentAt,
      merchandiseTemplateCarriedForward: carriedForwardAcrossIncident
    };
  }

  const eligibilityAnchorMs = carriedForwardAcrossIncident
    ? Math.max(merchandiseAtMs, incidentAtMs)
    : merchandiseAtMs;
  const eligibilityAnchorAt = Number.isFinite(eligibilityAnchorMs)
    ? new Date(eligibilityAnchorMs).toISOString()
    : merchandiseDelivery.sentAt;
  const ageHours = Number.isFinite(eligibilityAnchorMs)
    ? Math.max(0, (Number(now) - eligibilityAnchorMs) / 3_600_000)
    : 0;
  if (ageHours < INCIDENT_DISCOUNT_DELAY_HOURS) {
    return {
      eligible: false,
      reason: 'waiting_discount_window',
      ageHours,
      dueAt: new Date(eligibilityAnchorMs + INCIDENT_DISCOUNT_DELAY_HOURS * 3_600_000).toISOString(),
      merchandiseTemplateSentAt: merchandiseDelivery.sentAt,
      eligibilityAnchorAt,
      merchandiseTemplateCarriedForward: carriedForwardAcrossIncident
    };
  }
  if (!incident?.chatbyUserNs) {
    return { eligible: false, reason: 'missing_chatby_conversation' };
  }
  return {
    eligible: true,
    reason: 'discount_template_due',
    ageHours,
    merchandiseTemplateSentAt: merchandiseDelivery.sentAt,
    eligibilityAnchorAt,
    merchandiseTemplateCarriedForward: carriedForwardAcrossIncident,
    discountAmountEur: INCIDENT_DISCOUNT_MAX_EUR
  };
}

export function classifyIncidentDiscountResponse(messages = [], discountTemplateName, discountPersistentDelivery = null) {
  const delivery = latestVerifiedDelivery(messages, discountTemplateName, discountPersistentDelivery);
  if (!delivery?.sentAt) return { status: 'NOT_SENT', respondedAt: null };
  const inbound = messages.filter(isCustomerInteraction).map(message => ({message,timestamp:messageTimestamp(message)}));
  if (inbound.some(x => !Number.isFinite(x.timestamp) || x.timestamp > Date.now() + 60000)) return {status:'OTHER_RESPONSE',intent:'AMBIGUOUS',respondedAt:null};
  const interaction = inbound.filter(x => x.timestamp > Date.parse(delivery.sentAt)).sort((a,b)=>a.timestamp-b.timestamp).at(-1);
  if (!interaction) return { status: 'NO_RESPONSE', respondedAt: null };
  const text = normalize(messageText(interaction.message));
  const respondedAt = Number.isFinite(interaction.timestamp)
    ? new Date(interaction.timestamp).toISOString()
    : null;
  const intent = rejectedIntent(text,{offerVerified:true});
  return { ...intent, status: intent.discount_accepted ? 'DISCOUNT_ACCEPTED' : intent.requests_return ? 'DISCOUNT_REJECTED' : 'OTHER_RESPONSE', respondedAt };
}
