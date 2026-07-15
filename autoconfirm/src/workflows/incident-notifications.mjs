import { getAppConfig } from '../config.mjs';
import { getDropeaOrderById } from '../clients/dropea.mjs';
import { getChatMessages, listWhatsappTemplates, sendWhatsappTemplate } from '../clients/chatby.mjs';
import { claimTemplateDelivery, finishTemplateDelivery } from '../db/supabase-store.mjs';
import { loadState, saveState } from '../storage.mjs';

const config = getAppConfig();
const activeClaims = new Set();
let templateCatalogPromise = null;

const INCIDENT_TEMPLATES = {
  absent: 'es_ES dropea_incidencia_ausente_v2',
  address: 'es_ES dropea_incidencia_direccion_v1',
  rejected_goods: 'es_ES dropea_incidencia_mercancia_v1'
};

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function firstName(value) {
  return String(value || 'Cliente').trim().split(/\s+/)[0] || 'Cliente';
}

function parseDateMs(value) {
  if (!value) return Number.NaN;
  const numeric = Number(value);
  const date = Number.isFinite(numeric) && numeric > 0
    ? new Date(numeric > 1e12 ? numeric : numeric * 1000)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? Number.NaN : date.getTime();
}

function messageTimestamp(message) {
  const raw = message?.raw || message || {};
  return parseDateMs(
    message?.created_at
      || message?.createdAt
      || message?.timestamp
      || message?.sent_at
      || message?.sentAt
      || message?.ts
      || raw?.created_at
      || raw?.createdAt
      || raw?.timestamp
      || raw?.sent_at
      || raw?.sentAt
      || raw?.ts
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
    raw?.template_name,
    raw?.templateName,
    raw?.name,
    raw?.content?.name,
    raw?.payload?.name,
    JSON.stringify(raw)
  ].filter(Boolean).join(' ');
}

function isCustomerMessage(message) {
  const raw = message?.raw || message || {};
  const direction = normalize([
    message?.from,
    message?.sender,
    message?.role,
    message?.type,
    message?.direction,
    raw?.direction,
    raw?.sender_type
  ].filter(Boolean).join(' '));
  if (['in', 'incoming', 'inbound', 'received'].includes(direction)) return true;
  if (['out', 'outgoing', 'outbound', 'agent', 'bot', 'admin'].includes(direction)) return false;
  if (/customer|user|cliente|inbound|incoming/.test(direction)) return true;
  if (/bot|agent|admin|outbound|outgoing/.test(direction)) return false;
  if (raw.is_from_customer === true || raw.isFromCustomer === true || raw.from_customer === true) return true;
  if (raw.from_me === false || raw.fromMe === false || raw.incoming === true || raw.is_incoming === true) return true;
  if (raw.from_me === true || raw.fromMe === true || raw.outgoing === true || raw.is_outgoing === true) return false;
  const serialized = JSON.stringify(raw);
  return serialized.includes('"is_bot":false')
    || serialized.includes('"from_me":false')
    || serialized.includes('"incoming":true');
}

function extractWamid(value, visited = new Set()) {
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
  for (const nested of Object.values(value)) {
    const found = extractWamid(nested, visited);
    if (found) return found;
  }
  return null;
}

