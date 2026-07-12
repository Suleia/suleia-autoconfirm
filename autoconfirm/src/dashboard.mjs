import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAppConfig } from './config.mjs';
import { listOrders, loadState } from './storage.mjs';
import { getDropeaOrderById, listDropeaOrdersByStatusBasic, listPendingDropeaOrders, listRecentDropeaOrders } from './clients/dropea.mjs';
import { findSubscriberForOrder, getChatMessages, subscriberConfirmsOrder } from './clients/chatby.mjs';
import { getCampaignInsights } from './clients/meta.mjs';
import { listRecentShopifyOrders } from './clients/shopify.mjs';
import { chatWithOperationsAgent } from './clients/openai.mjs';
import { appendAgentMemoryRule, getAgentMemoryRules, getSheetRows, upsertSimulationDecision } from './clients/sheets.mjs';
import { loadIncidentsCache } from './workflows/incidents.mjs';
import { loadOperationalOrdersCache } from './workflows/operational-orders.mjs';
import { syncAgentChatToSupabase, syncAgentFeedbackToSupabase, syncAgentMemoryRuleToSupabase } from './db/supabase-store.mjs';

const config = getAppConfig();
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const dashboardDataDir = path.resolve(root, process.env.DASHBOARD_DATA_DIR || 'data/dashboard');

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function numberFrom(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const parsed = Number(String(value ?? '').replace(',', '.').replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function rowObjects(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return [];
  const headers = rows[0].map((header) => String(header || ''));
  return rows.slice(1)
    .filter((row) => Array.isArray(row) && row.some(Boolean))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])));
}

async function readSheet(sheetTitle) {
  try {
    const rows = await getSheetRows(sheetTitle, 'A:Z');
    return { ok: true, rows, source: `Google Sheet - ${sheetTitle}` };
  } catch (error) {
    return { ok: false, rows: [], source: `Google Sheet - ${sheetTitle}`, error: error instanceof Error ? error.message : String(error) };
  }
}

function guessProduct(order) {
  const raw = JSON.stringify(order.raw || order || '').toLowerCase();
  if (raw.includes('colla') || raw.includes('gum')) return 'Collagum';
  if (raw.includes('nida')) return 'NIDA premium';
  return 'Producto';
}

function guessProductFromCampaign(name) {
  const normalized = normalize(name);
  if (normalized.includes('colla') || normalized.includes('gum')) return 'Collagum';
  if (normalized.includes('nida')) return 'NIDA premium';
  return 'Sin producto detectado';
}

function guessProductFromMetaRow(...names) {
  return guessProductFromCampaign(names.filter(Boolean).join(' '));
}

function orderFromSheet(row) {
  const orderId = row.orderId || row.pedido || row.id || '';
  return {
    orderId: String(orderId),
    customer: row.nombre || row.cliente || '',
    phone: row.telefono || row.phone || '',
    createdAt: row.fecha_creacion || row.created_at || '',
    status: row.estado || row.status || '',
    amount: numberFrom(row.importe || row.total || row.amount),
    issue: row.en_incidencia || '',
    issueCode: row.codigo_incidencia || '',
    note: row.nota_operativa || '',
    confirmedAt: row.fecha_confirmacion || '',
    product: row.producto || guessProduct(row)
  };
}

function orderFromLocal(order) {
  return {
    orderId: String(order.orderId || order.id || ''),
    customer: order.customerName || '',
    phone: order.customerPhone || '',
    createdAt: order.raw?.created_at || order.raw?.createdAt || order.createdAt || '',
    status: order.status || '',
    amount: Number(order.orderAmount) || null,
    issue: order.raw?.issues ? 'Si' : 'No',
    issueCode: order.raw?.issues?.incidence_code || '',
    note: order.operationalNote || '',
    confirmedAt: order.confirmedAt || '',
    product: guessProduct(order),
    agentAction: order.agentAction || '',
    agentIntent: order.aiIntent || order.agentIntent || '',
    agentConfidence: order.aiConfidence ?? order.agentConfidence ?? null,
    agentReason: order.operationalNote || order.agentReason || '',
    confirmationDelayStartedAt: order.confirmationDelayStartedAt || '',
    confirmationDueAt: order.confirmationDueAt || '',
    confirmationSource: order.confirmationSource || '',
    chatbyUserNs: order.chatbyUserNs || '',
    chatbyTemplateSentAt: order.chatbyTemplateSentAt || '',
    chatbyTemplateAttemptedAt: order.chatbyTemplateAttemptedAt || '',
    chatbyTemplateName: order.chatbyTemplateName || '',
    chatbyTemplateSendStatus: order.chatbyTemplateSendStatus || '',
    chatbyTemplateLastError: order.chatbyTemplateLastError || '',
    raw: order.raw || {}
  };
}

function orderFromDropea(order) {
  return {
    orderId: String(order.orderId || ''),
    customer: order.customerName || '',
    phone: order.customerPhone || '',
    createdAt: order.raw?.created_at || order.raw?.createdAt || '',
    status: order.status || '',
    amount: Number(order.orderAmount) || null,
    issue: order.raw?.issues ? 'Si' : 'No',
    issueCode: order.raw?.issues?.incidence_code || '',
    note: '',
    confirmedAt: '',
    product: guessProduct(order),
    liveSource: 'Dropea',
    raw: order.raw || {}
  };
}

