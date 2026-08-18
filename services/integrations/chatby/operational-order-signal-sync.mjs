const INTENT_ALIASES = Object.freeze({
  CONFIRM: 'CONFIRM', CONFIRMED: 'CONFIRM',
  NO_CONFIRM: 'REJECT', CANCEL: 'REJECT', REJECT: 'REJECT', REJECTED: 'REJECT',
  ADDRESS_CHANGE: 'ADDRESS_CHANGE', ADDRESS_CHANGE_REQUESTED: 'ADDRESS_CHANGE',
  PROMOTION_CHANGE: 'PROMOTION_CHANGE', PROMOTION_CHANGE_REQUESTED: 'PROMOTION_CHANGE',
  NO_RESPONSE: 'NO_RESPONSE', UNCLEAR: 'UNCLEAR', NOT_VERIFIABLE: 'NOT_VERIFIABLE'
});

function upper(value) { return String(value || '').trim().toUpperCase(); }
function finiteNumber(value, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function responseSummary(intent, messagesUsed) {
  if (messagesUsed <= 0 || intent === 'NO_RESPONSE') return 'No hay mensajes entrantes del cliente para este pedido.';
  return Object.freeze({
    CONFIRM: 'El cliente confirmó el pedido.',
    REJECT: 'El cliente rechazó o pidió cancelar el pedido.',
    ADDRESS_CHANGE: 'El cliente pidió cambiar la dirección o los datos de envío.',
    PROMOTION_CHANGE: 'El cliente solicitó modificar la promoción o el pedido.',
    UNCLEAR: 'El cliente respondió, pero la respuesta no permite decidir con seguridad.',
    NOT_VERIFIABLE: 'Hay una señal del cliente, pero no puede verificarse con seguridad.',
    UNKNOWN: 'Hay una respuesta del cliente sin clasificación fiable.'
  })[intent] || 'Hay una respuesta del cliente sin clasificación fiable.';
}

export function operationalOrderSignal(row = {}, canonicalOrderId) {
  const raw = row.raw && typeof row.raw === 'object' ? row.raw : {};
  const sourceIntent = upper(row.agent_intent || raw.agentIntent || raw.customerSignalRaw);
  const detectedIntent = INTENT_ALIASES[sourceIntent] || 'UNKNOWN';
  const messagesUsed = Math.max(0, Math.floor(finiteNumber(row.customer_messages ?? raw.customerMessages)));
  const confidence = Math.max(0, Math.min(1, finiteNumber(row.agent_confidence ?? raw.agentConfidence) / 100));
  const updatedAt = row.updated_at || raw.chatbyLiveCheckedAt || new Date().toISOString();
  const latestInboundAt = row.latest_inbound_message_at || raw.lastCustomerMessageAt || null;
  return Object.freeze({
    canonical_order_id: canonicalOrderId,
    has_customer_replied: messagesUsed > 0,
    latest_inbound_message_at: messagesUsed > 0 ? latestInboundAt : null,
    detected_intent: detectedIntent,
    confidence,
    messages_used: messagesUsed,
    explanation_masked: {
      source: 'RENDER_OPERATIONAL_ORDERS',
      source_intent: sourceIntent || 'UNKNOWN',
      response_summary: responseSummary(detectedIntent, messagesUsed),
      association: 'EXACT_DROPEA_ORDER_ID',
      response_status: messagesUsed > 0 ? 'RESPONDED' : 'NO_RESPONSE'
    },
    freshness: 'FRESH',
    updated_at: updatedAt,
    actions_executed: 0,
    production_writes: 0
  });
}

export async function syncOperationalOrderSignals({ source, projector, stores = [], pageSize = 250, maxPages = 20 }) {
  let offset = 0;
  let seen = 0;
  let projected = 0;
  let unmatched = 0;
  for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
    const page = await source.page('operational_orders', 'updated_at', { offset, limit: pageSize });
    if (page.missing || !page.rows.length) break;
    for (const row of page.rows) {
      seen += 1;
      let match = null;
      for (const store of stores) {
        const resolved = await projector.resolveCanonicalOrderByDropeaId({
          market: store.market, storeId: store.store_id, dropeaOrderId: row.order_id
        });
        if (resolved.status === 'FOUND') { match = resolved; break; }
      }
      if (!match) { unmatched += 1; continue; }
      await projector.upsertOperationalOrderSignal(operationalOrderSignal(row, match.canonical_order_id));
      projected += 1;
    }
    offset += page.rows.length;
    if (page.rows.length < pageSize) break;
  }
  return Object.freeze({ ok: true, seen, projected, unmatched, actions_executed: 0, production_writes: 0 });
}