function templateSlug(templateName) {
  return normalize(String(templateName || '').replace(/^[a-z]{2}_[A-Z]{2}\s+/, ''))
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function messageHasTemplate(message, templateName) {
  const target = templateSlug(templateName);
  if (!target) return false;
  const source = templateSlug(messageText(message));
  return source.includes(target);
}

export function messageHasAcceptedTemplate(message, templateName, { since = null } = {}) {
  if (!extractWamid(message)) return false;
  if (!messageHasTemplate(message, templateName)) return false;
  const sinceMs = parseDateMs(since);
  const timestamp = messageTimestamp(message);
  return !Number.isFinite(sinceMs)
    || !Number.isFinite(timestamp)
    || timestamp >= sinceMs - (60 * 60 * 1000);
}

export function customerRespondedAfterIncident(messages = [], incidentDate = null) {
  const sinceMs = parseDateMs(incidentDate);
  return (Array.isArray(messages) ? messages : []).some((message) => {
    if (!isCustomerMessage(message)) return false;
    const timestamp = messageTimestamp(message);
    if (!Number.isFinite(sinceMs) || !Number.isFinite(timestamp)) return true;
    return timestamp >= sinceMs - (5 * 60 * 1000);
  });
}

export function acceptedOutboundAfterIncident(messages = [], incidentDate = null) {
  const sinceMs = parseDateMs(incidentDate);
  return (Array.isArray(messages) ? messages : []).some((message) => {
    if (isCustomerMessage(message) || !extractWamid(message)) return false;
    const timestamp = messageTimestamp(message);
    if (!Number.isFinite(sinceMs) || !Number.isFinite(timestamp)) return true;
    return timestamp >= sinceMs - (5 * 60 * 1000);
  });
}

export function incidentTemplateNameForType(type) {
  return INCIDENT_TEMPLATES[String(type || '')] || null;
}

function statusIsPending(value) {
  const status = normalize(value);
  if (!status) return true;
  if (/resolved|resuelto|closed|cerrad|sent|enviad|delivered|entregad|returned|devuelt|cancel|reject|rechaz/.test(status)) {
    return false;
  }
  return /pending|pendiente|open|abiert|unresolved|resolver/.test(status);
}

function cancellationIntent(value) {
  const text = normalize(value);
  return /no lo quiero|no quiero|cancel|anul|rechaz|no acepta|no acepto|no me interesa|devolver|no voy a recibir|equivoc/.test(text);
}

export function incidentNotificationPolicy({ incident, messages = [], now = Date.now(), minAgeHours = null } = {}) {
  const templateName = incidentTemplateNameForType(incident?.incidentType);
  if (!templateName) return { eligible: false, reason: 'unsupported_incident_type', templateName: null };
  if (!statusIsPending(incident?.issueStatus || 'PENDING')) {
    return { eligible: false, reason: 'incident_not_pending', templateName };
  }

  const postIncidentMessages = (Array.isArray(messages) ? messages : []).filter((message) => {
    if (!isCustomerMessage(message)) return false;
    const incidentMs = parseDateMs(incident?.incidenceDate);
    const timestamp = messageTimestamp(message);
    if (!Number.isFinite(incidentMs) || !Number.isFinite(timestamp)) return true;
    return timestamp >= incidentMs - (5 * 60 * 1000);
  });
  const responseText = postIncidentMessages.map(messageText).join(' | ');
  const allCustomerText = (Array.isArray(messages) ? messages : [])
    .filter(isCustomerMessage)
    .map(messageText)
    .join(' | ');
  if (cancellationIntent(`${incident?.chatbyIntent || ''} ${incident?.lastCustomerMessage || ''} ${responseText} ${allCustomerText}`)) {
    return { eligible: false, reason: 'customer_requests_cancellation', templateName };
  }
  if (postIncidentMessages.length || incident?.customerResponded === true) {
    return { eligible: false, reason: 'customer_already_responded', templateName };
  }

  if (acceptedOutboundAfterIncident(messages, incident?.incidenceDate)) {
    return { eligible: false, reason: 'accepted_outbound_already_exists', templateName };
  }

  if (incident?.chatbyReadVerified === false) {
    return { eligible: false, reason: 'chatby_context_unverified', templateName };
  }

  const configuredDelay = minAgeHours ?? Number(config.defaultStore.incidentNotificationDelayHours ?? 0);
  const incidentMs = parseDateMs(incident?.incidenceDate);
  if (!Number.isFinite(incidentMs)) {
    return { eligible: false, reason: 'incident_date_unavailable', templateName };
  }
  const ageHours = Math.max(0, (Number(now) - incidentMs) / 3600000);
  if (ageHours < configuredDelay) {
    return { eligible: false, reason: 'waiting_notification_window', templateName, ageHours };
  }
  if (!incident?.chatbyUserNs) {
    return { eligible: false, reason: 'missing_chatby_conversation', templateName, ageHours };
  }

  return { eligible: true, reason: 'notification_due', templateName, ageHours };
}

function productName(order, orderId) {
  const raw = order?.raw || order || {};
  const items = Array.isArray(raw.items) ? raw.items : [];
  const names = items
    .map((item) => item?.shopify_name_item || item?.title || item?.name || item?.product_name)
    .filter(Boolean);
  return names.join(', ') || `Pedido ${orderId}`;
}

function fullAddress(order) {
  const raw = order?.raw || order || {};
  const customer = raw.customer || {};
  return [
    customer.address,
    customer.alternative_address,
    customer.city,
    customer.state,
    customer.zip
  ].filter(Boolean).join(', ');
}

function paramsForIncident(incident, order) {
  const name = firstName(incident?.customerName || order?.customerName);
  const product = productName(order, incident?.orderId);
  if (incident?.incidentType === 'address') {
    return {
      'BODY_{{1}}': `${name}.`,
      'BODY_{{2}}': fullAddress(order) || 'la direccion indicada en tu pedido',
      'BODY_{{3}}': product
    };
  }
  if (incident?.incidentType === 'absent') {
    return {
      'BODY_{{1}}': `${name},`,
      'BODY_{{2}}': product
    };
  }
  return { 'BODY_{{1}}': `${name},` };
}

function parseDefaultValues(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function templateCatalog() {
  if (!templateCatalogPromise) {
    templateCatalogPromise = listWhatsappTemplates().catch((error) => {
      templateCatalogPromise = null;
      throw error;
    });
  }
  return templateCatalogPromise;
}

async function templateContent(templateName, params) {
  const name = String(templateName || '').trim().split(/\s+/).slice(1).join(' ');
  const templates = await templateCatalog();
  const template = (Array.isArray(templates) ? templates : []).find((item) => (
    item?.name === name && String(item?.status || '').toUpperCase() === 'APPROVED'
  ));
  if (!template) throw new Error(`Plantilla de incidencia no aprobada o no disponible: ${name}`);

  const defaults = parseDefaultValues(template.default_values);
  const defaultParams = defaults.params && typeof defaults.params === 'object' ? defaults.params : {};
  const quickReplies = Object.fromEntries((Array.isArray(template.params) ? template.params : [])
    .filter((item) => String(item?.type || '').toLowerCase() === 'quick_reply' && item?.label)
    .map((item) => [item.label, item.text || defaultParams[item.label] || '']));
  const bodyLabels = (Array.isArray(template.params) ? template.params : [])
    .filter((item) => String(item?.type || '').toLowerCase() === 'text' && /^BODY_/.test(String(item?.label || '')))
    .map((item) => item.label);
  const missing = bodyLabels.filter((label) => !String(params[label] || '').trim());
  if (missing.length) throw new Error(`Faltan parametros de plantilla: ${missing.join(', ')}`);

  return {
    name: template.name,
    lang: defaults.lang || template.language || 'es_ES',
    namespace: template.namespace,
    params: {
      ...defaultParams,
      ...quickReplies,
      ...params
    }
  };
}

function ledgerKey(incident, templateName) {
  return `${incident?.orderId || ''}|${templateSlug(templateName)}`;
}

function loadLocalLedgerEntry(incident, templateName) {
  return loadState().incidentTemplateLedger?.[ledgerKey(incident, templateName)] || null;
}

function rememberLocalAttempt(incident, templateName, patch = {}) {
  const state = { ...loadState() };
  const ledger = { ...(state.incidentTemplateLedger || {}) };
  const key = ledgerKey(incident, templateName);
  const previous = ledger[key] || {};
  const now = new Date().toISOString();
  ledger[key] = {
    ...previous,
    orderId: String(incident?.orderId || ''),
    incidenceId: String(incident?.incidenceId || ''),
    phoneLast9: digits(incident?.phone).slice(-9),
    templateName,
    status: patch.status || previous.status || 'attempted',
    attemptedAt: patch.attemptedAt || previous.attemptedAt || now,
    sentAt: patch.sentAt || previous.sentAt || null,
    wamid: patch.wamid || previous.wamid || null,
    lastError: patch.lastError ?? previous.lastError ?? null,
    updatedAt: now
  };
  state.incidentTemplateLedger = Object.fromEntries(Object.entries(ledger)
    .sort((left, right) => String(right[1]?.updatedAt || '').localeCompare(String(left[1]?.updatedAt || '')))
    .slice(0, 2500));
  saveState(state);
  return ledger[key];
}

async function finishPersistentClaim(incident, templateName, status, patch = {}) {
  try {
    await finishTemplateDelivery({
      storeId: config.defaultStore.id,
      orderId: incident.orderId,
      customerPhone: incident.phone,
      templateName,
      provider: 'chatby',
      chatbyUserNs: incident.chatbyUserNs || '',
      status,
      attemptedAt: patch.attemptedAt,
      sentAt: patch.sentAt || null,
      lastError: patch.lastError || null,
      raw: patch.raw || null
    });
  } catch (error) {
    console.error('Incident notification ledger finalize error:', error instanceof Error ? error.message : String(error));
  }
}

async function waitForAcceptance({ incident, templateName, sinceMs }) {
  const attempts = Math.max(1, Number(process.env.INCIDENT_TEMPLATE_VERIFY_ATTEMPTS || 6));
  const delayMs = Math.max(500, Number(process.env.INCIDENT_TEMPLATE_VERIFY_DELAY_MS || 2000));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const messages = await getChatMessages(incident.chatbyUserNs).catch(() => []);
    const accepted = (Array.isArray(messages) ? messages : []).find((message) => {
      if (!messageHasAcceptedTemplate(message, templateName, { since: new Date(sinceMs).toISOString() })) return false;
      const timestamp = messageTimestamp(message);
      return !Number.isFinite(timestamp) || timestamp >= sinceMs - 5000;
    });
    if (accepted) return { accepted: true, wamid: extractWamid(accepted) };
  }
  return { accepted: false, reason: 'missing_whatsapp_message_id' };
}

function publicNotificationResult(result = {}) {
  return {
    status: result.status || 'skipped',
    reason: result.reason || null,
    templateName: result.templateName || null,
    attemptedAt: result.attemptedAt || null,
    sentAt: result.sentAt || null,
    verified: Boolean(result.verified),
    error: result.error || null
  };
}

export async function processIncidentNotification({ incident, order = null, messages = [], dryRun = false } = {}) {
  if (!config.defaultStore.incidentNotificationsEnabled) {
    return publicNotificationResult({ status: 'disabled', reason: 'incident_notifications_disabled' });
  }
  if (!incident?.orderId) return publicNotificationResult({ status: 'skipped', reason: 'missing_order_id' });

  const templateName = incidentTemplateNameForType(incident.incidentType);
  if (!templateName) return publicNotificationResult({ status: 'skipped', reason: 'unsupported_incident_type' });
  const since = incident.incidenceDate || null;
  const existingAccepted = (Array.isArray(messages) ? messages : []).find((message) => (
    messageHasAcceptedTemplate(message, templateName, { since })
  ));
  if (existingAccepted) {
    const sentAt = Number.isFinite(messageTimestamp(existingAccepted))
      ? new Date(messageTimestamp(existingAccepted)).toISOString()
      : new Date().toISOString();
    rememberLocalAttempt(incident, templateName, {
      status: 'already_seen',
      attemptedAt: sentAt,
      sentAt,
      wamid: extractWamid(existingAccepted)
    });
    return publicNotificationResult({
      status: 'already_seen',
      reason: 'accepted_template_already_exists',
      templateName,
      sentAt,
      verified: true
    });
  }

  const policy = incidentNotificationPolicy({ incident, messages });
  if (!policy.eligible) {
    return publicNotificationResult({ status: 'skipped', reason: policy.reason, templateName });
  }

  const key = ledgerKey(incident, templateName);
  const local = loadLocalLedgerEntry(incident, templateName);
  if (local?.attemptedAt || activeClaims.has(key)) {
    return publicNotificationResult({
      status: local?.status || 'in_flight',
      reason: activeClaims.has(key) ? 'already_in_flight' : 'local_dedupe_guard',
      templateName,
      attemptedAt: local?.attemptedAt || null,
      sentAt: local?.sentAt || null,
      verified: ['sent', 'already_seen'].includes(local?.status)
    });
  }

  if (dryRun) {
    return publicNotificationResult({
      status: 'would_send',
      reason: 'dry_run_notification_due',
      templateName
    });
  }

  activeClaims.add(key);
  let claim = null;
  try {
    claim = await claimTemplateDelivery({
      storeId: config.defaultStore.id,
      orderId: incident.orderId,
      customerPhone: incident.phone,
      templateName,
      provider: 'chatby',
      chatbyUserNs: incident.chatbyUserNs
    });
    if (!claim?.acquired) {
      return publicNotificationResult({
        status: `persistent_${claim?.existing?.status || 'claimed'}`,
        reason: claim?.reason || 'persistent_dedupe_guard',
        templateName,
        attemptedAt: claim?.existing?.attempted_at || null,
        sentAt: claim?.existing?.sent_at || null,
        verified: ['sent', 'already_seen'].includes(String(claim?.existing?.status || ''))
      });
    }

    const fullOrder = order?.raw?.items?.length && order?.raw?.customer?.address
      ? order
      : await getDropeaOrderById(incident.orderId).catch(() => order);
    if (!fullOrder) throw new Error('No se pudo cargar el pedido de Dropea para completar la plantilla.');

    const content = await templateContent(templateName, paramsForIncident(incident, fullOrder));
    const attemptedAt = new Date().toISOString();
    rememberLocalAttempt(incident, templateName, { status: 'attempted', attemptedAt });
    const response = await sendWhatsappTemplate({
      user_ns: incident.chatbyUserNs,
      user_id: incident.phone,
      content
    });
    const responseWamid = extractWamid(response);
    const verification = responseWamid
      ? { accepted: true, wamid: responseWamid }
      : await waitForAcceptance({
          incident,
          templateName,
          sinceMs: new Date(attemptedAt).getTime()
        });

    if (!verification.accepted) {
      const error = 'Chatby acepto la solicitud, pero WhatsApp no devolvio wamid. No se reintentara automaticamente.';
      rememberLocalAttempt(incident, templateName, { status: 'delivery_unverified', attemptedAt, lastError: error });
      await finishPersistentClaim(incident, templateName, 'delivery_unverified', {
        attemptedAt,
        lastError: error,
        raw: { response, verification }
      });
      return publicNotificationResult({
        status: 'delivery_unverified',
        reason: 'missing_whatsapp_message_id',
        templateName,
        attemptedAt,
        error
      });
    }

    const sentAt = new Date().toISOString();
    rememberLocalAttempt(incident, templateName, {
      status: 'sent',
      attemptedAt,
      sentAt,
      wamid: verification.wamid
    });
    await finishPersistentClaim(incident, templateName, 'sent', {
      attemptedAt,
      sentAt,
      raw: { response, verification }
    });
    return publicNotificationResult({
      status: 'sent',
      reason: 'whatsapp_accepted',
      templateName,
      attemptedAt,
      sentAt,
      verified: true
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const attemptedAt = new Date().toISOString();
    rememberLocalAttempt(incident, templateName, { status: 'failed', attemptedAt, lastError: message });
    if (claim?.acquired) {
      await finishPersistentClaim(incident, templateName, 'failed', { attemptedAt, lastError: message });
    }
    return publicNotificationResult({
      status: 'failed',
      reason: 'send_error',
      templateName,
      attemptedAt,
      error: message
    });
  } finally {
    activeClaims.delete(key);
  }
}