function orderFromShopify(order) {
  const productName = order.products?.map((item) => item.title).filter(Boolean).join(', ') || 'Producto Shopify';
  const financialStatus = normalize(order.financialStatus || '');
  const status = order.cancelledAt
    ? 'CANCELLED'
    : financialStatus.includes('paid')
      ? 'SHOPIFY_PAID'
      : financialStatus.includes('pending')
        ? 'SHOPIFY_PENDING_PAYMENT'
        : `SHOPIFY_${String(order.financialStatus || 'ORDER').toUpperCase().replace(/\s+/g, '_')}`;

  return {
    orderId: String(order.name || order.id || '').replace(/^#/, 'SHOPIFY-'),
    shopifyOrderId: order.id,
    customer: order.customerName || '',
    phone: order.customerPhone || '',
    createdAt: order.createdAt || '',
    status,
    amount: Number(order.totalAmount) || null,
    issue: '',
    issueCode: '',
    note: `Pedido Shopify ${order.name || ''} · pago ${order.financialStatus || 'sin dato'} · fulfillment ${order.fulfillmentStatus || 'sin dato'}`,
    confirmedAt: financialStatus.includes('paid') ? order.createdAt || '' : '',
    product: productName,
    liveSource: 'Shopify',
    raw: {
      source: 'shopify',
      ...order
    }
  };
}

function decisionFromSheet(row) {
  return {
    date: row.fecha || '',
    orderId: String(row.orderId || ''),
    action: row.accion || '',
    intent: row.intent || '',
    confidence: numberFrom(row.confianza),
    source: row.fuente || '',
    message: row.mensaje_cliente || '',
    reason: row.motivo || '',
    dryRun: String(row.dry_run || '').toLowerCase() === 'true'
  };
}

function controlDecisionFromSheet(row) {
  return {
    date: row.actualizado_en || '',
    orderId: String(row.orderId || ''),
    decision: String(row.decision_simulacion || '').trim().toUpperCase(),
    reason: row.motivo || '',
    source: row.fuente || 'control_simulacion'
  };
}

function orderPatchFromControl(control) {
  const reason = control.reason || '';
  const addressChange = isAddressChangeFeedback(`${control.source} ${reason}`);
  if (['CONFIRM', 'CONFIRMAR', 'CONFIRMED', 'SI', 'SÍ', 'YES'].includes(control.decision)) {
    return {
      status: 'CONFIRMED_BY_CUSTOMER',
      agentAction: 'would_confirm',
      agentIntent: 'CONFIRM',
      agentConfidence: 100,
      agentReason: reason || 'Confirmacion validada por feedback operativo.',
      controlDecision: control.decision,
      controlSource: control.source,
      controlAt: control.date
    };
  }
  if (['NO_CONFIRM', 'NO CONFIRM', 'NO_CONFIRMAR', 'NO', 'CANCEL', 'CANCELAR'].includes(control.decision)) {
    return {
      status: addressChange ? 'PENDING_ADDRESS_CHANGE' : 'NOT_CONFIRMED_BY_CUSTOMER',
      agentAction: 'would_not_confirm',
      agentIntent: addressChange ? 'ADDRESS_CHANGE_REQUESTED' : 'NO_CONFIRM',
      agentConfidence: 100,
      agentReason: reason || 'No confirmado por feedback operativo.',
      controlDecision: control.decision,
      controlSource: control.source,
      controlAt: control.date
    };
  }
  if (['MANUAL_REVIEW', 'REVIEW', 'REVISION'].includes(control.decision)) {
    return {
      status: 'MANUAL_REVIEW',
      agentAction: 'manual_review',
      agentIntent: 'MANUAL_REVIEW',
      agentConfidence: 100,
      agentReason: reason || 'Revision manual indicada por feedback operativo.',
      controlDecision: control.decision,
      controlSource: control.source,
      controlAt: control.date
    };
  }
  return null;
}

function protectedAgentState(order = {}) {
  const status = normalize(order.status);
  const intent = normalize(order.agentIntent);
  const action = normalize(order.agentAction);
  return Boolean(order.feedbackVerdict)
    || Boolean(order.confirmedAt)
    || ['confirm', 'address_change_requested', 'no_confirm', 'manual_review'].includes(intent)
    || ['would_confirm', 'would_not_confirm', 'manual_review'].includes(action)
    || status.includes('confirmed_by_customer')
    || status.includes('pending_address_change')
    || status.includes('not_confirmed_by_customer')
    || status.includes('manual_review');
}

function mergeLiveOrder(existing = {}, live = {}) {
  const merged = { ...existing, ...live };
  if (!protectedAgentState(existing)) return merged;

  return {
    ...merged,
    status: existing.status || merged.status,
    confirmedAt: existing.confirmedAt || merged.confirmedAt,
    note: existing.note || merged.note,
    agentAction: existing.agentAction || merged.agentAction,
    agentIntent: existing.agentIntent || merged.agentIntent,
    agentConfidence: existing.agentConfidence ?? merged.agentConfidence,
    agentReason: existing.agentReason || merged.agentReason,
    feedbackVerdict: existing.feedbackVerdict || merged.feedbackVerdict,
    feedbackCorrection: existing.feedbackCorrection || merged.feedbackCorrection,
    feedbackNote: existing.feedbackNote || merged.feedbackNote,
    feedbackAt: existing.feedbackAt || merged.feedbackAt,
    controlDecision: existing.controlDecision || merged.controlDecision,
    controlSource: existing.controlSource || merged.controlSource,
    controlAt: existing.controlAt || merged.controlAt
  };
}

function mergeOrders(sheetOrders, localOrders, liveOrders, decisions, controlDecisions, feedback) {
  const byId = new Map();
  for (const order of localOrders) byId.set(order.orderId, order);
  for (const order of liveOrders) byId.set(order.orderId, mergeLiveOrder(byId.get(order.orderId) || {}, order));
  for (const order of sheetOrders) byId.set(order.orderId, { ...(byId.get(order.orderId) || {}), ...order });
  for (const decision of decisions) {
    const current = byId.get(decision.orderId);
    if (!current) continue;
    byId.set(decision.orderId, {
      ...current,
      agentAction: decision.action,
      agentIntent: decision.intent,
      agentConfidence: decision.confidence,
      agentReason: decision.reason,
      dryRun: decision.dryRun
    });
  }
  for (const control of controlDecisions) {
    const current = byId.get(control.orderId);
    if (!current) continue;
    const patch = orderPatchFromControl(control);
    if (!patch) continue;
    byId.set(control.orderId, {
      ...current,
      ...patch
    });
  }
  for (const item of feedback) {
    const current = byId.get(String(item.orderId));
    if (!current) continue;
    const feedbackText = normalize([item.verdict, item.correction, item.note].filter(Boolean).join(' '));
    const addressChange = isAddressChangeFeedback(feedbackText);
    const feedbackPatch = {};
    if (item.verdict === 'should_confirm') {
      feedbackPatch.status = 'CONFIRMED_BY_CUSTOMER';
      feedbackPatch.agentAction = 'would_confirm';
      feedbackPatch.agentIntent = 'CONFIRM';
      feedbackPatch.agentConfidence = 100;
      feedbackPatch.agentReason = item.correction || item.note || 'Samuel corrigio el pedido como confirmado por el cliente.';
    } else if (addressChange) {
      feedbackPatch.status = 'PENDING_ADDRESS_CHANGE';
      feedbackPatch.agentAction = 'would_not_confirm';
      feedbackPatch.agentIntent = 'ADDRESS_CHANGE_REQUESTED';
      feedbackPatch.agentConfidence = 100;
      feedbackPatch.agentReason = item.correction || item.note || 'Samuel corrigio el pedido como cambio de direccion; no confirmar.';
    }
    byId.set(String(item.orderId), {
      ...current,
      ...feedbackPatch,
      feedbackVerdict: item.verdict,
      feedbackCorrection: item.correction,
      feedbackNote: item.note,
      feedbackAt: item.createdAt
    });
  }
  return [...byId.values()].filter((order) => order.orderId);
}

function chatbyText(value) {
  return normalize(String(value || ''));
}

function messageContent(message = {}) {
  const raw = message.raw || message;
  return [
    message.content,
    message.message,
    message.text,
    message.button_text,
    message.buttonText,
    raw.content,
    raw.message,
    raw.text,
    raw.button_text,
    raw.buttonText,
    raw.payload?.title,
    raw.payload?.body,
    raw.title
  ].filter(Boolean).join(' ');
}

function messageTime(message = {}) {
  const raw = message.raw || message;
  const numeric = Number(raw.ts || raw.timestamp || raw.created || raw.time);
  if (Number.isFinite(numeric) && numeric > 0) return numeric > 1e12 ? numeric : numeric * 1000;
  const date = new Date(raw.created_at || raw.createdAt || message.created_at || message.createdAt || 0);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function isLikelyCustomerMessage(message = {}) {
  const raw = message.raw || message;
  const role = chatbyText(message.role || raw.role || raw.sender || raw.direction || raw.type || raw.from_type || raw.sender_type);
  if (['in', 'inbound', 'incoming', 'received', 'customer', 'subscriber', 'user', 'client', 'cliente'].includes(role)) return true;
  if (raw.is_from_customer === true || raw.isFromCustomer === true || raw.from_customer === true) return true;
  if (raw.is_echo === true || raw.isEcho === true) return false;
  if (['out', 'outbound', 'sent', 'bot', 'agent', 'admin', 'system'].includes(role)) return false;
  return Boolean(messageContent(message));
}

function classifyChatbySignal({ subscriber, messages = [] } = {}) {
  if (subscriber) {
    const leadStatus = chatbyText(subscriber.lead_status);
    if (leadStatus.includes('datos') || leadStatus.includes('envio') || leadStatus.includes('direccion')) {
      return {
        status: 'PENDING_ADDRESS_CHANGE',
        agentAction: 'would_not_confirm',
        agentIntent: 'ADDRESS_CHANGE_REQUESTED',
        agentConfidence: 100,
        agentReason: 'Chatby indica cambio de datos/direccion. No confirmar automaticamente.',
        source: 'chatby_live'
      };
    }
    if (subscriberConfirmsOrder(subscriber)) {
      return {
        status: 'CONFIRMED_BY_CUSTOMER',
        agentAction: 'would_confirm',
        agentIntent: 'CONFIRM',
        agentConfidence: 100,
        agentReason: 'Chatby indica que el cliente confirmo el pedido.',
        source: 'chatby_live'
      };
    }
  }

  const customerMessages = [...messages]
    .filter(isLikelyCustomerMessage)
    .sort((left, right) => messageTime(left) - messageTime(right));
  const latest = customerMessages[customerMessages.length - 1];
  const text = chatbyText(messageContent(latest));
  if (!text) return null;

  if (text.includes('cambiar datos') || text.includes('cambio de direccion') || text.includes('cambiar direccion') || text.includes('direccion') || text.includes('dirección')) {
    return {
      status: 'PENDING_ADDRESS_CHANGE',
      agentAction: 'would_not_confirm',
      agentIntent: 'ADDRESS_CHANGE_REQUESTED',
      agentConfidence: 100,
      agentReason: 'El ultimo mensaje/boton de Chatby pide cambiar direccion o datos de entrega.',
      source: 'chatby_message'
    };
  }

  if (text.includes('no confirmo') || text.includes('cancel') || text.includes('rechaz') || text.includes('no lo quiero')) {
    return {
      status: 'NOT_CONFIRMED_BY_CUSTOMER',
      agentAction: 'would_not_confirm',
      agentIntent: 'NO_CONFIRM',
      agentConfidence: 100,
      agentReason: 'El ultimo mensaje de Chatby no confirma o rechaza el pedido.',
      source: 'chatby_message'
    };
  }

  if (text.includes('confirmar mi pedido') || text.includes('confirmo') || text.includes('confirmado') || text.includes('si lo quiero') || text.includes('sí lo quiero') || text.includes('lo quiero') || text.includes('vale') || text.includes('perfecto')) {
    return {
      status: 'CONFIRMED_BY_CUSTOMER',
      agentAction: 'would_confirm',
      agentIntent: 'CONFIRM',
      agentConfidence: 100,
      agentReason: 'El cliente confirmo el pedido en Chatby.',
      source: 'chatby_message'
    };
  }

  return null;
}

async function applyLiveChatbySignals(orders) {
  if (!config.chatbyToken) return { orders, source: { name: 'Chatby API - senales cliente', ok: false, error: 'Falta CHATBY_TOKEN' } };
  const hydrated = [];
  const recent = sortOrdersRecentFirst(orders).slice(0, 120);
  const recentIds = new Set(recent.map((order) => String(order.orderId)));
  let checked = 0;
  let patched = 0;
  let lastError = null;

  for (const order of orders) {
    if (!recentIds.has(String(order.orderId)) || protectedAgentState(order)) {
      hydrated.push(order);
      continue;
    }

    try {
      let subscriber = null;
      if (order.phone || order.orderId) {
        subscriber = await findSubscriberForOrder({ phone: order.phone, orderId: order.orderId, maxPages: 3 });
      }
      const userNs = order.chatbyUserNs || subscriber?.user_ns || subscriber?.userNs || null;
      const messages = userNs ? await getChatMessages(userNs) : [];
      const signal = classifyChatbySignal({ subscriber, messages });
      checked += 1;
      if (signal) {
        patched += 1;
        hydrated.push({
          ...order,
          ...signal,
          chatbyUserNs: userNs || order.chatbyUserNs,
          chatbyLiveCheckedAt: new Date().toISOString()
        });
      } else {
        hydrated.push({ ...order, chatbyUserNs: userNs || order.chatbyUserNs, chatbyLiveCheckedAt: new Date().toISOString() });
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      hydrated.push(order);
    }
  }

  return {
    orders: hydrated,
    source: {
      name: 'Chatby API - senales cliente',
      ok: !lastError || checked > 0,
      checked,
      patched,
      error: lastError
    }
  };
}

function isCancelled(order) {
  const status = normalize(order.status);
  const action = normalize(order.agentAction);
  return status.includes('cancel') || status.includes('reject') || action.includes('not_confirm');
}

function isRecognizedSale(order) {
  if (isCancelled(order)) return false;
  const status = normalize(order.status);
  const intent = normalize(order.agentIntent);
  const action = normalize(order.agentAction);
  return status.includes('confirm') || intent === 'confirm' || action === 'would_confirm' || Boolean(order.confirmedAt);
}

function isManualReview(order) {
  return normalize(order.status).includes('manual_review') || normalize(order.status).includes('revision');
}

function agentCustomerSignal(order) {
  const customerMessages = Number(order.customerMessages || 0);
  const lastCustomerMessage = String(order.lastCustomerMessage || order.customerActionDetail || '').trim();
  const text = normalize([
    order.status,
    order.agentIntent,
    order.agentAction,
    order.agentReason,
    order.note,
    order.customerSignalRaw,
    order.customerActionLabel,
    order.customerActionDetail,
    order.lastCustomerMessage,
    order.feedbackVerdict,
    order.feedbackCorrection,
    order.feedbackNote
  ].filter(Boolean).join(' '));

  if (text.includes('would_cancel_unanswered') || text.includes('would_reject_unanswered') || text.includes('cancel_unanswered_timeout') || text.includes('reject_unanswered_timeout') || text.includes('36h') || text.includes('sin confirmacion ni cambio de direccion')) {
    return {
      code: 'unanswered_timeout',
      label: 'Sin respuesta 36h',
      detail: 'No hay confirmacion ni cambio de direccion tras el plazo operativo.',
      confidence: 100,
      tone: 'danger'
    };
  }

  if (text.includes('address_change') || text.includes('direccion') || text.includes('cambio de direccion') || text.includes('cambiar datos')) {
    return {
      code: 'address_change',
      label: 'Cambio de direccion',
      detail: 'El cliente ha pedido modificar direccion o datos de entrega.',
      confidence: 100,
      tone: 'warning'
    };
  }

  if (text.includes('duplicate_order') || text.includes('duplicado')) {
    return {
      code: 'duplicate',
      label: 'Posible duplicado',
      detail: 'El pedido necesita revision manual por posible duplicidad.',
      confidence: 90,
      tone: 'warning'
    };
  }

  if (text.includes('cancel') || text.includes('reject') || text.includes('rechaz') || text.includes('no_confirm') || text.includes('no confirmado')) {
    return {
      code: 'rejected',
      label: 'Rechazo o no confirmacion',
      detail: 'No existe una confirmacion valida o el cliente ha rechazado/cancelado.',
      confidence: 100,
      tone: 'danger'
    };
  }

  if (text.includes('confirm')) {
    return {
      code: 'confirmed',
      label: 'Confirmacion clara',
      detail: lastCustomerMessage
        ? `Hay senal de confirmacion. Ultimo cliente: "${lastCustomerMessage.slice(0, 140)}"`
        : 'Hay senal de confirmacion por boton, texto o feedback validado.',
      confidence: Number(order.agentConfidence) || 100,
      tone: 'positive'
    };
  }

  if (text.includes('ausente') || text.includes('incidencia')) {
    return {
      code: 'absent_or_issue',
      label: 'Incidencia o ausente',
      detail: 'El pedido necesita seguimiento antes de confirmar.',
      confidence: 80,
      tone: 'warning'
    };
  }

  if (customerMessages > 0) {
    return {
      code: 'customer_replied_unclear',
      label: 'Cliente respondio',
      detail: lastCustomerMessage
        ? `Respuesta detectada: "${lastCustomerMessage.slice(0, 140)}"`
        : 'Hay respuesta entrante en Chatby, pero no es concluyente.',
      confidence: Number(order.agentConfidence) || 68,
      tone: 'warning'
    };
  }

  return {
    code: 'unclear',
    label: 'Sin senal suficiente',
    detail: 'No veo respuesta ni accion del cliente en Chatby.',
    confidence: Number(order.agentConfidence) || 25,
    tone: 'neutral'
  };
}

function agentRecommendation(order) {
  const signal = agentCustomerSignal(order);
  const status = normalize(order.status);
  const intent = normalize(order.agentIntent);
  const action = normalize(order.agentAction);

  if (signal.code === 'address_change') {
    return {
      code: 'hold_address',
      label: 'No confirmar',
      nextStep: 'Corregir direccion en Dropea y mantener pendiente.',
      explanation: 'No confirmo porque el ultimo gesto relevante del cliente es cambio de direccion o datos de entrega.',
      tone: 'warning',
      confidence: 100
    };
  }

  if (intent.includes('confirm_delay_pending')) {
    return {
      code: 'confirm_delay',
      label: 'Confirmación programada',
      nextStep: 'Esperar 1h desde la confirmación y revisar Chatby antes de confirmar en Dropea.',
      explanation: 'El cliente confirmó, pero el agente aplica la ventana de seguridad de 1h por si el cliente cancela después.',
      tone: 'warning',
      confidence: Number(order.agentConfidence) || 100
    };
  }

  if (signal.code === 'unanswered_timeout') {
    return {
      code: 'reject_timeout',
      label: 'Rechazar en Dropea',
      nextStep: 'Si no hay confirmacion ni cambio de direccion tras 36h, ejecutar rechazo/cancelacion en Dropea.',
      explanation: 'No hay confirmacion ni cambio de direccion despues de 36 horas. La regla operativa indica rechazar el pedido.',
      tone: 'danger',
      confidence: 100
    };
  }

  if (signal.code === 'rejected') {
    return {
      code: 'do_not_confirm',
      label: 'No confirmar',
      nextStep: 'Registrar motivo y no avanzar el pedido.',
      explanation: 'No confirmo porque el cliente no ha aceptado el pedido o hay rechazo/cancelacion.',
      tone: 'danger',
      confidence: 100
    };
  }

  if (signal.code === 'duplicate') {
    return {
      code: 'manual_duplicate',
      label: 'Revision por duplicado',
      nextStep: 'Comprobar si existe otro pedido del mismo cliente antes de actuar.',
      explanation: 'No automatizo porque el pedido puede estar duplicado.',
      tone: 'warning',
      confidence: 90
    };
  }

  if (signal.code === 'absent_or_issue') {
    return {
      code: 'followup_issue',
      label: 'Seguimiento incidencia',
      nextStep: 'Revisar incidencia y coordinar nueva entrega antes de confirmar.',
      explanation: 'No confirmo automaticamente porque hay ausente o incidencia abierta.',
      tone: 'warning',
      confidence: 80
    };
  }

  if (signal.code === 'confirmed' || status.includes('confirmed_by_customer') || intent === 'confirm' || action === 'would_confirm') {
    return {
      code: 'confirm',
      label: 'Confirmar pedido',
      nextStep: 'En modo real, confirmar en Dropea.',
      explanation: 'Confirmo porque el cliente ha dado una senal clara de aceptacion del pedido.',
      tone: 'positive',
      confidence: signal.confidence || Number(order.agentConfidence) || 100
    };
  }

  if (isManualReview(order)) {
    return {
      code: 'manual_review',
      label: 'Revision humana',
      nextStep: 'Revisar conversacion antes de actuar.',
      explanation: 'No automatizo porque el pedido esta en revision manual o la evidencia no es concluyente.',
      tone: 'warning',
      confidence: Number(order.agentConfidence) || (Number(order.customerMessages || 0) > 0 ? 68 : 45)
    };
  }

  return {
    code: 'wait_customer',
    label: 'Esperar respuesta',
    nextStep: 'No actuar hasta recibir una senal clara.',
    explanation: 'No confirmo porque aun no hay confirmacion clara del cliente.',
    tone: 'neutral',
    confidence: Number(order.agentConfidence) || 0
  };
}

function realActionForOrder(order) {
  const status = normalize(order.status);
  const intent = normalize(order.agentIntent);
  const action = normalize(order.agentAction);
  if (status.includes('confirmed') || order.confirmedAt) {
    return { label: 'Confirmado en Dropea', tone: 'positive', detail: order.confirmedAt || 'Confirmacion ejecutada' };
  }
  if (status.includes('rejected_after_confirm') || intent.includes('cancel_after_confirmation') || action.includes('rejected_after_confirmation_cancel')) {
    return { label: 'Rechazado tras cancelar', tone: 'danger', detail: 'Cliente cancelo durante la espera de 1h' };
  }
  if (status.includes('rejected_unanswered') || intent.includes('reject_unanswered_timeout') || action.includes('rejected_unanswered_timeout')) {
    return { label: 'Rechazado 36h sin respuesta', tone: 'danger', detail: 'Cancelacion ejecutada por silencio operativo' };
  }
  if (intent.includes('confirm_delay_pending') || status.includes('confirm_delay')) {
    return { label: 'Programado', tone: 'warning', detail: order.confirmationDueAt ? `Confirmar desde ${order.confirmationDueAt}` : 'Esperando ventana de seguridad' };
  }
  if (status.includes('pending_address_change')) {
    return { label: 'Bloqueado direccion', tone: 'warning', detail: 'No confirmar hasta corregir datos' };
  }
  if (status.includes('manual')) {
    return { label: 'Revision manual', tone: 'warning', detail: 'Requiere validacion humana' };
  }
  return { label: 'Sin accion real', tone: 'neutral', detail: 'Aun no se ha ejecutado accion en Dropea' };
}

function orderTimeline(order) {
  const items = [
    { label: 'Pedido', value: order.createdAt, tone: 'neutral' },
    { label: 'Plantilla', value: order.chatbyTemplateSentAt || order.chatbyTemplateAttemptedAt, tone: order.chatbyTemplateSendStatus === 'failed' ? 'danger' : 'neutral' },
    { label: 'Confirmacion cliente', value: order.confirmationDelayStartedAt, tone: 'positive' },
    { label: 'Revisar/actuar', value: order.confirmationDueAt, tone: 'warning' },
    { label: 'Confirmado', value: order.confirmedAt, tone: 'positive' },
    { label: 'Rechazado', value: order.cancelledAt, tone: 'danger' }
  ].filter((item) => item.value);

  return items.slice(-5);
}

function enrichOrderForAgent(order) {
  const signal = agentCustomerSignal(order);
  const recommendation = agentRecommendation(order);
  const realAction = realActionForOrder(order);
  return {
    ...order,
    customerSignal: signal.code,
    customerSignalLabel: signal.label,
    customerSignalDetail: signal.detail,
    customerSignalTone: signal.tone,
    agentRecommendedAction: recommendation.code,
    agentRecommendedLabel: recommendation.label,
    agentNextStep: recommendation.nextStep,
    agentDecisionExplanation: recommendation.explanation,
    agentDecisionTone: recommendation.tone,
    agentUsefulConfidence: recommendation.confidence,
    realActionLabel: realAction.label,
    realActionTone: realAction.tone,
    realActionDetail: realAction.detail,
    timeline: orderTimeline(order)
  };
}

function latest(items, field, limit = 12) {
  return [...items]
    .sort((a, b) => String(b[field] || '').localeCompare(String(a[field] || '')))
    .slice(0, limit);
}

function parseDashboardDate(value) {
  if (!value) return 0;
  const text = String(value);
  const spanish = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (spanish) {
    const [, day, month, year, hour = '0', minute = '0'] = spanish;
    const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function sortOrdersRecentFirst(orders) {
  return [...orders].sort((a, b) => {
    const dateDiff = parseDashboardDate(b.createdAt) - parseDashboardDate(a.createdAt);
    if (dateDiff) return dateDiff;
    return Number(String(b.orderId || '').replace(/\D/g, '')) - Number(String(a.orderId || '').replace(/\D/g, ''));
  });
}

function uniqueLessons(...groups) {
  const byText = new Map();
  for (const group of groups) {
    for (const item of group || []) {
      if (!item?.text) continue;
      byText.set(normalize(item.text), item);
    }
  }
  return [...byText.values()];
}

function systemAgentMemoryRules() {
  return [
    {
      id: 'system_unanswered_cancel_36h',
      type: 'unanswered_timeout_cancel',
      text: 'Si un pedido de Dropea permanece 36 horas sin confirmacion clara del cliente y sin solicitud de cambio de direccion/datos, el agente debe rechazarlo/cancelarlo automaticamente en Dropea. La accion operativa equivale a seleccionar el pedido, pulsar Cancelar y aceptar, ejecutada por API.',
      source: 'system_rule',
      createdAt: '2026-06-23T00:00:00.000Z'
    }
  ];
}

function defaultFinanceSettings() {
  return {
    dropeaProfit: numberFrom(process.env.DROPEA_DASHBOARD_PROFIT) ?? 448.19,
    dropshipperId: process.env.DROPEA_DROPSHIPPER_ID || '17431',
    source: process.env.DROPEA_DASHBOARD_PROFIT ? 'env_dropea_dashboard_profit' : 'manual_dropea_dashboard',
    updatedAt: new Date().toISOString(),
    note: 'Beneficio neto indicado por Dropea, ya descontando transporte y stock.'
  };
}

async function loadFinanceSettings() {
  return readJson(path.join(dashboardDataDir, 'finance-settings.json'), defaultFinanceSettings());
}

function productCostForOrder(order) {
  const amount = Number(order.amount) || 0;
  if (amount === 24.99) return 8.5;
  if (amount === 34.99) return 12.5;
  if (amount === 29.99) return 10;
  return Number((amount * 0.35).toFixed(2));
}

function paymentCostForOrder(order) {
  const amount = Number(order.amount) || 0;
  return amount ? Number((amount * 0.014 + 0.25).toFixed(2)) : 0;
}

function campaignNumber(row, ...fields) {
  for (const field of fields) {
    const value = numberFrom(row[field]);
    if (value !== null) return value;
  }
  return 0;
}

function normalizeCampaignRow(row) {
  const name = row.campana || row.campaign_name || row.Campana || row.name || row.campaign_id || 'Campana Meta';
  const adsetName = row.conjunto || row.adset_name || row.adsetName || '';
  const adName = row.anuncio || row.ad_name || row.adName || '';
  const product = row.producto || row.Producto || guessProductFromMetaRow(name, adsetName, adName);
  const spend = campaignNumber(row, 'gasto', 'spend', 'Gasto');
  const clicks = campaignNumber(row, 'clicks', 'Clicks');
  const impressions = campaignNumber(row, 'impresiones', 'impressions', 'Impresiones');
  const purchases = campaignNumber(row, 'compras_pixel', 'purchases', 'Compras Pixel');
  const purchaseValue = campaignNumber(row, 'valor_compra_pixel', 'purchaseValue', 'Valor Compra Pixel');
  const cpaPixel = campaignNumber(row, 'cpa_pixel', 'costPerPurchase', 'CPA Pixel') || (purchases ? spend / purchases : 0);
  const roasMeta = campaignNumber(row, 'roas_meta', 'roas', 'ROAS Meta') || (spend ? purchaseValue / spend : 0);
  const day = row.fecha || row.day || row.dateStart || row.periodo_inicio || '';

  return {
    campaignId: row.campaign_id || row.campaignId || row.id || '',
    name,
    adsetName,
    adName,
    product,
    status: row.estado || row.status || row.effective_status || '',
    day,
    periodStart: row.periodo_inicio || row.dateStart || '',
    periodEnd: row.periodo_fin || row.dateStop || '',
    spend,
    impressions,
    reach: campaignNumber(row, 'alcance', 'reach'),
    clicks,
    ctr: campaignNumber(row, 'ctr'),
    cpc: campaignNumber(row, 'cpc'),
    cpm: campaignNumber(row, 'cpm'),
    purchases,
    purchaseValue,
    cpaPixel,
    roasMeta,
    attributedOrders: campaignNumber(row, 'pedidos_dropea_atribuidos'),
    confirmedOrders: campaignNumber(row, 'confirmados_atribuidos'),
    confirmedRevenue: campaignNumber(row, 'ingresos_confirmados'),
    cpaConfirmed: campaignNumber(row, 'cpa_confirmado'),
    roasConfirmed: campaignNumber(row, 'roas_confirmado', 'roasConfirmado', 'ROAS Confirmado'),
    source: row.fuente || row.source || ''
  };
}

function buildCampaignAnalytics(campaignRows) {
  const campaigns = campaignRows
    .map(normalizeCampaignRow)
    .filter((campaign) => (
      Number(campaign.spend || 0) > 0
      || Number(campaign.impressions || 0) > 0
      || Number(campaign.clicks || 0) > 0
      || Number(campaign.purchases || 0) > 0
    ))
    .sort((a, b) => String(b.day || b.periodStart || '').localeCompare(String(a.day || a.periodStart || '')) || b.spend - a.spend);
  const byProduct = new Map();
  const byDay = new Map();

  for (const campaign of campaigns) {
    const product = campaign.product || 'Sin producto detectado';
    const current = byProduct.get(product) || {
      product,
      campaigns: 0,
      spend: 0,
      impressions: 0,
      clicks: 0,
      purchases: 0,
      purchaseValue: 0,
      attributedOrders: 0,
      confirmedOrders: 0,
      confirmedRevenue: 0
    };
    current.campaigns += 1;
    current.spend += campaign.spend;
    current.impressions += campaign.impressions;
    current.clicks += campaign.clicks;
    current.purchases += campaign.purchases;
    current.purchaseValue += campaign.purchaseValue;
    current.attributedOrders += campaign.attributedOrders;
    current.confirmedOrders += campaign.confirmedOrders;
    current.confirmedRevenue += campaign.confirmedRevenue;
    byProduct.set(product, current);

    const day = campaign.day || campaign.periodStart || 'Sin fecha';
    const dayItem = byDay.get(day) || {
      day,
      campaigns: 0,
      spend: 0,
      impressions: 0,
      reach: 0,
      clicks: 0,
      purchases: 0,
      purchaseValue: 0,
      bestCampaign: '',
      bestRoas: 0,
      worstCampaign: '',
      worstRoas: null
    };
    dayItem.campaigns += 1;
    dayItem.spend += campaign.spend;
    dayItem.impressions += campaign.impressions;
    dayItem.reach += campaign.reach;
    dayItem.clicks += campaign.clicks;
    dayItem.purchases += campaign.purchases;
    dayItem.purchaseValue += campaign.purchaseValue;
    if (campaign.roasMeta > dayItem.bestRoas) {
      dayItem.bestRoas = campaign.roasMeta;
      dayItem.bestCampaign = campaign.name;
    }
    if (campaign.spend > 0 && (dayItem.worstRoas === null || campaign.roasMeta < dayItem.worstRoas)) {
      dayItem.worstRoas = campaign.roasMeta;
      dayItem.worstCampaign = campaign.name;
    }
    byDay.set(day, dayItem);
  }

  const products = [...byProduct.values()].map((item) => ({
    ...item,
    ctr: item.impressions ? item.clicks / item.impressions : 0,
    cpc: item.clicks ? item.spend / item.clicks : 0,
    cpaPixel: item.purchases ? item.spend / item.purchases : 0,
    roasMeta: item.spend ? item.purchaseValue / item.spend : 0,
    cpaConfirmed: item.confirmedOrders ? item.spend / item.confirmedOrders : 0,
    roasConfirmed: item.spend ? item.confirmedRevenue / item.spend : 0
  })).sort((a, b) => b.spend - a.spend);

  const totals = campaigns.reduce((total, campaign) => ({
    campaigns: total.campaigns + 1,
    spend: total.spend + campaign.spend,
    impressions: total.impressions + campaign.impressions,
    reach: total.reach + campaign.reach,
    clicks: total.clicks + campaign.clicks,
    purchases: total.purchases + campaign.purchases,
    purchaseValue: total.purchaseValue + campaign.purchaseValue,
    attributedOrders: total.attributedOrders + campaign.attributedOrders,
    confirmedOrders: total.confirmedOrders + campaign.confirmedOrders,
    confirmedRevenue: total.confirmedRevenue + campaign.confirmedRevenue
  }), {
    campaigns: 0,
    spend: 0,
    impressions: 0,
    reach: 0,
    clicks: 0,
    purchases: 0,
    purchaseValue: 0,
    attributedOrders: 0,
    confirmedOrders: 0,
    confirmedRevenue: 0
  });

  return {
    campaigns,
    products,
    days: [...byDay.values()].map((item) => ({
      ...item,
      ctr: item.impressions ? item.clicks / item.impressions : 0,
      cpc: item.clicks ? item.spend / item.clicks : 0,
      cpaPixel: item.purchases ? item.spend / item.purchases : 0,
      roasMeta: item.spend ? item.purchaseValue / item.spend : 0
    })).sort((a, b) => String(b.day || '').localeCompare(String(a.day || ''))),
    totals: {
      ...totals,
      ctr: totals.impressions ? totals.clicks / totals.impressions : 0,
      cpc: totals.clicks ? totals.spend / totals.clicks : 0,
      cpaPixel: totals.purchases ? totals.spend / totals.purchases : 0,
      roasMeta: totals.spend ? totals.purchaseValue / totals.spend : 0,
      cpaConfirmed: totals.confirmedOrders ? totals.spend / totals.confirmedOrders : 0,
      roasConfirmed: totals.spend ? totals.confirmedRevenue / totals.spend : 0
    }
  };
}

function calculateFinance({ orders, campaignRows, metaRows, financeSettings }) {
  const recognizedOrders = orders.filter(isRecognizedSale);
  const revenue = recognizedOrders.reduce((sum, order) => sum + (Number(order.amount) || 0), 0);
  const productCost = recognizedOrders.reduce((sum, order) => sum + productCostForOrder(order), 0);
  const paymentFees = recognizedOrders.reduce((sum, order) => sum + paymentCostForOrder(order), 0);
  const campaignSpend = campaignRows.reduce((sum, row) => sum + normalizeCampaignRow(row).spend, 0);
  const spendRow = metaRows.find((row) => normalize(row.Metrica) === 'gasto meta');
  const metaSpend = campaignSpend || numberFrom(spendRow?.Valor) || 0;
  const dropeaProfit = numberFrom(financeSettings?.dropeaProfit);
  const businessProfit = dropeaProfit !== null ? dropeaProfit - metaSpend : revenue - productCost - paymentFees - metaSpend;
  const attributedOrders = campaignRows.reduce((sum, row) => sum + (numberFrom(row.pedidos_dropea_atribuidos) || 0), 0);
  const warnings = [
    'El beneficio principal usa el beneficio neto marcado por Dropea y resta Meta.',
    !attributedOrders && metaSpend ? 'El gasto Meta no esta atribuido a pedidos concretos; se usa gasto del periodo disponible.' : null,
    campaignSpend ? null : 'Meta no esta disponible en vivo; se usa el ultimo dato guardado en Sheets si existe.',
    dropeaProfit === null ? 'No hay beneficio Dropea disponible; se usa calculo alternativo.' : null
  ].filter(Boolean);

  return {
    recognizedOrders: recognizedOrders.length,
    revenue,
    productCost,
    paymentFees,
    metaSpend,
    dropeaProfit,
    businessProfit,
    netProfit: revenue - productCost - paymentFees - metaSpend,
    formula: 'Beneficio real = beneficio neto Dropea - gasto Meta',
    alternativeFormula: 'Alternativo = ingresos pedidos reconocidos - coste producto estimado - comisiones estimadas - gasto Meta',
    source: financeSettings?.source || 'unknown',
    sourceNote: financeSettings?.note || '',
    dropshipperId: financeSettings?.dropshipperId || '17431',
    warnings
  };
}

async function readIntegrationHealthcheck() {
  const logPath = path.resolve(root, '..', 'integration-healthcheck.log');
  try {
    const [raw, stat] = await Promise.all([
      fs.readFile(logPath, 'utf8'),
      fs.stat(logPath)
    ]);
    const services = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('{'))
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    return { ok: services.length > 0, services, updatedAt: stat.mtime.toISOString() };
  } catch {
    return { ok: false, services: [], updatedAt: null };
  }
}

function secretState(value) {
  return value ? 'guardado' : 'falta';
}

async function buildConnectionVault({ sources }) {
  const healthcheck = await readIntegrationHealthcheck();
  const envVars = {
    Dropea: {
      apiKey: secretState(config.dropeaApiKey),
      dropshipperId: process.env.DROPEA_DROPSHIPPER_ID || '17431'
    },
    Chatby: {
      token: secretState(config.chatbyToken),
      baseUrl: config.chatbyBaseUrl
    },
    Shopify: {
      domain: config.shopifyDomain || config.defaultStore.shopifyDomain || 'no configurado',
      clientId: secretState(config.shopifyClientId),
      clientSecret: secretState(config.shopifyClientSecret),
      apiVersion: config.shopifyApiVersion
    },
    Meta: {
      accessToken: secretState(config.metaAccessToken),
      businessId: config.metaBusinessId || 'no configurado',
      adAccountId: config.metaAdAccountId || 'no configurado',
      apiVersion: config.metaApiVersion
    },
    GoogleSheets: {
      sheetId: secretState(config.googleSheetId),
      serviceAccount: config.googleServiceAccountEmail || 'no configurado',
      privateKey: secretState(config.googlePrivateKey)
    },
    OpenAI: {
      apiKey: secretState(config.openaiApiKey),
      model: config.openaiModel
    }
  };

  return {
    storagePolicy: 'Los secretos viven en autoconfirm/.env y en variables de entorno de Render. El dashboard solo muestra estado, nunca valores.',
    lastHealthcheckAt: healthcheck.updatedAt,
    healthcheckServices: healthcheck.services,
    liveSources: sources.map((source) => ({ name: source.name, ok: Boolean(source.ok), error: source.error || null })),
    envVars,
    runbook: 'SULEIA_CONNECTIONS_RUNBOOK.md'
  };
}

async function loadLiveDropeaOrders(knownOrderIds) {
  const source = { name: 'Dropea API - pedidos vivos', ok: true, error: null };
  const orders = [];
  try {
    const recent = await listRecentDropeaOrders({ limit: 100, pages: 3 });
    orders.push(...recent.map(orderFromDropea));
    source.statuses = 'multiestado';

    for (const orderId of [...new Set(knownOrderIds)].filter(Boolean)) {
      if (orders.some((order) => String(order.orderId) === String(orderId))) continue;
      try {
        const order = await getDropeaOrderById(orderId);
        if (order) orders.push(orderFromDropea(order));
      } catch {
        // Keep dashboard available even if one old order cannot be hydrated.
      }
    }
  } catch (error) {
    try {
      for (let page = 1; page <= 10; page += 1) {
        const pending = await listPendingDropeaOrders({ limit: 100, page });
        if (!Array.isArray(pending) || !pending.length) break;
        orders.push(...pending.map(orderFromDropea));
        if (pending.length < 100) break;
      }
      source.warning = error instanceof Error ? error.message : String(error);
      source.statuses = 'PENDING fallback';
    } catch {
      source.ok = false;
      source.error = error instanceof Error ? error.message : String(error);
    }
  }
  source.rows = orders.length;
  return { source, orders };
}

async function loadOperationalDropeaOrders() {
  const source = {
    name: 'Dropea API - pendientes e incidencias',
    ok: true,
    error: null,
    statuses: 'PENDING + pedidos con issues',
    generatedAt: new Date().toISOString()
  };
  const byId = new Map();

  try {
    for (const status of ['PENDING', 'CONFIRMED', 'IN_PREPARATION', 'PREPARED', 'IN_TRANSIT']) {
      for (let page = 1; page <= 3; page += 1) {
        let pageOrders = [];
        try {
          pageOrders = status === 'PENDING'
            ? await listPendingDropeaOrders({ limit: 100, page })
            : await listDropeaOrdersByStatusBasic({ status, limit: 100, page });
        } catch (error) {
          if (status === 'PENDING') throw error;
          break;
        }
        if (!Array.isArray(pageOrders) || !pageOrders.length) break;
        for (const order of pageOrders) {
          const hasIssues = Array.isArray(order.raw?.issues)
            ? order.raw.issues.length > 0
            : Boolean(order.raw?.issues);
          if (status === 'PENDING' || hasIssues) {
            byId.set(String(order.orderId), orderFromDropea(order));
          }
        }
        if (pageOrders.length < 100) break;
      }
    }
  } catch (error) {
    source.ok = false;
    source.error = error instanceof Error ? error.message : String(error);
  }

  const orders = [...byId.values()];
  source.rows = orders.length;
  return { source, orders };
}

async function loadLiveShopifyOrders() {
  const source = {
    name: 'Shopify API - pedidos recientes',
    ok: true,
    error: null,
    generatedAt: new Date().toISOString()
  };
  try {
    const recent = await listRecentShopifyOrders({ first: 100 });
    return {
      source: { ...source, rows: recent.length },
      orders: recent.map(orderFromShopify)
    };
  } catch (error) {
    source.ok = false;
    source.error = error instanceof Error ? error.message : String(error);
    return { source, orders: [] };
  }
}

function cacheIsFresh(cache, ttlMinutes) {
  const updatedAt = new Date(cache?.source?.generatedAt || cache?.updatedAt || 0).getTime();
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return false;
  return Date.now() - updatedAt < ttlMinutes * 60 * 1000;
}

async function loadLiveMetaCampaigns({ force = false } = {}) {
  const generatedAt = new Date().toISOString();
  const source = { name: 'Meta API - campanas en vivo', ok: true, error: null, generatedAt };
  const cachePath = path.join(dashboardDataDir, 'meta-campaign-cache.json');
  const ttlMinutes = config.metaDashboardIntervalMinutes || 720;
  const cached = await readJson(cachePath, null);

  if (!force && cached?.campaigns && cacheIsFresh(cached, ttlMinutes)) {
    return {
      source: {
        ...(cached.source || source),
        name: 'Meta API - cache rapido',
        ok: true,
        cached: true,
        cacheAgeMinutes: Math.round((Date.now() - new Date(cached.source?.generatedAt || cached.updatedAt).getTime()) / 60000),
        nextRefreshAt: new Date(new Date(cached.source?.generatedAt || cached.updatedAt).getTime() + ttlMinutes * 60 * 1000).toISOString()
      },
      campaigns: cached.campaigns || []
    };
  }

  try {
    const datePreset = process.env.META_DASHBOARD_DATE_PRESET || 'this_month';
    const insights = await getCampaignInsights({ datePreset, level: 'ad', limit: 500, timeIncrement: 1 });
    const result = {
      source: { ...source, period: datePreset, rows: insights.length },
      campaigns: insights.map((item) => ({
        campaign_id: item.campaignId,
        campana: item.campaignName,
        adset_id: item.adsetId,
        conjunto: item.adsetName,
        ad_id: item.adId,
        anuncio: item.adName,
        fecha: item.dateStart,
        producto: guessProductFromMetaRow(item.campaignName, item.adsetName, item.adName),
        periodo_inicio: item.dateStart,
        periodo_fin: item.dateStop,
        gasto: item.spend,
        impresiones: item.impressions,
        alcance: item.reach,
        clicks: item.clicks,
        ctr: item.ctr,
        cpc: item.cpc,
        cpm: item.cpm,
        compras_pixel: item.purchases,
        valor_compra_pixel: item.purchaseValue,
        cpa_pixel: item.costPerPurchase,
        roas_meta: item.roas,
        roas_confirmado: '',
        fuente: 'Meta API en vivo'
      }))
    };
    await writeJson(cachePath, { ...result, updatedAt: generatedAt });
    return result;
  } catch (error) {
    if (cached?.campaigns) {
      return {
        source: {
          ...(cached.source || source),
          name: 'Meta API - cache por fallo de vivo',
          ok: true,
          cached: true,
          stale: true,
          error: error instanceof Error ? error.message : String(error)
        },
        campaigns: cached.campaigns || []
      };
    }
    source.ok = false;
    source.error = error instanceof Error ? error.message : String(error);
    return { source, campaigns: [] };
  }
}

function buildProducts(orders, campaignAnalytics = { products: [] }) {
  const products = new Map([
    ['NIDA premium', { name: 'NIDA premium', price: 34.99, cost: 12.5, status: 'Activo', orders: 0, confirmedOrders: 0, revenue: 0 }],
    ['Collagum', { name: 'Collagum', price: 24.99, cost: 8.5, status: 'Test', orders: 0, confirmedOrders: 0, revenue: 0 }]
  ]);
  for (const order of orders) {
    const name = order.product || 'Producto';
    const product = products.get(name) || { name, price: order.amount || 0, cost: 0, status: 'Detectado', orders: 0, confirmedOrders: 0, revenue: 0 };
    product.orders += 1;
    if (isRecognizedSale(order)) {
      product.confirmedOrders += 1;
      product.revenue += Number(order.amount) || 0;
    }
    products.set(name, product);
  }

  for (const metaProduct of campaignAnalytics.products || []) {
    const name = metaProduct.product || 'Sin producto detectado';
    const product = products.get(name) || { name, price: 0, cost: 0, status: 'Detectado en Meta', orders: 0, confirmedOrders: 0, revenue: 0 };
    product.metaSpend = Number(metaProduct.spend || 0);
    product.metaPurchases = Number(metaProduct.purchases || 0);
    product.metaPurchaseValue = Number(metaProduct.purchaseValue || 0);
    product.metaRoas = Number(metaProduct.roasMeta || 0);
    product.metaCpa = Number(metaProduct.cpaPixel || 0);
    product.metaCtr = Number(metaProduct.ctr || 0);
    product.metaClicks = Number(metaProduct.clicks || 0);
    product.metaImpressions = Number(metaProduct.impressions || 0);
    products.set(name, product);
  }

  return [...products.values()].map((product) => ({
    ...product,
    margin: product.price ? Math.round(((product.price - product.cost) / product.price) * 100) : null,
    conversionRate: product.orders ? product.confirmedOrders / product.orders : null,
    contribution: Number(product.revenue || 0) - Number(product.metaSpend || 0),
    recommendation: product.metaSpend > 20 && !product.metaPurchases
      ? 'Revisar antes de escalar'
      : product.metaRoas >= 4
        ? 'Escalable'
        : product.metaRoas >= 2
          ? 'Mantener y optimizar'
          : product.orders
            ? 'Necesita mas datos'
            : 'Pendiente de venta'
  })).sort((a, b) => Number(b.revenue || 0) - Number(a.revenue || 0) || Number(b.metaSpend || 0) - Number(a.metaSpend || 0));
}

function alibabaSearchUrl(query) {
  return `https://www.alibaba.com/trade/search?SearchText=${encodeURIComponent(query)}`;
}

function beautyOpportunityCatalog() {
  return [
    {
      name: 'Crema cuello y escote efecto tensor',
      category: 'Cuidado facial premium',
      query: 'neck firming cream private label',
      targetAudience: 'Mujeres 35+ que ya compran hidratantes y buscan firmeza visible.',
      why: 'Complementa NIDA sin canibalizarla: permite rutina rostro + cuello y aumenta ticket medio.',
      metaAngles: ['Antes/despues cuello y escote', 'Rutina antiedad en 30 segundos', 'Pack rostro + cuello'],
      expectedTicket: '29,99 € - 39,99 €',
      supplierTarget: 'Cosmetica private label con GMP/ISO, MOQ bajo y opcion de tarro premium.',
      validation: ['Revisar Biblioteca de Anuncios de Meta en Espana', 'Pedir 3 muestras', 'Validar claims permitidos en UE'],
      risks: ['Claims de firmeza demasiado agresivos', 'Textura o perfume pueden elevar devoluciones']
    },
    {
      name: 'Serum facial vitamina C + acido hialuronico',
      category: 'Luminosidad y manchas',
      query: 'vitamin c hyaluronic acid serum private label',
      targetAudience: 'Cliente que compra hidratante y busca piel luminosa, manchas y efecto buena cara.',
      why: 'Producto visual, facil de explicar en anuncios y compatible con packs junto a NIDA.',
      metaAngles: ['Piel apagada vs piel luminosa', 'Rutina manana de 2 pasos', 'Pack serum + crema'],
      expectedTicket: '24,99 € - 34,99 €',
      supplierTarget: 'Serum con envase airless/opaco, documentacion CPNP y estabilidad validada.',
      validation: ['Comparar creativos ganadores de competidores', 'Revisar coste por muestra', 'Test A/B landing simple'],
      risks: ['Mercado competido', 'Necesita diferenciacion clara en formula/envase']
    },
    {
      name: 'Parches hidrogel contorno de ojos',
      category: 'Belleza rapida y visual',
      query: 'hydrogel eye patches private label collagen',
      targetAudience: 'Compradora impulsiva que responde a contenido visual de ojeras, bolsas y frescor.',
      why: 'Muy demostrable en video, buen producto de entrada y facil de combinar en upsell.',
      metaAngles: ['Efecto frio inmediato', 'Rutina express antes de salir', 'Pack descanso facial'],
      expectedTicket: '19,99 € - 29,99 €',
      supplierTarget: 'Parches con hidrogel, colageno o niacinamida, packaging premium y lote pequeno.',
      validation: ['Verificar tolerancia piel sensible', 'Validar tiempos de entrega', 'Probar creativos UGC'],
      risks: ['Ticket bajo si no se vende en pack', 'Necesita fotos/video muy buenos']
    },
    {
      name: 'Balsamo labial volumen natural',
      category: 'Labios y belleza diaria',
      query: 'lip plumper balm private label natural',
      targetAudience: 'Mujeres que buscan producto de belleza pequeno, recurrente y facil de llevar.',
      why: 'Producto compacto con alto potencial de repeticion y buen encaje con contenido Meta Ads.',
      metaAngles: ['Labio hidratado y jugoso', 'Bolso/neceser diario', 'Antes/despues sutil'],
      expectedTicket: '18,99 € - 24,99 €',
      supplierTarget: 'Balsamo sin claims medicos, con ingredientes hidratantes y packaging elegante.',
      validation: ['Revisar ingredientes irritantes', 'Pedir muestras', 'Test de bundle con Collagum'],
      risks: ['Claims de volumen limitados', 'Puede requerir alto volumen para rentabilidad']
    },
    {
      name: 'Mascarilla nocturna hidratante',
      category: 'Hidratacion intensiva',
      query: 'overnight hydrating face mask private label',
      targetAudience: 'Cliente de crema hidratante que quiere resultado visible al despertar.',
      why: 'Extiende la promesa de hidratacion de Suleia y permite campanas de rutina nocturna.',
      metaAngles: ['Piel descansada al despertar', 'Rutina noche premium', 'Antes de dormir en 20 segundos'],
      expectedTicket: '29,99 € - 39,99 €',
      supplierTarget: 'Formula hidratante con textura sensorial, tarro o tubo premium y documentacion UE.',
      validation: ['Comparar margen con NIDA', 'Testar fragancia/textura', 'Validar fotos sensoriales'],
      risks: ['Muy cercano a NIDA si no se posiciona como noche/intensivo']
    }
  ];
}

function campaignVerdict(campaign) {
  const roas = Number(campaign.roasMeta || campaign.roasConfirmed || 0);
  const purchases = Number(campaign.purchases || 0);
  const spend = Number(campaign.spend || 0);
  if (roas >= 5 && purchases >= 2) return { label: 'Escalar', tone: 'positive', action: 'Subir presupuesto de forma gradual y duplicar creativo ganador.' };
  if (roas >= 2.5) return { label: 'Mantener y optimizar', tone: 'warning', action: 'Mantener presupuesto, probar 2 creativos y vigilar CPA.' };
  if (spend > 20 && purchases === 0) return { label: 'Pausar/revisar', tone: 'danger', action: 'Revisar anuncio, landing y audiencia antes de invertir mas.' };
  return { label: 'Aprendizaje', tone: 'neutral', action: 'Esperar mas datos o agrupar con campanas similares.' };
}

function buildBusinessManager({ campaignAnalytics, finance, orders, lastRequestedAt = null }) {
  const campaigns = campaignAnalytics.campaigns || [];
  const products = campaignAnalytics.products || [];
  const totals = campaignAnalytics.totals || {};
  const topCampaigns = [...campaigns]
    .filter((campaign) => Number(campaign.spend || 0) > 0)
    .sort((left, right) => Number(right.roasMeta || 0) - Number(left.roasMeta || 0) || Number(right.purchases || 0) - Number(left.purchases || 0))
    .slice(0, 6)
    .map((campaign) => ({
      campaign: campaign.name,
      product: campaign.product || 'Sin producto detectado',
      day: campaign.day || campaign.periodStart || '',
      spend: campaign.spend,
      purchases: campaign.purchases,
      roas: campaign.roasMeta,
      cpa: campaign.cpaPixel,
      ctr: campaign.ctr,
      ...campaignVerdict(campaign)
    }));

  const strongestProduct = [...products].sort((left, right) => Number(right.roasMeta || 0) - Number(left.roasMeta || 0))[0] || null;
  const totalOrders = Array.isArray(orders) ? orders.length : 0;
  const activeProducts = new Set((orders || []).map((order) => order.product || guessProduct(order))).size;
  const marketFitBoost = strongestProduct?.product === 'NIDA premium' ? 8 : 0;
  const opportunities = beautyOpportunityCatalog().map((item, index) => {
    const score = Math.max(60, Math.min(98, 88 - (index * 4) + marketFitBoost + (Number(totals.roasMeta || 0) >= 3 ? 3 : 0)));
    return {
      ...item,
      score,
      priority: score >= 90 ? 'Alta' : score >= 80 ? 'Media-alta' : 'Media',
      alibabaSearch: alibabaSearchUrl(item.query),
      sourceType: 'Radar manager del negocio',
      evidence: [
        `Encaje con cartera actual: ${item.category}.`,
        strongestProduct ? `Meta actual: mejor producto ${strongestProduct.product} con ROAS ${Number(strongestProduct.roasMeta || 0).toFixed(2)}x.` : 'Meta actual: pendiente de acumular mas datos por producto.',
        'Proveedor: busqueda preparada en Alibaba; requiere validar certificaciones, muestras y costes reales.'
      ]
    };
  }).sort((a, b) => b.score - a.score);

  const recommendedNextMove = topCampaigns.find((item) => item.label === 'Escalar')?.action
    || (topCampaigns[0]?.action || 'Reunir mas datos de Meta antes de escalar presupuesto.');

  return {
    name: 'Manager del negocio',
    role: 'Marketing, escalado y radar de productos',
    status: 'Activo bajo demanda',
    updatedAt: new Date().toISOString(),
    lastRequestedAt,
    summary: `Analiza Meta Ads, rentabilidad y oportunidades de belleza para escalar Suleia sin tocar el agente logistico.`,
    kpis: {
      metaSpend: finance.metaSpend,
      metaPurchases: totals.purchases || 0,
      metaRoas: totals.roasMeta || 0,
      businessProfit: finance.businessProfit,
      activeProducts,
      analyzedOrders: totalOrders
    },
    recommendedNextMove,
    campaignActions: topCampaigns,
    productReports: opportunities,
    safeguards: [
      'No confirma, rechaza ni modifica pedidos.',
      'No envia plantillas de Chatby.',
      'Solo lee metricas y genera informes comerciales.',
      'Las oportunidades de proveedor son hipotesis: validar muestras, certificaciones y costes antes de comprar.'
    ]
  };
}

function moneyText(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 'sin dato';
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(number);
}

function buildAgentReply({ message, dashboard }) {
  const text = String(message || '').trim();
  const lower = normalize(text);
  const finance = dashboard.finance || {};
  let reply = 'He guardado tu mensaje como aprendizaje operativo. Lo tendre en cuenta junto con el feedback por pedido.';
  if (lower.includes('beneficio') || lower.includes('meta') || lower.includes('dropea')) {
    reply = `Estoy usando beneficio Dropea (${moneyText(finance.dropeaProfit)}) menos Meta (${moneyText(finance.metaSpend)}). Beneficio final actual: ${moneyText(finance.businessProfit)}.`;
  } else if (lower.includes('confirm') || lower.includes('pedido')) {
    reply = 'Aprendido. Para confirmaciones, priorizare boton de Chatby, etiqueta CONFIRMADO o mensaje explicito. Si hay cambio de direccion o datos de entrega, lo dejare pendiente por direccion y no lo confirmare.';
  }
  const lessonType = memoryTypeFromMessage(text);
  const lesson = lessonType
    ? { id: `lesson_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, type: lessonType, text, source: 'agent_chat', createdAt: new Date().toISOString() }
    : null;
  return { reply, lesson };
}

function memoryTypeFromMessage(text) {
  const normalized = normalize(text);
  if (!normalized) return null;
  const shouldLearn = [
    'aprende',
    'recuerda',
    'guarda',
    'memoria',
    'regla',
    'criterio',
    'cuando',
    'si el cliente',
    'debes',
    'deberias',
    'deberia',
    'procedimiento',
    'proceso',
    'checklist',
    'tarea',
    'accion',
    'mejora',
    'analiza',
    'audita',
    'producto',
    'competencia',
    'meta ads',
    'rentabilidad',
    'beneficio'
  ].some((keyword) => normalized.includes(keyword));
  if (!shouldLearn) return null;
  if (normalized.includes('procedimiento') || normalized.includes('proceso') || normalized.includes('checklist')) return 'operational_process';
  if (normalized.includes('meta ads') || normalized.includes('campana') || normalized.includes('campanas')) return 'marketing_rule';
  if (normalized.includes('producto') || normalized.includes('competencia') || normalized.includes('catalogo')) return 'product_research_rule';
  if (normalized.includes('beneficio') || normalized.includes('rentabilidad') || normalized.includes('dropea')) return 'finance_rule';
  if (normalized.includes('pedido') || normalized.includes('cliente') || normalized.includes('confirm')) return 'order_decision_rule';
  return 'feedback_rule';
}

function isAddressChangeFeedback(text) {
  const normalized = normalize(text);
  return normalized.includes('cambio de direccion')
    || normalized.includes('address_change')
    || normalized.includes('cambiar direccion')
    || normalized.includes('modificar direccion')
    || normalized.includes('corregir direccion')
    || normalized.includes('cambio direccion')
    || normalized.includes('cambiar datos')
    || normalized.includes('modificar datos')
    || normalized.includes('datos de entrega');
}

function learnedRuleFromFeedback(item) {
  const text = [item.verdict, item.correction, item.note].filter(Boolean).join(' ');
  if (item.verdict === 'should_confirm') {
    return {
      id: `lesson_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'confirmed_customer_signal',
      text: 'Si el cliente confirma claramente el pedido por boton de Chatby o por texto explicito, el agente debe marcarlo como confirmado por cliente y no dejarlo en revision manual.',
      source: `feedback_order_${item.orderId}`,
      createdAt: new Date().toISOString()
    };
  }
  if (item.verdict === 'address_change' || isAddressChangeFeedback(text)) {
    return {
      id: `lesson_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'address_change_no_confirm',
      text: 'No confirmar pedidos cuando el cliente marca, solicita o menciona cambio de direccion/datos de entrega. Dejar el pedido pendiente por direccion hasta corregir direccion en Dropea.',
      source: `feedback_order_${item.orderId}`,
      createdAt: new Date().toISOString()
    };
  }
  if (item.verdict === 'absent_or_issue') {
    return {
      id: `lesson_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'absent_or_issue_followup',
      text: 'Si el pedido esta ausente o en incidencia, el agente no debe confirmar automaticamente: debe pedir seguimiento, nueva entrega o revision operativa antes de actuar.',
      source: `feedback_order_${item.orderId}`,
      createdAt: new Date().toISOString()
    };
  }
  if (item.verdict === 'rejected_or_cancelled' || item.verdict === 'should_not_confirm') {
    return {
      id: `lesson_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'rejected_or_cancelled_no_confirm',
      text: 'Si el cliente rechaza, cancela, dice que no lo quiere o no confirma de forma clara, el agente no debe confirmar el pedido.',
      source: `feedback_order_${item.orderId}`,
      createdAt: new Date().toISOString()
    };
  }
  if (item.verdict === 'unclear_wait') {
    return {
      id: `lesson_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'unclear_wait_customer',
      text: 'Si la respuesta del cliente es dudosa o no contiene una senal clara, el agente debe esperar respuesta y explicar que no confirma por falta de evidencia.',
      source: `feedback_order_${item.orderId}`,
      createdAt: new Date().toISOString()
    };
  }
  if (item.verdict === 'duplicate_order') {
    return {
      id: `lesson_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'duplicate_manual_review',
      text: 'Si el pedido parece duplicado, el agente debe enviarlo a revision manual y no confirmar automaticamente.',
      source: `feedback_order_${item.orderId}`,
      createdAt: new Date().toISOString()
    };
  }
  if (item.correction || item.note) {
    return {
      id: `lesson_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'feedback_rule',
      text: [item.correction, item.note].filter(Boolean).join(' | '),
      source: `feedback_order_${item.orderId}`,
      createdAt: new Date().toISOString()
    };
  }
  return null;
}

function latestIncidentFeedbackByKey(feedback = []) {
  const map = new Map();
  for (const item of feedback) {
    const key = `${item.orderId || ''}:${item.incidenceId || ''}`;
    if (!key || key === ':') continue;
    const current = map.get(key);
    if (!current || new Date(item.createdAt || 0) > new Date(current.createdAt || 0)) {
      map.set(key, item);
    }
  }
  return map;
}

function latestIncidentMemoryByKey(memory = []) {
  const map = new Map();
  for (const item of memory) {
    if (item.scope && item.scope !== 'incidents') continue;
    const sourceOrderMatch = String(item.source || '').match(/feedback_incident_(\d+)/);
    const memoryOrderId = item.orderId || sourceOrderMatch?.[1] || '';
    const memoryIncidenceId = item.incidenceId || '';
    if (!memoryOrderId && !memoryIncidenceId) continue;
    const key = `${memoryOrderId}:${memoryIncidenceId}`;
    const fallbackKey = `${memoryOrderId}:`;
    for (const candidate of [key, fallbackKey]) {
      if (!candidate || candidate === ':') continue;
      const current = map.get(candidate);
      if (!current || new Date(item.createdAt || 0) > new Date(current.createdAt || 0)) {
        map.set(candidate, item);
      }
    }
  }
  return map;
}

function clipText(value, max = 220) {
  const text = String(value || '').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}...`;
}

function applyIncidentMemory(incident, memoryItem) {
  if (!memoryItem) return incident;
  const memoryText = String(memoryItem.text || memoryItem.note || '').trim();
  if (!memoryText) return incident;
  const normalized = normalize(memoryText);
  const isDeliveryInstruction =
    normalized.includes('entregar') ||
    normalized.includes('franja') ||
    normalized.includes('horario') ||
    normalized.includes('telefono') ||
    normalized.includes('tarde') ||
    normalized.includes('manana');
  const base = {
    ...incident,
    memoryApplied: true,
    memoryText,
    memoryAt: memoryItem.createdAt,
    evidence: Array.from(new Set([...(incident.evidence || []), 'memoria aplicada'])),
    contextConfidence: Math.max(Number(incident.contextConfidence || 0), isDeliveryInstruction ? 88 : 75),
    confidenceReason: incident.confidenceReason || 'Confianza reforzada por una regla aprendida desde feedback manual.'
  };

  if (!isDeliveryInstruction) {
    return base;
  }

  return {
    ...base,
    chatbyIntent: incident.chatbyIntent === 'outbound_only' ? 'delivery_instruction' : incident.chatbyIntent,
    chatbyStatus: 'Aprendizaje aplicado',
    customerSignalLabel: 'Aprendizaje aplicado',
    customerSignalTone: 'positive',
    customerSignalDetail: 'Hay una regla guardada para este caso o pedido.',
    chatbySummary: `Memoria aplicada: ${clipText(memoryText)}`,
    proposedSolution: `Resolver en Dropea usando la instruccion aprendida del cliente: ${clipText(memoryText)}`,
    recommendedNextStep: `Resolver en Dropea usando la instruccion aprendida del cliente: ${clipText(memoryText)}`,
    actionRecommended: 'Resolver con instruccion del cliente',
    actionTone: 'success',
    customerResponded: true,
    alertLevel: 'customer_action',
    priority: 'high'
  };
}

function mergeIncidentFeedback(incidents, feedback, memory = []) {
  const byKey = latestIncidentFeedbackByKey(feedback);
  const memoryByKey = latestIncidentMemoryByKey(memory);
  return {
    ...incidents,
    intervalMinutes: incidents.intervalMinutes ?? config.defaultStore.incidentsSyncIntervalMinutes,
    incidents: (incidents.incidents || []).map((incident) => {
      const key = `${incident.orderId || ''}:${incident.incidenceId || ''}`;
      const fallbackKey = `${incident.orderId || ''}:`;
      const item = byKey.get(key) || byKey.get(fallbackKey);
      const memoryItem = memoryByKey.get(key) || memoryByKey.get(fallbackKey);
      const withFeedback = item ? {
        ...incident,
        feedbackVerdict: item.verdict,
        feedbackCorrection: item.correction,
        feedbackNote: item.note,
        feedbackAt: item.createdAt
      } : incident;
      return applyIncidentMemory(withFeedback, memoryItem);
    })
  };
}

function learnedRuleFromIncidentFeedback(item) {
  const text = [item.verdict, item.issueType, item.correction, item.note].filter(Boolean).join(' ');
  const normalized = normalize(text);
  const type = String(item.issueType || '').trim();

  if (item.verdict === 'resolve_delivery_instruction' || normalized.includes('entregar') || normalized.includes('franja')) {
    return {
      id: `lesson_incident_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'incident_delivery_instruction',
      scope: 'incidents',
      orderId: item.orderId,
      incidenceId: item.incidenceId,
      issueType: item.issueType,
      text: 'En incidencias, si el cliente indica franja, horario, teléfono o instrucción de entrega, proponer resolver en Dropea copiando esa instrucción y no tratarlo como falta de respuesta.',
      source: `feedback_incident_${item.orderId}`,
      createdAt: new Date().toISOString()
    };
  }
  if (item.verdict === 'request_address_data' || type === 'address' || normalized.includes('direccion') || normalized.includes('dirección')) {
    return {
      id: `lesson_incident_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'incident_address_data',
      scope: 'incidents',
      orderId: item.orderId,
      incidenceId: item.incidenceId,
      issueType: item.issueType,
      text: 'En incidencias de dirección o datos incompletos, no cerrar la incidencia hasta tener calle, número, piso/puerta si aplica, CP, ciudad y teléfono válido.',
      source: `feedback_incident_${item.orderId}`,
      createdAt: new Date().toISOString()
    };
  }
  if (item.verdict === 'cancel_or_reject' || type === 'rejected_goods' || normalized.includes('rechaz') || normalized.includes('cancel')) {
    return {
      id: `lesson_incident_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'incident_reject_goods',
      scope: 'incidents',
      orderId: item.orderId,
      incidenceId: item.incidenceId,
      issueType: item.issueType,
      text: 'En incidencias de no acepta mercancía, si el cliente confirma rechazo o cancelación, proponer rechazar/cancelar en Dropea y no insistir con nuevas confirmaciones.',
      source: `feedback_incident_${item.orderId}`,
      createdAt: new Date().toISOString()
    };
  }
  if (item.verdict === 'send_absent_template' || type === 'absent') {
    return {
      id: `lesson_incident_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'incident_absent_followup',
      scope: 'incidents',
      orderId: item.orderId,
      incidenceId: item.incidenceId,
      issueType: item.issueType,
      text: 'En incidencias por ausente, si no hay respuesta del cliente, proponer coordinar nueva entrega por Chatby; si responde, extraer fecha/franja/teléfono y resolver en Dropea.',
      source: `feedback_incident_${item.orderId}`,
      createdAt: new Date().toISOString()
    };
  }
  if (item.verdict === 'customer_response_resolves_issue') {
    return {
      id: `lesson_incident_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'incident_customer_response_resolves',
      scope: 'incidents',
      orderId: item.orderId,
      incidenceId: item.incidenceId,
      issueType: item.issueType,
      text: 'En incidencias, cuando el cliente responde con una instrucción accionable o confirma cómo resolver, marcar como incidencia accionable y proponer resolución concreta en Dropea.',
      source: `feedback_incident_${item.orderId}`,
      createdAt: new Date().toISOString()
    };
  }
  if (item.verdict === 'wait_more_context') {
    return {
      id: `lesson_incident_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'incident_wait_more_context',
      scope: 'incidents',
      orderId: item.orderId,
      incidenceId: item.incidenceId,
      issueType: item.issueType,
      text: 'En incidencias con respuesta ambigua o incompleta, no resolver automáticamente: pedir el dato exacto que falta o esperar más contexto antes de actuar en Dropea.',
      source: `feedback_incident_${item.orderId}`,
      createdAt: new Date().toISOString()
    };
  }
  if (item.correction || item.note) {
    return {
      id: `lesson_incident_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'incident_feedback_rule',
      scope: 'incidents',
      orderId: item.orderId,
      incidenceId: item.incidenceId,
      issueType: item.issueType,
      text: [item.correction, item.note].filter(Boolean).join(' | '),
      source: `feedback_incident_${item.orderId}`,
      createdAt: new Date().toISOString()
    };
  }
  return null;
}

