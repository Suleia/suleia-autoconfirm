import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAppConfig } from './config.mjs';
import { listOrders, loadState } from './storage.mjs';
import { getDropeaOrderById, listPendingDropeaOrders, listRecentDropeaOrders } from './clients/dropea.mjs';
import { findSubscriberForOrder, getChatMessages, subscriberConfirmsOrder } from './clients/chatby.mjs';
import { getCampaignInsights } from './clients/meta.mjs';
import { listRecentShopifyOrders } from './clients/shopify.mjs';
import { chatWithOperationsAgent } from './clients/openai.mjs';
import { appendAgentMemoryRule, getAgentMemoryRules, getSheetRows, upsertSimulationDecision } from './clients/sheets.mjs';

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
  const text = normalize([
    order.status,
    order.agentIntent,
    order.agentAction,
    order.agentReason,
    order.note,
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
      detail: 'Hay senal de confirmacion por boton, texto o feedback validado.',
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

  return {
    code: 'unclear',
    label: 'Sin senal suficiente',
    detail: 'Todavia no hay una respuesta clara del cliente.',
    confidence: Number(order.agentConfidence) || 0,
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
      confidence: Number(order.agentConfidence) || 60
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

function enrichOrderForAgent(order) {
  const signal = agentCustomerSignal(order);
  const recommendation = agentRecommendation(order);
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
    agentUsefulConfidence: recommendation.confidence
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

async function loadLiveMetaCampaigns() {
  const generatedAt = new Date().toISOString();
  const source = { name: 'Meta API - campanas en vivo', ok: true, error: null, generatedAt };
  try {
    const datePreset = process.env.META_DASHBOARD_DATE_PRESET || 'this_month';
    const insights = await getCampaignInsights({ datePreset, level: 'ad', limit: 500, timeIncrement: 1 });
    return {
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
  } catch (error) {
    source.ok = false;
    source.error = error instanceof Error ? error.message : String(error);
    return { source, campaigns: [] };
  }
}

function buildProducts(orders) {
  const products = new Map([
    ['NIDA premium', { name: 'NIDA premium', price: 34.99, cost: 12.5, status: 'Activo', orders: 0, revenue: 0 }],
    ['Collagum', { name: 'Collagum', price: 24.99, cost: 8.5, status: 'Test', orders: 0, revenue: 0 }]
  ]);
  for (const order of orders) {
    const name = order.product || 'Producto';
    const product = products.get(name) || { name, price: order.amount || 0, cost: 0, status: 'Detectado', orders: 0, revenue: 0 };
    product.orders += 1;
    product.revenue += Number(order.amount) || 0;
    products.set(name, product);
  }
  return [...products.values()].map((product) => ({
    ...product,
    margin: product.price ? Math.round(((product.price - product.cost) / product.price) * 100) : null
  }));
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

export async function buildDashboard({ health = null } = {}) {
  const localOrdersRaw = listOrders({ storeId: config.defaultStore.id });
  const localState = loadState();
  const feedback = await readJson(path.join(dashboardDataDir, 'agent-feedback.json'), []);
  const financeSettings = await loadFinanceSettings();
  const agentChat = await readJson(path.join(dashboardDataDir, 'agent-chat.json'), []);
  const localAgentMemory = await readJson(path.join(dashboardDataDir, 'agent-memory.json'), []);
  let sheetAgentMemory = [];
  if (config.googleSheetsEnabled || config.googleSheetsLegacyReadEnabled) try {
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
  if (config.googleSheetsLegacyReadEnabled || config.googleSheetsEnabled) {
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
  const knownOrderIds = [...sheetOrders, ...localOrders].map((order) => order.orderId);
  const liveDropea = await loadLiveDropeaOrders(knownOrderIds);
  const liveShopify = await loadLiveShopifyOrders();
  const liveMeta = await loadLiveMetaCampaigns();
  const mergedOrders = mergeOrders(sheetOrders, localOrders, [...liveDropea.orders, ...liveShopify.orders], decisions, controlDecisions, feedback);
  const liveChatby = await applyLiveChatbySignals(mergedOrders);
  const orders = liveChatby.orders
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
    learning: {
      feedbackCount: feedback.length,
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
      spendSource: liveMeta.campaigns.length ? 'Meta API en vivo' : 'Meta API sin datos disponibles',
      lastError: liveMeta.source.ok ? null : liveMeta.source.error,
      live: Boolean(liveMeta.campaigns.length),
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
    products: buildProducts(orders),
    research: [
      { name: 'Kit sonrisa premium', score: 91, basis: 'Hipotesis manual', note: 'Complementa Collagum y permite packs de mayor ticket.' },
      { name: 'Serum efecto lifting', score: 86, basis: 'Hipotesis manual', note: 'Buen angulo visual para anuncios y landing directa.' },
      { name: 'Parches drenantes', score: 74, basis: 'Hipotesis manual', note: 'Requiere validar proveedor, devoluciones y margen real.' }
    ]
  };
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
  const lesson = learnedRuleFromFeedback(item);
  if (lesson && !memory.some((existing) => normalize(existing.text) === normalize(lesson.text))) {
    memory.push(lesson);
    await writeJson(memoryPath, memory);
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
  if (lesson) {
    memory.push(lesson);
    await writeJson(memoryPath, memory);
    try {
      await appendAgentMemoryRule(lesson);
    } catch {
      // Keep the chat responsive even if the persistent memory sheet fails.
    }
  }
  return { reply: agentMessage, lesson };
}
