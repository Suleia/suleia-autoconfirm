import path from 'node:path';
import { getAppConfig } from '../config.mjs';
import { ensureDir, readJson, writeJson } from '../lib/files.mjs';
import { insertRows, isSupabaseEnabled, selectRows, supabaseStatus, upsertRows } from '../clients/supabase.mjs';

const config = getAppConfig();

function nowIso() {
  return new Date().toISOString();
}

function cleanText(value, max = 1000) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max - 1) : text;
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function boolOrNull(value) {
  if (value === true || value === false) return value;
  if (value === undefined || value === null || value === '') return null;
  return Boolean(value);
}

function isoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function bestId(prefix = 'row') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function safeJson(value) {
  if (value === undefined) return null;
  return value;
}

function logSupabaseMirrorError(scope, error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Supabase mirror error (${scope}):`, message);
}

export function getSupabaseMirrorStatus() {
  return supabaseStatus();
}

export async function testSupabaseConnection() {
  const status = supabaseStatus();
  if (!status.configured) return { ok: false, ...status };
  try {
    await selectRows('app_state', { query: { select: 'key', limit: 1 }, limit: 1 });
    return { ok: true, ...status };
  } catch (error) {
    return { ok: false, ...status, error: error instanceof Error ? error.message : String(error) };
  }
}

function orderRow(order = {}) {
  const raw = order.raw || {};
  const createdAtSource = order.createdAtSource
    || order.created_at
    || order.createdAt
    || raw.created_at
    || raw.createdAt
    || raw.date
    || null;
  return {
    order_id: String(order.orderId || order.id || raw.id || raw.order_id || '').trim(),
    store_id: String(order.storeId || config.defaultStore.id || 'suleia'),
    status: cleanText(order.status || raw.status || raw.order_status || ''),
    customer_name: cleanText(order.customerName || order.customer || raw.customer?.full_name || raw.customer?.name || '', 250),
    customer_phone: cleanText(order.customerPhone || order.phone || raw.customer?.phone || '', 80),
    customer_email: cleanText(order.customerEmail || raw.customer?.email || '', 250),
    order_amount: numberOrNull(order.orderAmount ?? order.amount ?? raw.total ?? raw.total_price),
    currency_code: cleanText(order.currencyCode || raw.currency || 'EUR', 20),
    product: cleanText(order.product || raw.product || raw.product_name || '', 300),
    chatby_user_ns: cleanText(order.chatbyUserNs || raw.chatby_user_ns || '', 120),
    agent_intent: cleanText(order.aiIntent || order.agentIntent || '', 120),
    agent_confidence: numberOrNull(order.aiConfidence ?? order.agentConfidence),
    confirmation_source: cleanText(order.confirmationSource || '', 120),
    confirmed_at: isoOrNull(order.confirmedAt),
    cancelled_at: isoOrNull(order.cancelledAt),
    created_at_source: isoOrNull(createdAtSource),
    raw: safeJson(order),
    updated_at: nowIso()
  };
}

export async function syncOrderToSupabase(order) {
  if (!isSupabaseEnabled()) return { skipped: true };
  const row = orderRow(order);
  if (!row.order_id) return { skipped: true, reason: 'missing_order_id' };
  return upsertRows('orders', row, { onConflict: 'order_id' });
}

export async function syncOrdersToSupabase(orders = []) {
  if (!isSupabaseEnabled()) return { skipped: true };
  const rows = (Array.isArray(orders) ? orders : [])
    .map(orderRow)
    .filter((row) => row.order_id);
  if (!rows.length) return { skipped: true, reason: 'no_orders' };
  return upsertRows('orders', rows, { onConflict: 'order_id' });
}

export async function syncAppStateToSupabase(state = {}) {
  if (!isSupabaseEnabled()) return { skipped: true };
  return upsertRows('app_state', {
    key: 'runtime_state',
    value: safeJson(state),
    updated_at: nowIso()
  }, { onConflict: 'key' });
}

export async function appendWebhookEventToSupabase(event = {}) {
  if (!isSupabaseEnabled()) return { skipped: true };
  return insertRows('webhook_events', {
    id: event.id || bestId('evt'),
    source: cleanText(event.source || event.storeId || 'webhook', 120),
    event_id: cleanText(event.dedupeKey || event.eventId || event.id || '', 250),
    payload: safeJson(event),
    created_at: isoOrNull(event.createdAt) || nowIso()
  });
}

function deliveryKey({ storeId = 'suleia', orderId, templateName }) {
  const normalizedTemplate = String(templateName || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${String(storeId || 'suleia')}|${String(orderId || '')}|${normalizedTemplate}`;
}