export async function buildDashboard({ health = null, forceMeta = false } = {}) {
  const legacySheetsForDashboard = process.env.DASHBOARD_ENABLE_LEGACY_SHEETS === 'true';
  const localOrdersRaw = listOrders({ storeId: config.defaultStore.id });
  const localState = loadState();
  const feedback = await readJson(path.join(dashboardDataDir, 'agent-feedback.json'), []);
  const incidentFeedback = await readJson(path.join(dashboardDataDir, 'incident-feedback.json'), []);
  const financeSettings = await loadFinanceSettings();
  const agentChat = await readJson(path.join(dashboardDataDir, 'agent-chat.json'), []);
  const localAgentMemory = await readJson(path.join(dashboardDataDir, 'agent-memory.json'), []);
  const businessManagerRequests = await readJson(path.join(dashboardDataDir, 'business-manager-requests.json'), []);
  const incidents = mergeIncidentFeedback(loadIncidentsCache(), incidentFeedback, localAgentMemory);
  const operationalOrders = loadOperationalOrdersCache();
  let sheetAgentMemory = [];
  if (legacySheetsForDashboard && (config.googleSheetsEnabled || config.googleSheetsLegacyReadEnabled)) try {
    sheetAgentMemory = await getAgentMemoryRules();
  } catch {
    sheetAgentMemory = [];
  }
  const agentMemory = uniqueLessons(systemAgentMemoryRules(), sheetAgentMemory, localAgentMemory);

  const sheetOrders = [];
  const localOrders = localOrdersRaw.map(orderFromLocal);
  let decisions = [];
  let controlDecisions = [];
  let legacyDecisionSource = { name: 'Google Sheets - aprendizaje historico', ok: false, disabled: true, error: null };
  if (legacySheetsForDashboard && (config.googleSheetsLegacyReadEnabled || config.googleSheetsEnabled)) {
    const decisiones = await readSheet('Decisiones Agente');
    const controlSimulacion = await readSheet('Control Simulacion');
    decisions = rowObjects(decisiones.rows).map(decisionFromSheet);
    controlDecisions = rowObjects(controlSimulacion.rows).map(controlDecisionFromSheet).filter((item) => item.orderId && item.decision);
    legacyDecisionSource = {
      name: 'Google Sheets - aprendizaje historico',
      ok: decisiones.ok || controlSimulacion.ok,
      rows: (decisiones.rows?.length || 0) + (controlSimulacion.rows?.length || 0),
      disabled: false,
      error: decisiones.error || controlSimulacion.error || null
    };
  }
  const cachedOperationalOrders = Array.isArray(operationalOrders.orders) ? operationalOrders.orders : [];
  const liveDropea = {
    source: {
      name: 'Dropea + Chatby - cache operativo rapido',
      ok: Boolean(operationalOrders.ok),
      cached: true,
      rows: cachedOperationalOrders.length,
      generatedAt: operationalOrders.updatedAt,
      intervalMinutes: operationalOrders.intervalMinutes,
      error: operationalOrders.error || null
    },
    orders: cachedOperationalOrders
  };
  const liveShopify = {
    source: { name: 'Shopify API - omitido en vista rapida', ok: true, disabled: true, rows: 0, error: null },
    orders: []
  };
  const liveMeta = await loadLiveMetaCampaigns({ force: forceMeta });
  const operationalDropeaIds = new Set(liveDropea.orders.map((order) => String(order.orderId)));
  const mergedOrders = mergeOrders(sheetOrders, localOrders, liveDropea.orders, decisions, controlDecisions, feedback)
    .filter((order) => operationalDropeaIds.has(String(order.orderId)));
  const liveChatby = {
    orders: mergedOrders,
    source: {
      name: 'Chatby API - omitido en vista rapida',
      ok: true,
      disabled: true,
      checked: 0,
      patched: 0,
      error: null
    }
  };
  const orders = mergedOrders
    .map(enrichOrderForAgent);
  const confirmed = orders.filter(isRecognizedSale);
  const cancelled = orders.filter(isCancelled);
  const manualReview = orders.filter(isManualReview);
  const pending = orders.filter((order) => normalize(order.status).includes('pending'));
  const metaRows = [];
  const campaignRows = liveMeta.campaigns;
  const campaignAnalytics = buildCampaignAnalytics(campaignRows);
  const finance = calculateFinance({
    orders,
    campaignRows,
    metaRows: liveMeta.campaigns.length ? [] : metaRows,
    financeSettings
  });
  const products = buildProducts(orders, campaignAnalytics);
  const businessManager = buildBusinessManager({
    campaignAnalytics,
    finance,
    orders,
    lastRequestedAt: latest(businessManagerRequests, 'createdAt', 1)[0]?.createdAt || null
  });
  const sources = [
    { name: 'Google Sheets - plantilla historica', ok: true, disabled: true, error: null },
    legacyDecisionSource,
    liveDropea.source,
    liveShopify.source,
    liveChatby.source,
    liveMeta.source,
    { name: 'Render - AutoConfirm', ok: Boolean(health), error: null }
  ];
  const connectionVault = await buildConnectionVault({ sources });

  return {
    generatedAt: new Date().toISOString(),
    sources,
    connectionVault,
    system: { render: health, localState, store: config.defaultStore },
    kpis: {
      orders: orders.length,
      confirmed: confirmed.length,
      pending: pending.length,
      manualReview: manualReview.length,
      cancelled: cancelled.length,
      revenue: finance.revenue,
      spend: finance.metaSpend,
      estimatedProfit: finance.businessProfit,
      confirmRate: orders.length ? confirmed.length / orders.length : null
    },
    finance,
    orders: sortOrdersRecentFirst(orders),
    decisions: latest(decisions, 'date', 40),
    feedback: latest(feedback, 'createdAt', 40),
    incidentFeedback: latest(incidentFeedback, 'createdAt', 40),
    learning: {
      feedbackCount: feedback.length + incidentFeedback.length,
      memoryCount: agentMemory.length,
      controlSheet: 'desactivado',
      mode: 'El feedback por pedido y la memoria general se guardan dentro del Command Center. Google Sheets ya no es fuente operativa.',
      lastFeedbackAt: latest(feedback, 'createdAt', 1)[0]?.createdAt || null
    },
    agentChat: latest(agentChat, 'createdAt', 30).reverse(),
    agentMemory: latest(agentMemory, 'createdAt', 40),
    campaigns: campaignAnalytics.campaigns.slice(0, 50),
    campaignProducts: campaignAnalytics.products,
    campaignDays: campaignAnalytics.days,
    meta: {
      period: liveMeta.source.period || process.env.META_DASHBOARD_DATE_PRESET || 'this_month',
      spendSource: liveMeta.campaigns.length ? (liveMeta.source.cached ? 'Meta API cache rapido' : 'Meta API en vivo') : 'Meta API sin datos disponibles',
      lastError: liveMeta.source.ok ? null : liveMeta.source.error,
      live: Boolean(liveMeta.campaigns.length),
      cached: Boolean(liveMeta.source.cached),
      stale: Boolean(liveMeta.source.stale),
      cacheAgeMinutes: liveMeta.source.cacheAgeMinutes ?? null,
      nextRefreshAt: liveMeta.source.nextRefreshAt || null,
      updatedAt: liveMeta.source.generatedAt || new Date().toISOString(),
      rows: liveMeta.campaigns.length || campaignAnalytics.campaigns.length,
      totals: campaignAnalytics.totals
    },
    shopify: {
      live: Boolean(liveShopify.orders.length),
      rows: liveShopify.orders.length,
      updatedAt: liveShopify.source.generatedAt || new Date().toISOString(),
      lastError: liveShopify.source.ok ? null : liveShopify.source.error
    },
    operationalOrders: {
      updatedAt: operationalOrders.updatedAt,
      intervalMinutes: operationalOrders.intervalMinutes,
      count: operationalOrders.count ?? cachedOperationalOrders.length,
      confirmedByCustomer: operationalOrders.confirmedByCustomer ?? cachedOperationalOrders.filter((order) => order.customerConfirmed).length,
      withCustomerResponse: operationalOrders.withCustomerResponse ?? cachedOperationalOrders.filter((order) => Number(order.customerMessages) > 0).length,
      lastError: operationalOrders.error || null
    },
    products,
    incidents,
    businessManager,
    research: businessManager.productReports.map((item) => ({
      name: item.name,
      score: item.score,
      basis: item.sourceType,
      note: item.why
    }))
  };
}

export async function requestBusinessManagerReport({ note = '' } = {}) {
  const requestPath = path.join(dashboardDataDir, 'business-manager-requests.json');
  const requests = await readJson(requestPath, []);
  const item = {
    id: `bm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    note: String(note || ''),
    createdAt: new Date().toISOString()
  };
  requests.push(item);
  await writeJson(requestPath, requests.slice(-100));
  return item;
}

export async function saveAgentFeedback({ orderId, verdict = 'manual_review', correction = '', note = '' }) {
  if (!orderId) throw new Error('orderId_required');
  const feedbackPath = path.join(dashboardDataDir, 'agent-feedback.json');
  const memoryPath = path.join(dashboardDataDir, 'agent-memory.json');
  const feedback = await readJson(feedbackPath, []);
  const memory = await readJson(memoryPath, []);
  const item = {
    id: `fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    orderId: String(orderId),
    verdict: String(verdict),
    correction: String(correction || ''),
    note: String(note || ''),
    createdAt: new Date().toISOString()
  };
  feedback.push(item);
  await writeJson(feedbackPath, feedback);
  await syncAgentFeedbackToSupabase(item, 'order').catch((error) => {
    console.error('Supabase agent feedback mirror error:', error instanceof Error ? error.message : String(error));
  });
  const lesson = learnedRuleFromFeedback(item);
  if (lesson && !memory.some((existing) => normalize(existing.text) === normalize(lesson.text))) {
    memory.push(lesson);
    await writeJson(memoryPath, memory);
    await syncAgentMemoryRuleToSupabase(lesson).catch((error) => {
      console.error('Supabase agent memory mirror error:', error instanceof Error ? error.message : String(error));
    });
    try {
      await appendAgentMemoryRule(lesson);
    } catch {
      // Local memory is still available if Google Sheets is temporarily unavailable.
    }
  }
  const decision = item.verdict === 'should_confirm'
    ? 'CONFIRM'
    : ['should_not_confirm', 'address_change', 'rejected_or_cancelled', 'unclear_wait'].includes(item.verdict)
      ? 'NO_CONFIRM'
      : 'MANUAL_REVIEW';
  if (config.googleSheetsEnabled) {
    try {
      await upsertSimulationDecision({
        orderId: item.orderId,
        decision,
        reason: [item.verdict, item.correction, item.note].filter(Boolean).join(' | '),
        source: 'command_center_feedback'
      });
    } catch {
      // The local feedback file remains the source of truth for Command Center learning.
    }
  }
  return { ...item, learnedRule: lesson };
}