export async function claimTemplateDelivery({
  storeId = 'suleia',
  orderId,
  customerPhone = '',
  templateName,
  provider = '',
  chatbyUserNs = ''
} = {}) {
  if (!isSupabaseEnabled()) return { acquired: true, persistent: false, reason: 'supabase_not_configured' };
  const templateKey = deliveryKey({ storeId, orderId, templateName });
  const row = {
    template_key: templateKey,
    store_id: String(storeId || 'suleia'),
    order_id: String(orderId || ''),
    customer_phone: cleanText(customerPhone, 80),
    template_name: cleanText(templateName, 250),
    provider: cleanText(provider, 80),
    chatby_user_ns: cleanText(chatbyUserNs, 120),
    status: 'claimed',
    attempted_at: nowIso(),
    updated_at: nowIso()
  };

  try {
    const inserted = await insertRows('template_delivery_ledger', row, { returning: 'representation' });
    return { acquired: true, persistent: true, templateKey, row: Array.isArray(inserted) ? inserted[0] : inserted };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/409|23505|duplicate key|unique constraint/i.test(message)) {
      const existing = await selectRows('template_delivery_ledger', {
        query: { template_key: `eq.${templateKey}`, limit: 1 },
        limit: 1
      });
      return { acquired: false, persistent: true, templateKey, existing: existing[0] || null, reason: 'already_claimed' };
    }
    throw error;
  }
}

export async function finishTemplateDelivery({
  storeId = 'suleia',
  orderId,
  customerPhone = '',
  templateName,
  provider = '',
  chatbyUserNs = '',
  status,
  attemptedAt,
  sentAt = null,
  lastError = null,
  raw = null
} = {}) {
  if (!isSupabaseEnabled()) return { skipped: true, reason: 'supabase_not_configured' };
  const templateKey = deliveryKey({ storeId, orderId, templateName });
  return upsertRows('template_delivery_ledger', {
    template_key: templateKey,
    store_id: String(storeId || 'suleia'),
    order_id: String(orderId || ''),
    customer_phone: cleanText(customerPhone, 80),
    template_name: cleanText(templateName, 250),
    provider: cleanText(provider, 80),
    chatby_user_ns: cleanText(chatbyUserNs, 120),
    status: cleanText(status || 'attempted', 80),
    attempted_at: isoOrNull(attemptedAt) || nowIso(),
    sent_at: isoOrNull(sentAt),
    last_error: cleanText(lastError || '', 1400) || null,
    raw: safeJson(raw),
    updated_at: nowIso()
  }, { onConflict: 'template_key' });
}

function operationalOrderRow(order = {}) {
  return {
    order_id: String(order.orderId || '').trim(),
    customer_name: cleanText(order.customer || order.customerName || '', 250),
    customer_phone: cleanText(order.phone || order.customerPhone || '', 80),
    created_at_source: isoOrNull(order.createdAt),
    dropea_status: cleanText(order.dropeaStatus || order.status || '', 120),
    customer_confirmed: boolOrNull(order.customerConfirmed),
    customer_messages: numberOrNull(order.customerMessages) || 0,
    customer_action_label: cleanText(order.customerActionLabel || '', 250),
    agent_action: cleanText(order.agentAction || '', 120),
    agent_intent: cleanText(order.agentIntent || '', 120),
    agent_confidence: numberOrNull(order.agentConfidence),
    raw: safeJson(order),
    updated_at: nowIso()
  };
}

export async function syncOperationalOrdersCacheToSupabase(payload = {}) {
  if (!isSupabaseEnabled()) return { skipped: true };
  const rows = (Array.isArray(payload.orders) ? payload.orders : [])
    .map(operationalOrderRow)
    .filter((row) => row.order_id);
  const appState = upsertRows('app_state', {
    key: 'operational_orders_cache',
    value: safeJson(payload),
    updated_at: nowIso()
  }, { onConflict: 'key' });
  if (!rows.length) return appState;
  await appState;
  return upsertRows('operational_orders', rows, { onConflict: 'order_id' });
}

function incidentRow(incident = {}) {
  return {
    incidence_id: String(incident.incidenceId || `${incident.orderId || 'order'}_${incident.reasonCode || incident.reason || 'incident'}`).trim(),
    order_id: String(incident.orderId || '').trim(),
    issue_type: cleanText(incident.incidentTypeLabel || incident.reason || incident.issueType || '', 250),
    issue_code: cleanText(incident.reasonCode || incident.rawReason || '', 80),
    status: cleanText(incident.issueStatus || '', 120),
    order_status: cleanText(incident.orderStatus || '', 120),
    customer_name: cleanText(incident.customerName || '', 250),
    customer_phone: cleanText(incident.phone || '', 80),
    created_at_source: isoOrNull(incident.incidenceDate),
    last_response_at: isoOrNull(incident.lastCustomerAt),
    customer_responded: boolOrNull(incident.customerResponded),
    customer_messages: numberOrNull(incident.customerMessages) || 0,
    context_summary: cleanText(incident.chatbySummary || incident.customerSignalDetail || '', 1200),
    proposed_solution: cleanText(incident.proposedSolution || incident.recommendedNextStep || '', 1400),
    operational_instruction: cleanText(incident.operationalInstruction || '', 1400),
    confidence: numberOrNull(incident.contextConfidence),
    priority: cleanText(incident.priority || '', 80),
    chatby_user_ns: cleanText(incident.chatbyUserNs || '', 120),
    carrier_reason: cleanText(incident.carrierReason || '', 300),
    carrier_reason_code: cleanText(incident.carrierReasonCode || '', 120),
    carrier_annotated_at: isoOrNull(incident.carrierAnnotatedAt),
    carrier_observation: cleanText(incident.carrierObservation || '', 2000),
    carrier_last_updated_at: isoOrNull(incident.carrierLastUpdatedAt),
    carrier_incidence_id: cleanText(incident.carrierIncidenceId || '', 120),
    carrier_source: cleanText(incident.transportLogSource || '', 250),
    raw: safeJson(incident),
    updated_at: nowIso()
  };
}

function incidentHistoryRows(incident = {}) {
  const orderId = String(incident.orderId || '').trim();
  return (Array.isArray(incident.carrierIncidentHistory) ? incident.carrierIncidentHistory : [])
    .map((entry, index) => ({
      history_id: `${orderId}|${entry.incidenceId || index}|${entry.annotatedAt || 'unknown'}`,
      order_id: orderId,
      incidence_id: cleanText(entry.incidenceId || '', 120),
      reason_code: cleanText(entry.reasonCode || '', 120),
      reason: cleanText(entry.reason || '', 300),
      annotated_at: isoOrNull(entry.annotatedAt),
      observation: cleanText(entry.observation || '', 2000),
      resolved: boolOrNull(entry.resolved),
      last_updated_at: isoOrNull(entry.lastUpdatedAt),
      raw: safeJson(entry),
      synced_at: nowIso()
    }))
    .filter((row) => row.order_id && (row.incidence_id || row.reason));
}

export async function syncIncidentsCacheToSupabase(payload = {}) {
  if (!isSupabaseEnabled()) return { skipped: true };
  const rows = (Array.isArray(payload.incidents) ? payload.incidents : [])
    .map(incidentRow)
    .filter((row) => row.incidence_id && row.order_id);
  const historyRows = (Array.isArray(payload.incidents) ? payload.incidents : [])
    .flatMap(incidentHistoryRows);
  const appState = upsertRows('app_state', {
    key: 'incidents_cache',
    value: safeJson(payload),
    updated_at: nowIso()
  }, { onConflict: 'key' });
  if (!rows.length) return appState;
  await appState;
  let enhancedSchema = true;
  try {
    await upsertRows('incidents', rows, { onConflict: 'incidence_id' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/carrier_|schema cache|column|PGRST204/i.test(message)) throw error;
    enhancedSchema = false;
    const legacyRows = rows.map((row) => {
      const {
        carrier_reason,
        carrier_reason_code,
        carrier_annotated_at,
        carrier_observation,
        carrier_last_updated_at,
        carrier_incidence_id,
        carrier_source,
        ...legacy
      } = row;
      return legacy;
    });
    await upsertRows('incidents', legacyRows, { onConflict: 'incidence_id' });
  }
  if (historyRows.length) {
    try {
      await upsertRows('incident_carrier_history', historyRows, { onConflict: 'history_id' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/incident_carrier_history|schema cache|relation|PGRST/i.test(message)) throw error;
      enhancedSchema = false;
    }
  }
  return { ok: true, incidents: rows.length, carrierHistory: enhancedSchema ? historyRows.length : 0, enhancedSchema };
}

export async function syncAgentFeedbackToSupabase(item = {}, scope = 'order') {
  if (!isSupabaseEnabled()) return { skipped: true };
  return upsertRows('agent_feedback', {
    id: item.id || bestId('fb'),
    scope,
    entity_id: cleanText(item.orderId || item.incidenceId || item.entityId || '', 120),
    order_id: cleanText(item.orderId || '', 120),
    incidence_id: cleanText(item.incidenceId || '', 120),
    verdict: cleanText(item.verdict || '', 120),
    correction: cleanText(item.correction || '', 1400),
    note: cleanText(item.note || '', 1400),
    raw: safeJson(item),
    created_at: isoOrNull(item.createdAt) || nowIso()
  }, { onConflict: 'id' });
}

export async function syncAgentMemoryRuleToSupabase(rule = {}) {
  if (!isSupabaseEnabled()) return { skipped: true };
  return upsertRows('agent_memory_events', {
    id: rule.id || bestId('mem'),
    type: cleanText(rule.type || 'memory_rule', 120),
    source: cleanText(rule.source || '', 250),
    entity_id: cleanText(rule.orderId || rule.incidenceId || '', 120),
    content: cleanText(rule.text || rule.content || rule.note || '', 2000),
    raw: safeJson(rule),
    created_at: isoOrNull(rule.createdAt) || nowIso()
  }, { onConflict: 'id' });
}

const coreAgentMemoryRules = [
  {
    id: 'core_order_post_confirmation_cancel',
    type: 'order_operational_rule',
    source: 'suleia_core_logic',
    content: 'Una confirmacion inicial no prevalece si despues el cliente comunica que no quiere el pedido, quiere cancelarlo, anularlo o que se equivoco. Durante la espera operativa se debe cancelar en Dropea.'
  },
  {
    id: 'core_order_post_confirmation_promotion_change',
    type: 'order_operational_rule',
    source: 'suleia_core_logic',
    content: 'Si despues de confirmar el cliente solicita otra oferta, promocion o pack, se cancela el pedido actual y se le indica que realice una nueva compra mediante la URL del producto correspondiente.'
  },
  {
    id: 'core_incident_agent_training_only',
    type: 'incident_agent_guardrail',
    source: 'suleia_core_logic',
    content: 'El Agente de incidencias puede ejecutar en real solo reglas operativas de alta confianza, con idempotencia, auditoria y verificacion posterior en Dropea. Los casos ambiguos siguen en revision y nunca deben simular una accion.'
  },
  {
    id: 'core_incident_exact_availability_accept',
    type: 'incident_operational_rule',
    source: 'feedback_real_cases_2026_07_16',
    content: 'Si el cliente comunica claramente un dia u horario para recibir el pedido, redactar una solucion fiel y breve, anadir el telefono del cliente, pulsar Aceptar y verificar que la incidencia deja Pendientes de resolver y pasa a Soluciones enviadas.'
  },
  {
    id: 'core_incident_confirmed_delivery_slot_accept',
    type: 'incident_operational_rule',
    source: 'feedback_real_case_1297482',
    content: 'Si el cliente selecciona y confirma una franja de entrega, prevalece la franja indicada. Solicitar una nueva entrega en esa franja, pedir llamada previa al telefono asociado al pedido, pulsar Aceptar y verificar Soluciones enviadas. Nunca devolver al origen porque mantiene intencion clara de recibirlo.'
  },
  {
    id: 'core_incident_pickup_at_depot',
    type: 'incident_operational_rule',
    source: 'feedback_real_case_1299749',
    content: 'Si el historial de incidencias indica que el cliente pasara a recoger en agencia, ejecutar Recoger en agencia sin escribir ni enviar otra solucion.'
  },
  {
    id: 'core_incident_return_after_rejection_72h',
    type: 'incident_operational_rule',
    source: 'feedback_real_case_1291159',
    content: 'Si el transportista registra rechazo por falta de dinero y transcurren mas de 72 horas sin nueva respuesta del cliente, ejecutar Devolver al origen.'
  },
  {
    id: 'core_incident_rejected_goods_template_required',
    type: 'incident_notification_rule',
    source: 'feedback_real_case_1298695',
    content: 'Toda incidencia pendiente de no acepta mercancia debe recibir una unica vez la plantilla aprobada es_ES dropea_incidencia_mercancia_v1, aunque exista otra respuesta o mensaje. Solo se omite si esa misma plantilla ya tiene un envio WhatsApp verificado o una reclamacion idempotente previa.'
  },
  {
    id: 'core_incident_payment_method_delivery',
    type: 'incident_operational_rule',
    source: 'feedback_real_case_1299610',
    content: 'Si el cliente pregunta por pagar con tarjeta o efectivo y mantiene la intencion de compra, tratarlo como incidencia solucionable: solicitar nueva entrega con el metodo indicado, anadir su telefono, aceptar y verificar.'
  },
  {
    id: 'core_incident_discount_rejected_return',
    type: 'incident_operational_rule',
    source: 'feedback_real_case_1296373',
    content: 'Si el cliente rechazo el pedido por precio, se le ofrecio despues el descuento autorizado de 5 EUR y su respuesta posterior rechaza expresamente la oferta o el pedido, ejecutar Devolver al origen. No insistir con nuevas ofertas.'
  },
  {
    id: 'core_incident_discount_accepted_requires_price_update',
    type: 'incident_operational_rule',
    source: 'feedback_real_case_1296373',
    content: 'Si el cliente acepta el descuento autorizado de 5 EUR, mantener el pedido activo, actualizar y verificar el importe de reembolso por el canal habilitado y solo despues gestionar una nueva entrega. No devolver al origen ni afirmar que el precio cambio sin verificarlo.'
  },
  {
    id: 'training_incident_policy_guardrail_20260716',
    type: 'incident_training_guardrail',
    source: 'user_training_policy_2026_07_16',
    executionEnabled: false,
    requiresExplicitActivation: true,
    content: 'SOLO APRENDIZAJE. Estas reglas sirven para analizar, explicar y proponer. No deben enviar plantillas, aceptar soluciones, recoger en agencia ni devolver al origen hasta que el usuario autorice expresamente su activacion operativa.'
  },
  {
    id: 'training_incident_full_context_priority_20260716',
    type: 'incident_training_policy',
    source: 'user_training_policy_2026_07_16',
    executionEnabled: false,
    content: 'Antes de proponer, leer historial completo de incidencias, conversacion completa, ultima respuesta y fecha, telefono, motivo, plantillas previas y estado actual de Dropea. Prioridad ante contradicciones: ultima respuesta explicita del cliente, ultima anotacion valida del transportista, historial reciente, estado actual y por ultimo informacion antigua. No decidir por palabras aisladas.'
  },
  {
    id: 'training_incident_response_and_72h_20260716',
    type: 'incident_training_policy',
    source: 'user_training_policy_2026_07_16',
    executionEnabled: false,
    content: 'Distinguir de forma visible si el cliente respondio, que dijo exactamente, cuando respondio y cuantos dias u horas han pasado desde el ultimo contacto. Sin respuesta durante menos de 72 horas, proponer mantener pendiente. Con 72 horas completas sin respuesta, proponer Devolver al origen y no repetir mensajes indefinidamente. Esta regla queda solo como propuesta hasta activacion expresa.'
  },
  {
    id: 'training_incident_delivery_intent_20260716',
    type: 'incident_training_policy',
    source: 'user_training_policy_2026_07_16',
    executionEnabled: false,
    content: 'Si el cliente mantiene intencion de compra y comunica dia, franja, hora o llamada previa, proponer una nueva entrega adaptada exactamente a su disponibilidad. Formato breve: Realizar nueva entrega [dia o franja]. Llamar antes al [telefono real del pedido]. No inventar fechas, horas, telefonos ni condiciones.'
  },
  {
    id: 'training_incident_absence_pickup_payment_20260716',
    type: 'incident_training_policy',
    source: 'user_training_policy_2026_07_16',
    executionEnabled: false,
    content: 'Si el cliente afirma que estaba en casa y el repartidor no fue, y aporta nueva disponibilidad, proponer nueva entrega y no devolucion. Si el historial confirma recogida en agencia o delegacion, proponer solo Recoger en agencia. Una pregunta sobre pago con tarjeta o efectivo indica interes: proponer nueva entrega con el metodo solicitado salvo rechazo expreso.'
  },
  {
    id: 'training_incident_price_discount_20260716',
    type: 'incident_training_policy',
    source: 'user_training_policy_2026_07_16',
    executionEnabled: false,
    content: 'Ante rechazo por precio, proponer una unica oferta con el descuento comercial autorizado y esperar respuesta. Si acepta, mantener activo, verificar el nuevo importe y proponer nueva entrega. Si rechaza la oferta, proponer Devolver al origen sin insistir. Si no responde, esperar 72 horas desde el ultimo mensaje y despues proponer devolucion.'
  },
  {
    id: 'training_incident_no_money_20260716',
    type: 'incident_training_policy',
    source: 'user_training_policy_2026_07_16',
    executionEnabled: false,
    content: 'Ante rechazo por falta de dinero, comprobar si propone otra fecha. Con fecha concreta y viable, proponer nueva entrega; sin alternativa, aplicar el contacto comercial definido. Si rechaza expresamente o pasan 72 horas sin respuesta, proponer Devolver al origen. Evitar intentos de entrega repetidos sin confirmacion.'
  },
  {
    id: 'training_incident_rejected_goods_template_20260716',
    type: 'incident_training_policy',
    source: 'user_training_policy_2026_07_16',
    executionEnabled: false,
    content: 'En no acepta mercancia o rechazo de entrega, comprobar si ya consta la plantilla es_ES dropea_incidencia_mercancia_v1. Si falta, proponer su envio una sola vez antes del flujo de recuperacion o devolucion. Si ya existe un envio verificado, no duplicarlo. Esta memoria no autoriza el envio real.'
  },
  {
    id: 'training_incident_definitive_rejection_20260716',
    type: 'incident_training_policy',
    source: 'user_training_policy_2026_07_16',
    executionEnabled: false,
    content: 'Considerar rechazo definitivo si el cliente dice que no quiere el pedido, pide cancelar, rechaza el descuento, mantiene su negativa tras una alternativa razonable o no responde durante 72 horas desde el ultimo intento. Proponer Devolver al origen, no nueva entrega, no mas ofertas y registrar el motivo.'
  },
  {
    id: 'training_incident_solution_verification_20260716',
    type: 'incident_training_policy',
    source: 'user_training_policy_2026_07_16',
    executionEnabled: false,
    content: 'La solucion propuesta debe ser breve y ejecutable: accion, disponibilidad, pago si aplica, llamada previa y telefono real. No incluir explicaciones internas ni datos no confirmados. Una futura accion solo se considerara completada tras verificar que Dropea cambia a Soluciones enviadas; si no cambia, registrar error y evitar reintentos ciegos.'
  },
  {
    id: 'training_incident_idempotency_20260716',
    type: 'incident_training_policy',
    source: 'user_training_policy_2026_07_16',
    executionEnabled: false,
    content: 'Antes de proponer o, en el futuro, ejecutar, comprobar el historial. No duplicar plantillas, descuentos, nuevas entregas ni botones. No devolver tras confirmar una nueva entrega ni pedir entrega si ya hay recogida en agencia. Cada incidencia debe tener una unica accion coherente con su estado mas reciente.'
  },
  {
    id: 'training_incident_panel_feedback_20260716',
    type: 'incident_training_policy',
    source: 'user_training_policy_2026_07_16',
    executionEnabled: false,
    content: 'El panel debe usar el conjunto completo de pendientes de resolver, sin omisiones por paginacion o filtros, y ordenar por ID INCID descendente. Guardar por caso: contexto, intencion, regla propuesta, texto, plantilla, estados anterior y posterior, resultado y correccion del usuario. Generalizar el feedback por situacion, no memorizar solo el pedido.'
  },
  {
    id: 'training_incident_absent_new_availability_20260717',
    type: 'incident_training_policy',
    source: 'user_training_rules_2026_07_17',
    executionEnabled: false,
    exampleOrderIds: ['1300491'],
    content: 'En una incidencia AUSENTE, revisar siempre la conversacion posterior. Si el cliente facilita una nueva fecha, dia, hora o franja, esa respuesta prevalece sobre la anotacion AUSENTE y confirma que mantiene intencion de compra. Proponer: Realizar nueva entrega [disponibilidad exacta]. Llamar antes al [telefono real del pedido]. En una futura ejecucion autorizada, introducir la solucion, pulsar Aceptar y verificar Soluciones enviadas. Ejemplo aprendido 1300491: lunes por la tarde, telefono 654007160. Esta regla no autoriza ninguna accion real.'
  },
  {
    id: 'training_incident_wrong_address_workflow_20260717',
    type: 'incident_training_policy',
    source: 'user_training_rules_2026_07_17',
    executionEnabled: false,
    exampleOrderIds: ['1300310'],
    content: 'Si la direccion es incorrecta, incompleta, inexistente o impide la entrega, comprobar primero si consta un envio verificado de es_ES dropea_incidencia_direccion_v1. Si no consta, proponer enviarla una sola vez y pasar internamente a Esperando respuesta del cliente. No proponer nueva entrega ni devolucion antes de recibir datos validos o de cumplir 72 horas completas desde el envio verificado. Si responde con los datos necesarios, validar y actualizar la direccion si el sistema lo permite, proponer nueva entrega, y en una futura ejecucion autorizada aceptar y verificar Soluciones enviadas. Si no responde tras 72 horas completas, proponer Devolver al origen. Ejemplo aprendido 1300310. Esta memoria no autoriza el envio ni la devolucion real.'
  },
  {
    id: 'training_incident_absent_address_decision_tree_20260717',
    type: 'incident_training_policy',
    source: 'user_training_rules_2026_07_17',
    executionEnabled: false,
    content: 'Arbol de decision aprendido. AUSENTE sin respuesta: menos de 72 horas, esperar; 72 horas completas o mas, proponer Devolver al origen. AUSENTE con nueva disponibilidad: proponer nueva entrega exacta con llamada previa y telefono real. DIRECCION INCORRECTA: enviar o proponer una sola vez la plantilla de direccion si no existe envio verificado; si ya existe, no duplicar y esperar. Con direccion correcta aportada, validar, actualizar y proponer nueva entrega. Sin respuesta durante 72 horas completas desde la plantilla, proponer devolucion. La ultima respuesta explicita del cliente prevalece sobre anotaciones anteriores del transportista.'
  }
];

export async function ensureCoreAgentMemory() {
  if (!isSupabaseEnabled()) return { skipped: true };
  const createdAt = nowIso();
  const rows = coreAgentMemoryRules.map((rule) => ({
    id: rule.id,
    type: rule.type,
    source: rule.source,
    entity_id: '',
    content: rule.content,
    raw: rule,
    created_at: createdAt
  }));
  await upsertRows('agent_memory_events', rows, { onConflict: 'id' });
  return { ok: true, count: rows.length };
}

export async function syncAgentChatToSupabase(message = {}) {
  if (!isSupabaseEnabled()) return { skipped: true };
  return insertRows('agent_memory_events', {
    id: message.id || bestId('chat'),
    type: 'agent_chat',
    source: cleanText(message.role || 'agent', 120),
    entity_id: '',
    content: cleanText(message.text || '', 3000),
    raw: safeJson(message),
    created_at: isoOrNull(message.createdAt) || nowIso()
  });
}

export async function syncTelegramLogToSupabase(item = {}) {
  if (!isSupabaseEnabled()) return { skipped: true };
  return insertRows('telegram_messages', {
    id: item.id || bestId('tg'),
    chat_id: cleanText(item.chatId || '', 120),
    username: cleanText(item.username || '', 120),
    direction: cleanText(item.direction || 'inbound_outbound', 80),
    text: cleanText(item.text || '', 3000),
    reply: cleanText(item.reply || '', 3000),
    authorized: boolOrNull(item.authorized),
    raw: safeJson(item),
    created_at: isoOrNull(item.createdAt) || nowIso()
  });
}

function metaInsightRow(insight = {}, campaign = {}) {
  const dateStart = insight.date_start || insight.dateStart || insight.since || null;
  const campaignId = String(insight.campaignId || insight.campaign_id || campaign.id || '').trim();
  const adsetId = String(insight.adsetId || insight.adset_id || '').trim();
  const adId = String(insight.adId || insight.ad_id || '').trim();
  return {
    meta_row_id: [dateStart || 'unknown', campaignId || 'campaign', adsetId || 'adset', adId || 'ad'].join('|'),
    date_start: dateStart,
    date_stop: insight.date_stop || insight.dateStop || insight.until || dateStart,
    campaign_id: campaignId,
    campaign_name: cleanText(insight.campaignName || insight.campaign_name || campaign.name || '', 300),
    adset_id: adsetId || null,
    ad_id: adId || null,
    spend: numberOrNull(insight.spend),
    impressions: numberOrNull(insight.impressions),
    clicks: numberOrNull(insight.clicks),
    purchases: numberOrNull(insight.purchases),
    purchase_value: numberOrNull(insight.purchaseValue ?? insight.purchase_value),
    roas: numberOrNull(insight.roas),
    cpa: numberOrNull(insight.costPerPurchase ?? insight.cpa),
    raw: safeJson({ insight, campaign }),
    updated_at: nowIso()
  };
}

export async function syncMetaInsightsToSupabase({ insights = [], campaigns = [], account = null } = {}) {
  if (!isSupabaseEnabled()) return { skipped: true };
  const campaignById = new Map((Array.isArray(campaigns) ? campaigns : []).map((campaign) => [String(campaign.id), campaign]));
  const rows = (Array.isArray(insights) ? insights : [])
    .map((insight) => metaInsightRow(insight, campaignById.get(String(insight.campaignId || insight.campaign_id)) || {}))
    .filter((row) => row.campaign_id || row.campaign_name);
  const appState = upsertRows('app_state', {
    key: 'meta_dashboard_last_sync',
    value: safeJson({ account, insights: rows.length, updatedAt: nowIso() }),
    updated_at: nowIso()
  }, { onConflict: 'key' });
  if (!rows.length) return appState;
  await appState;
  return upsertRows('meta_campaign_insights', rows, { onConflict: 'meta_row_id' });
}

export async function backfillSupabaseFromLocal() {
  if (!isSupabaseEnabled()) return { ok: false, skipped: true, status: supabaseStatus() };
  const dashboardDir = path.join(config.dataDir, 'dashboard');
  const result = {
    ok: true,
    startedAt: nowIso(),
    status: supabaseStatus(),
    mirrored: {}
  };

  try {
    const orders = readJson(config.ordersPath, []);
    await syncOrdersToSupabase(Array.isArray(orders) ? orders : []);
    result.mirrored.orders = Array.isArray(orders) ? orders.length : 0;
    let templateDeliveries = 0;
    for (const order of Array.isArray(orders) ? orders : []) {
      if (!order?.orderId || !order?.chatbyTemplateName || !order?.chatbyTemplateAttemptedAt) continue;
      await finishTemplateDelivery({
        storeId: order.storeId || config.defaultStore.id || 'suleia',
        orderId: order.orderId,
        customerPhone: order.customerPhone || '',
        templateName: order.chatbyTemplateName,
        provider: order.chatbyLastSendResponse?.provider || '',
        chatbyUserNs: order.chatbyUserNs || '',
        status: order.chatbyTemplateSendStatus || (order.chatbyTemplateSentAt ? 'sent' : 'attempted'),
        attemptedAt: order.chatbyTemplateAttemptedAt,
        sentAt: order.chatbyTemplateSentAt || null,
        lastError: order.chatbyTemplateLastError || null,
        raw: order.chatbyLastSendResponse || null
      });
      templateDeliveries += 1;
    }
    result.mirrored.templateDeliveries = templateDeliveries;
  } catch (error) {
    logSupabaseMirrorError('backfill_orders', error);
    result.mirrored.ordersError = error instanceof Error ? error.message : String(error);
  }

  try {
    const state = readJson(config.statePath, {});
    await syncAppStateToSupabase(state || {});
    result.mirrored.state = true;
  } catch (error) {
    logSupabaseMirrorError('backfill_state', error);
    result.mirrored.stateError = error instanceof Error ? error.message : String(error);
  }

  try {
    const operational = readJson(path.join(dashboardDir, 'operational-orders-cache.json'), {});
    await syncOperationalOrdersCacheToSupabase(operational || {});
    result.mirrored.operationalOrders = Array.isArray(operational?.orders) ? operational.orders.length : 0;
  } catch (error) {
    logSupabaseMirrorError('backfill_operational_orders', error);
    result.mirrored.operationalOrdersError = error instanceof Error ? error.message : String(error);
  }

  try {
    const incidents = readJson(path.join(dashboardDir, 'incidents-cache.json'), {});
    await syncIncidentsCacheToSupabase(incidents || {});
    result.mirrored.incidents = Array.isArray(incidents?.incidents) ? incidents.incidents.length : 0;
  } catch (error) {
    logSupabaseMirrorError('backfill_incidents', error);
    result.mirrored.incidentsError = error instanceof Error ? error.message : String(error);
  }

  try {
    const feedback = readJson(path.join(dashboardDir, 'agent-feedback.json'), []);
    for (const item of Array.isArray(feedback) ? feedback : []) {
      await syncAgentFeedbackToSupabase(item, 'order');
    }
    result.mirrored.agentFeedback = Array.isArray(feedback) ? feedback.length : 0;
  } catch (error) {
    logSupabaseMirrorError('backfill_agent_feedback', error);
    result.mirrored.agentFeedbackError = error instanceof Error ? error.message : String(error);
  }

  try {
    const feedback = readJson(path.join(dashboardDir, 'incident-feedback.json'), []);
    for (const item of Array.isArray(feedback) ? feedback : []) {
      await syncAgentFeedbackToSupabase(item, 'incident');
    }
    result.mirrored.incidentFeedback = Array.isArray(feedback) ? feedback.length : 0;
  } catch (error) {
    logSupabaseMirrorError('backfill_incident_feedback', error);
    result.mirrored.incidentFeedbackError = error instanceof Error ? error.message : String(error);
  }

  try {
    const memory = readJson(path.join(dashboardDir, 'agent-memory.json'), []);
    for (const item of Array.isArray(memory) ? memory : []) {
      await syncAgentMemoryRuleToSupabase(item);
    }
    result.mirrored.agentMemory = Array.isArray(memory) ? memory.length : 0;
  } catch (error) {
    logSupabaseMirrorError('backfill_agent_memory', error);
    result.mirrored.agentMemoryError = error instanceof Error ? error.message : String(error);
  }

  result.finishedAt = nowIso();
  return result;
}

function rowRaw(row, fallback = {}) {
  return row?.raw && typeof row.raw === 'object' ? row.raw : fallback;
}

function mergeById(localRows, remoteRows, idOf) {
  const merged = new Map();
  for (const row of Array.isArray(localRows) ? localRows : []) {
    const id = idOf(row);
    if (id) merged.set(String(id), row);
  }
  for (const row of Array.isArray(remoteRows) ? remoteRows : []) {
    const id = idOf(row);
    if (id) merged.set(String(id), row);
  }
  return [...merged.values()];
}

export async function hydrateLocalStateFromSupabase() {
  if (!isSupabaseEnabled()) return { ok: false, skipped: true, status: supabaseStatus() };

  const dashboardDir = path.join(config.dataDir, 'dashboard');
  ensureDir(dashboardDir);
  const result = { ok: true, startedAt: nowIso(), restored: {} };

  const [orderRows, stateRows, feedbackRows, memoryRows] = await Promise.all([
    selectRows('orders', { query: { order: 'updated_at.asc' }, limit: 5000 }),
    selectRows('app_state', { limit: 20 }),
    selectRows('agent_feedback', { query: { order: 'created_at.asc' }, limit: 5000 }),
    selectRows('agent_memory_events', { query: { order: 'created_at.asc' }, limit: 5000 })
  ]);

  if (orderRows.length) {
    const localOrders = readJson(config.ordersPath, []);
    const remoteOrders = orderRows.map((row) => ({
      ...rowRaw(row),
      orderId: String(row.order_id || rowRaw(row).orderId || ''),
      storeId: row.store_id || rowRaw(row).storeId || config.defaultStore.id,
      status: row.status || rowRaw(row).status || 'PENDING',
      customerName: row.customer_name || rowRaw(row).customerName || null,
      customerPhone: row.customer_phone || rowRaw(row).customerPhone || null,
      customerEmail: row.customer_email || rowRaw(row).customerEmail || null,
      chatbyUserNs: row.chatby_user_ns || rowRaw(row).chatbyUserNs || null
    }));
    const mergedOrders = mergeById(localOrders, remoteOrders, (item) => item.orderId);
    writeJson(config.ordersPath, mergedOrders);
    result.restored.orders = mergedOrders.length;
  }

  const stateByKey = new Map(stateRows.map((row) => [String(row.key), row.value]));
  const remoteRuntimeState = stateByKey.get('runtime_state');
  if (remoteRuntimeState && typeof remoteRuntimeState === 'object') {
    const localState = readJson(config.statePath, {});
    writeJson(config.statePath, { ...localState, ...remoteRuntimeState, hydratedFromSupabaseAt: nowIso() });
    result.restored.runtimeState = true;
  }

  for (const [key, filename] of [
    ['operational_orders_cache', 'operational-orders-cache.json'],
    ['incidents_cache', 'incidents-cache.json']
  ]) {
    const value = stateByKey.get(key);
    if (!value || typeof value !== 'object') continue;
    writeJson(path.join(dashboardDir, filename), value);
    result.restored[key] = true;
  }

  if (feedbackRows.length) {
    const orderFeedback = feedbackRows.filter((row) => row.scope === 'order').map((row) => rowRaw(row, row));
    const incidentFeedback = feedbackRows.filter((row) => row.scope === 'incident').map((row) => rowRaw(row, row));
    writeJson(path.join(dashboardDir, 'agent-feedback.json'), orderFeedback);
    writeJson(path.join(dashboardDir, 'incident-feedback.json'), incidentFeedback);
    result.restored.orderFeedback = orderFeedback.length;
    result.restored.incidentFeedback = incidentFeedback.length;
  }

  const learnedMemory = memoryRows
    .filter((row) => String(row.type || '') !== 'agent_chat')
    .map((row) => rowRaw(row, row));
  if (learnedMemory.length) {
    const localMemory = readJson(path.join(dashboardDir, 'agent-memory.json'), []);
    const mergedMemory = mergeById(localMemory, learnedMemory, (item) => item.id);
    writeJson(path.join(dashboardDir, 'agent-memory.json'), mergedMemory);
    result.restored.agentMemory = mergedMemory.length;
  }

  result.finishedAt = nowIso();
  return result;
}