export async function saveIncidentFeedback({ orderId, incidenceId = '', issueType = '', verdict = 'manual_review', correction = '', note = '' }) {
  if (!orderId) throw new Error('orderId_required');
  const feedbackPath = path.join(dashboardDataDir, 'incident-feedback.json');
  const memoryPath = path.join(dashboardDataDir, 'agent-memory.json');
  const feedback = await readJson(feedbackPath, []);
  const memory = await readJson(memoryPath, []);
  const item = {
    id: `ifb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    orderId: String(orderId),
    incidenceId: String(incidenceId || ''),
    issueType: String(issueType || ''),
    verdict: String(verdict),
    correction: String(correction || ''),
    note: String(note || ''),
    createdAt: new Date().toISOString()
  };
  feedback.push(item);
  await writeJson(feedbackPath, feedback.slice(-500));
  await syncAgentFeedbackToSupabase(item, 'incident').catch((error) => {
    console.error('Supabase incident feedback mirror error:', error instanceof Error ? error.message : String(error));
  });

  const lesson = learnedRuleFromIncidentFeedback(item);
  if (lesson && !memory.some((existing) => normalize(existing.text) === normalize(lesson.text))) {
    memory.push(lesson);
    await writeJson(memoryPath, memory);
    await syncAgentMemoryRuleToSupabase(lesson).catch((error) => {
      console.error('Supabase incident memory mirror error:', error instanceof Error ? error.message : String(error));
    });
    try {
      await appendAgentMemoryRule(lesson);
    } catch {
      // La memoria local del Command Center sigue siendo la fuente operativa.
    }
  }

  return { ...item, learnedRule: lesson };
}

export async function saveFinanceSettings({ dropeaProfit, note = '' }) {
  const parsed = numberFrom(dropeaProfit);
  if (parsed === null) throw new Error('dropeaProfit_required');
  const settings = {
    dropeaProfit: parsed,
    dropshipperId: process.env.DROPEA_DROPSHIPPER_ID || '17431',
    source: 'manual_dropea_dashboard',
    updatedAt: new Date().toISOString(),
    note: String(note || 'Beneficio neto indicado por Dropea, ya descontando transporte y stock.').trim()
  };
  await writeJson(path.join(dashboardDataDir, 'finance-settings.json'), settings);
  return settings;
}

export async function saveAgentChat(message, health) {
  if (!String(message || '').trim()) throw new Error('message_required');
  const chatPath = path.join(dashboardDataDir, 'agent-chat.json');
  const memoryPath = path.join(dashboardDataDir, 'agent-memory.json');
  const chat = await readJson(chatPath, []);
  const memory = await readJson(memoryPath, []);
  const dashboard = await buildDashboard({ health });
  const userMessage = { id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, role: 'user', text: String(message).trim(), createdAt: new Date().toISOString() };
  const { reply: fallbackReply, lesson } = buildAgentReply({ message, dashboard });
  let reply = fallbackReply;
  let aiError = null;
  try {
    reply = await chatWithOperationsAgent({ message, dashboard, memory }) || fallbackReply;
  } catch (error) {
    aiError = error instanceof Error ? error.message : String(error);
  }
  const agentMessage = {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    role: 'agent',
    text: aiError ? `${reply}\n\nNota tecnica: no he podido usar IA avanzada ahora mismo (${aiError}). He aplicado respuesta segura basada en reglas.` : reply,
    createdAt: new Date().toISOString()
  };
  chat.push(userMessage, agentMessage);
  await writeJson(chatPath, chat);
  await Promise.allSettled([
    syncAgentChatToSupabase(userMessage),
    syncAgentChatToSupabase(agentMessage)
  ]);
  if (lesson) {
    memory.push(lesson);
    await writeJson(memoryPath, memory);
    await syncAgentMemoryRuleToSupabase(lesson).catch((error) => {
      console.error('Supabase chat memory mirror error:', error instanceof Error ? error.message : String(error));
    });
    try {
      await appendAgentMemoryRule(lesson);
    } catch {
      // Keep the chat responsive even if the persistent memory sheet fails.
    }
  }
  return { reply: agentMessage, lesson };
}
