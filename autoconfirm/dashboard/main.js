const state = {
  section: 'overview',
  query: '',
  orderFilter: 'all',
  incidentFilter: 'all',
  loading: true,
  error: null,
  dashboard: null,
  financeReport: null,
  financeLoading: false,
  financeError: null,
  financeSort: { key: 'day', direction: 'asc' },
  financeVisibleColumns: null
};

const titles = {
  overview: 'Vista general',
  orders: 'Pedidos',
  incidents: 'Incidencias',
  discounts: 'Descuentos',
  agent: 'Control del agente',
  meta: 'Meta Ads',
  products: 'Productos',
  research: 'Competencia y oportunidades',
  settings: 'Control de gasto'
};

const pageTitle = document.querySelector('#page-title');
const navItems = [...document.querySelectorAll('.nav-item')];
const panels = [...document.querySelectorAll('[data-panel]')];
const searchInput = document.querySelector('#search-input');
const syncButton = document.querySelector('#sync-button');
const orderFilterButtons = [...document.querySelectorAll('[data-order-filter]')];
const incidentFilterButtons = [...document.querySelectorAll('[data-incident-filter]')];
const feedbackDialog = document.querySelector('#feedback-dialog');
const feedbackForm = document.querySelector('#feedback-form');
const feedbackClose = document.querySelector('#feedback-close');
const incidentFeedbackDialog = document.querySelector('#incident-feedback-dialog');
const incidentFeedbackForm = document.querySelector('#incident-feedback-form');
const incidentFeedbackClose = document.querySelector('#incident-feedback-close');
const financeMonthInput = document.querySelector('#finance-month');
const financeRefreshButton = document.querySelector('#finance-refresh');
const financePrevButton = document.querySelector('#finance-prev');
const financeNextButton = document.querySelector('#finance-next');
const financeCompareInput = document.querySelector('#finance-compare');
const financeExpenseForm = document.querySelector('#finance-expense-form');
const agentChatForm = document.querySelector('#agent-chat-form');
const businessManagerButton = document.querySelector('#business-manager-button');
let feedbackOrderId = null;
let feedbackIncident = null;
let refreshCountdownTimer = null;

const META_REFRESH_HOURS = 12;

function currentMadridMonth() {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}`;
}

function money(value) {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(number);
}

function percent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0%';
  return new Intl.NumberFormat('es-ES', { style: 'percent', maximumFractionDigits: 0 }).format(number);
}

function percentValue(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${new Intl.NumberFormat('es-ES', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(number)}%`;
}

function numberCompact(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  return new Intl.NumberFormat('es-ES', { notation: 'compact', maximumFractionDigits: 1 }).format(number);
}

function formatDateTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return 'Sin fecha';
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function refreshCountdownText() {
  return `Meta se actualiza cada ${META_REFRESH_HOURS}h. Incidencias cada 6h. Pedidos por evento Shopify/Dropea y boton manual.`;
}

function cleanDisplayText(value) {
  return String(value ?? '')
    .replaceAll('Ã±', 'n')
    .replaceAll('Ã³', 'o')
    .replaceAll('Ã©', 'e')
    .replaceAll('Ã¡', 'a')
    .replaceAll('Ã­', 'i')
    .replaceAll('Ãº', 'u')
    .replaceAll('Ãš', 'U')
    .replaceAll('Â·', '-')
    .replaceAll('â€¦', '...');
}

function escapeHtml(value) {
  return cleanDisplayText(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function matchesQuery(values) {
  if (!state.query) return true;
  return normalize(values.join(' ')).includes(normalize(state.query));
}

function toneForOrder(order) {
  return friendlyOrderState(order).tone;
}

function agentLabel(order) {
  if (order.agentAction) return `${order.agentAction}${order.agentConfidence ? ` · ${order.agentConfidence}%` : ''}`;
  if (order.note) return order.note;
  return 'Sin decision visible';
}

function hasAgentConfirmation(order) {
  const action = normalize(order.agentAction);
  const intent = normalize(order.agentIntent);
  const status = normalize(order.status);
  if (order.customerConfirmed === true) return true;
  if (action.includes('not_confirm') || intent.includes('no_confirm') || intent.includes('not_confirm')) return false;
  return action === 'would_confirm'
    || intent === 'confirm'
    || intent === 'confirmed'
    || status.includes('confirmed_by_customer');
}

function hasAddressChange(order) {
  const text = normalize([
    order.status,
    order.agentIntent,
    order.agentReason,
    order.note,
    order.feedbackVerdict,
    order.feedbackCorrection
  ].join(' '));
  return text.includes('address_change')
    || text.includes('cambio de direccion')
    || text.includes('cambio direccion')
    || text.includes('direccion');
}

function friendlyOrderState(order) {
  if (order.agentRecommendedLabel) {
    return {
      label: order.agentRecommendedLabel,
      detail: order.agentDecisionExplanation || order.agentNextStep || 'Decision operativa calculada por el agente.',
      tone: order.agentDecisionTone || 'neutral'
    };
  }

  const status = normalize(order.status);
  const action = normalize(order.agentAction);
  const intent = normalize(order.agentIntent);

  if (status.includes('would_cancel_unanswered') || status.includes('would_reject_unanswered') || status.includes('rejected_unanswered') || intent.includes('cancel_unanswered_timeout') || intent.includes('reject_unanswered_timeout') || action.includes('cancel_unanswered_timeout') || action.includes('reject_unanswered_timeout')) {
    return {
      label: status.includes('rejected_unanswered') ? 'Rechazado por 48h sin respuesta' : 'Rechazar por 48h sin respuesta',
      detail: 'Sin confirmacion ni cambio de direccion tras 48h. Accion en Dropea: cancelar/rechazar pedido.',
      tone: 'danger'
    };
  }

  if (intent.includes('confirm_delay_pending')) {
    return {
      label: 'Confirmación programada',
      detail: 'Cliente confirmó. El agente espera 1h y revisa Chatby antes de confirmar en Dropea.',
      tone: 'warning'
    };
  }

  if (hasAddressChange(order)) {
    return {
      label: 'Pendiente por direccion',
      detail: 'El cliente pidio cambiar datos. No confirmar hasta corregirlo en Dropea.',
      tone: 'warning'
    };
  }

  if (status.includes('cancel') || intent.includes('cancel') || action.includes('not_confirm')) {
    return {
      label: 'No confirmar',
      detail: 'El cliente no ha dado una confirmacion valida o el pedido esta cancelado.',
      tone: 'danger'
    };
  }

  if (status.includes('manual') || status.includes('revision')) {
    return {
      label: 'Revision manual',
      detail: 'Necesita una comprobacion humana antes de actuar.',
      tone: 'warning'
    };
  }

  if (hasAgentConfirmation(order)) {
    return {
      label: 'Confirmado',
      detail: 'Hay una senal suficiente para confirmar el pedido.',
      tone: 'positive'
    };
  }

  if (status.includes('pending') || status.includes('pend')) {
    return {
      label: 'Pendiente de respuesta',
      detail: 'Todavia no hay una respuesta clara del cliente.',
      tone: 'neutral'
    };
  }

  return {
    label: 'Sin evaluar',
    detail: 'Aun no hay una decision visible del agente.',
    tone: 'neutral'
  };
}

function agentEvidence(order) {
  if (order.customerSignalLabel) {
    return {
      label: order.customerSignalLabel,
      detail: order.customerSignalDetail || order.agentNextStep || 'Senal interpretada por el agente.',
      tone: order.customerSignalTone || 'neutral'
    };
  }

  const confidence = Number(order.agentConfidence);
  const reason = order.agentReason || order.note || '';
  const status = normalize(order.status);
  const intent = normalize(order.agentIntent);

  if (hasAddressChange(order)) {
    return {
      label: 'Cambio solicitado',
      detail: 'Evidencia alta: el cliente pidio modificar direccion o datos. Bloquea confirmacion.',
      tone: 'warning'
    };
  }

  if (hasAgentConfirmation(order)) {
    return {
      label: 'Confirmacion clara',
      detail: confidence >= 90
        ? 'Evidencia alta: boton o texto de confirmacion detectado.'
        : 'Confirmacion detectada, pero conviene revisar la evidencia.',
      tone: confidence >= 90 ? 'positive' : 'warning'
    };
  }

  if (status.includes('cancel') || intent.includes('cancel')) {
    return {
      label: 'Cancelacion clara',
      detail: 'Evidencia alta: el cliente no quiere continuar.',
      tone: 'danger'
    };
  }

  if (confidence >= 90) {
    return {
      label: 'Evidencia alta',
      detail: reason || 'El agente encontro una senal fuerte, pero sin accion automatica.',
      tone: 'positive'
    };
  }

  if (confidence >= 70) {
    return {
      label: 'Evidencia media',
      detail: reason || 'Hay indicios, pero no son suficientes para actuar solo.',
      tone: 'warning'
    };
  }

  if (Number.isFinite(confidence) && confidence > 0) {
    return {
      label: 'Evidencia baja',
      detail: reason || 'No hay certeza suficiente para automatizar.',
      tone: 'neutral'
    };
  }

  return {
    label: 'Sin senal suficiente',
    detail: reason || 'Esperando respuesta o informacion util del cliente.',
    tone: 'neutral'
  };
}

function setText(selector, value) {
  const node = document.querySelector(selector);
  if (node) node.textContent = value;
}

function orderFilterCategory(order) {
  const signal = normalize(order.customerSignal || order.agentRecommendedAction || order.agentRecommendedLabel || order.status || '');
  const tone = normalize(order.agentDecisionTone || '');
  const stateLabel = normalize(friendlyOrderState(order).label);
  if (signal.includes('address') || signal.includes('direccion') || stateLabel.includes('direccion')) return 'address';
  if (signal.includes('absent') || signal.includes('issue') || signal.includes('incidencia') || stateLabel.includes('incidencia')) return 'issue';
  if (signal.includes('not_confirm') || signal.includes('rejected') || signal.includes('cancel') || tone.includes('danger') || stateLabel.includes('no confirmar')) return 'blocked';
  if (hasAgentConfirmation(order) || stateLabel.includes('confirmado') || stateLabel.includes('confirmar pedido')) return 'confirm';
  if (signal.includes('manual') || stateLabel.includes('revision')) return 'review';
  return 'review';
}

function orderMatchesFilter(order) {
  if (state.orderFilter === 'all') return true;
  return orderFilterCategory(order) === state.orderFilter;
}

function countOrdersByFilter(orders, filter) {
  return orders.filter((order) => filter === 'all' || orderFilterCategory(order) === filter).length;
}

function renderOrdersSummary(orders, visibleOrders) {
  const summary = document.querySelector('#orders-summary');
  const note = document.querySelector('#orders-count-note');
  if (!summary) return;

  const latest = orders[0];
  const cards = [
    { label: 'Con respuesta', value: orders.filter((order) => Number(order.customerMessages) > 0).length, detail: 'Cliente contesto en Chatby', tone: 'positive' },
    { label: 'Pedido previo', value: orders.filter((order) => order.priorOrderDetected).length, detail: 'Posible duplicidad a revisar', tone: 'danger' },
    { label: 'Cola operativa', value: orders.length, detail: 'Solo pendientes e incidencias en Dropea', tone: 'neutral' },
    { label: 'Confirmar ahora', value: countOrdersByFilter(orders, 'confirm'), detail: 'Señal clara del cliente', tone: 'positive' },
    { label: 'Dirección', value: countOrdersByFilter(orders, 'address'), detail: 'No confirmar hasta corregir', tone: 'warning' },
    { label: 'Incidencias', value: countOrdersByFilter(orders, 'issue'), detail: 'Seguimiento antes de actuar', tone: 'warning' },
    { label: 'Bloqueados', value: countOrdersByFilter(orders, 'blocked'), detail: 'Rechazo, cancelación o no señal', tone: 'danger' }
  ];

  summary.innerHTML = cards.map((card) => `
    <article class="order-summary-card ${card.tone}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.value)}</strong>
      <small>${escapeHtml(card.detail)}</small>
    </article>
  `).join('');

  if (note) {
    note.textContent = `${visibleOrders.length} pedidos visibles · último: ${latest?.orderId ? `#${latest.orderId}` : 'sin dato'} · ordenado de más reciente a menos reciente`;
  }
}

function renderOrders() {
  const table = document.querySelector('#orders-table');
  const orders = state.dashboard?.orders || [];
  const rows = orders
    .filter((order) => matchesQuery([order.orderId, order.customer, order.product, order.status, order.agentAction, order.realActionLabel]))
    .filter(orderMatchesFilter)
    .map((order) => {
      const orderState = friendlyOrderState(order);
      const evidence = agentEvidence(order);
      const confidence = order.agentUsefulConfidence ?? order.agentConfidence;
      const customerMessages = Number(order.customerMessages || 0);
      const customerActionLabel = order.customerActionLabel || (customerMessages > 0 ? 'Cliente respondio' : 'Sin respuesta');
      const customerActionDetail = order.customerActionDetail || order.lastCustomerMessage || (customerMessages > 0 ? 'Hay mensajes entrantes en Chatby.' : 'No hay mensajes entrantes ni botones detectados.');
      const source = order.liveSource || order.raw?.source || 'Sistema';
      const realActionTone = order.realActionTone || 'neutral';
      const realActionLabel = order.realActionLabel || 'Sin accion real';
      const realActionDetail = order.realActionDetail || 'Aun no se ha ejecutado accion en Dropea';
      const intent = normalize(order.agentIntent || order.status || '');
      const isScheduled = intent.includes('confirm_delay_pending') || intent.includes('confirm_delay');
      const isConfirmedByCustomer = hasAgentConfirmation(order);
      const hasPriorOrder = Boolean(order.priorOrderDetected);
      const rowClasses = ['order-row'];
      if (isScheduled) rowClasses.push('is-scheduled');
      if (isConfirmedByCustomer) rowClasses.push('is-confirmed');
      if (hasPriorOrder) rowClasses.push('has-prior-order');
      const timeline = Array.isArray(order.timeline) ? order.timeline : [];
      const timelineHtml = timeline.length ? `
        <div class="order-timeline" aria-label="Historial del pedido">
          ${timeline.map((item) => `
            <span class="order-timeline-step ${escapeHtml(item.tone || 'neutral')}">
              <i></i>
              ${escapeHtml(item.label)} · ${escapeHtml(formatDateTime(item.value))}
            </span>
          `).join('')}
        </div>
      ` : '';
      const scheduledAlert = isScheduled ? `
        <div class="order-alert">
          Confirmacion programada: revisar Chatby antes de actuar${order.confirmationDueAt ? ` · ${escapeHtml(formatDateTime(order.confirmationDueAt))}` : ''}
        </div>
      ` : '';
      const priorOrderAlert = hasPriorOrder ? `
        <div class="order-prior-warning" role="alert">
          <strong>Atencion: posible pedido anterior</strong>
          <span>${escapeHtml(order.priorOrderWarning || order.priorOrderState || 'Hay actividad de un pedido anterior en esta conversacion.')}</span>
          ${order.priorPreparedAt ? `<small>Señal previa: ${escapeHtml(formatDateTime(order.priorPreparedAt))}</small>` : ''}
        </div>
      ` : '';
      return `
        <tr class="${rowClasses.join(' ')}">
          <td>
            <strong>#${escapeHtml(order.orderId)}</strong>
            <small>${escapeHtml(order.createdAt || '')}</small>
            <span class="order-source">${escapeHtml(source)}</span>
            ${isConfirmedByCustomer ? '<span class="customer-response-badge is-confirmed">Confirmado por cliente</span>' : ''}
          </td>
          <td>
            ${escapeHtml(order.product || 'Producto')}
            ${order.shopifyOrderId ? '<small>Pedido capturado desde Shopify</small>' : ''}
          </td>
          <td>
            <span class="pill ${orderState.tone}">${escapeHtml(orderState.label)}</span>
            <small>${escapeHtml(orderState.detail)}</small>
            <small><strong>Dropea:</strong> ${escapeHtml(order.dropeaStatus || order.raw?.status || 'PENDING')}</small>
            <small><strong>Confianza útil:</strong> ${confidence ?? '-'}%</small>
          </td>
          <td>
            <div class="real-action-card ${escapeHtml(realActionTone)}">
              <span>${escapeHtml(realActionLabel)}</span>
              <strong>${escapeHtml(realActionDetail)}</strong>
            </div>
            ${scheduledAlert}
            ${priorOrderAlert}
            ${timelineHtml}
          </td>
          <td>
            <span class="signal-chip ${evidence.tone}">${escapeHtml(evidence.label)}</span>
            <small>${escapeHtml(evidence.detail)}</small>
            <small><strong>Chatby:</strong> ${escapeHtml(customerActionLabel)}${customerMessages ? ` (${customerMessages})` : ''}</small>
            <small>${escapeHtml(customerActionDetail)}</small>
            ${order.agentNextStep ? `<small><strong>Siguiente paso:</strong> ${escapeHtml(order.agentNextStep)}</small>` : ''}
          </td>
          <td>
            <strong>${escapeHtml(order.customer || 'Sin cliente')}</strong>
            <small>${escapeHtml(order.phone || '')}</small>
            <small class="money-inline">${money(order.amount)}</small>
          </td>
          <td>
            <button class="mini-button" data-feedback-order="${escapeHtml(order.orderId)}">
              Corregir
            </button>
            <button class="mini-button danger-action" data-cancel-dropea-order="${escapeHtml(order.orderId)}">
              Cancelar Dropea
            </button>
            ${order.feedbackVerdict ? `<small>Feedback: ${escapeHtml(order.feedbackVerdict)}</small>` : ''}
          </td>
      </tr>
    `;
    });
  const visibleOrders = orders
    .filter((order) => matchesQuery([order.orderId, order.customer, order.product, order.status, order.agentAction, order.realActionLabel]))
    .filter(orderMatchesFilter);
  renderOrdersSummary(orders, visibleOrders);
  table.innerHTML = rows.join('') || '<tr><td colspan="7">No hay resultados para esta busqueda.</td></tr>';
}

function incidentTypeLabel(type) {
  if (type === 'absent') return 'Ausente';
  if (type === 'address') return 'Dirección / datos';
  if (type === 'rejected_goods') return 'No acepta mercancía';
  return 'Incidencia';
}

function inferredIncidentType(incident) {
  if (incident.incidentType) return incident.incidentType;
  const code = String(incident.reasonCode || incident.rawReason || incident.reason || '').trim().toUpperCase();
  const text = normalize([
    incident.reason,
    incident.reasonCode,
    incident.rawReason,
    incident.chatbyStatus,
    incident.chatbySummary
  ].filter(Boolean).join(' '));
  if (code === 'AS' || text.includes('ausente')) return 'absent';
  if (code === 'NAM' || text.includes('no acepta') || text.includes('rechaz')) return 'rejected_goods';
  if (code === 'MCC' || text.includes('direccion') || text.includes('dirección') || text.includes('faltan datos')) return 'address';
  return 'unknown';
}

function inferredIncidentTone(incident) {
  const type = inferredIncidentType(incident);
  if (type === 'rejected_goods') return 'danger';
  if (type === 'address' || type === 'absent') return 'warning';
  return 'neutral';
}

function incidentMatchesFilter(incident) {
  if (state.incidentFilter === 'all') return true;
  if (state.incidentFilter === 'responded') return incident.customerResponded || Number(incident.customerMessages) > 0;
  return inferredIncidentType(incident) === state.incidentFilter;
}

function incidentTone(incident) {
  if (incident.actionTone) return incident.actionTone;
  if (incident.customerResponded || Number(incident.customerMessages) > 0) return 'positive';
  if (incident.incidentTypeTone) return incident.incidentTypeTone;
  return 'neutral';
}

function incidentConfidence(incident) {
  const value = Number(incident.contextConfidence);
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function incidentConfidenceTone(value) {
  if (value === null) return 'neutral';
  if (value >= 80) return 'positive';
  if (value >= 55) return 'warning';
  return 'danger';
}

function incidentConfidenceLabel(value) {
  if (value === null) return 'Sin medir';
  if (value >= 80) return 'Alta';
  if (value >= 55) return 'Media';
  return 'Baja';
}

function renderIncidents() {
  const table = document.querySelector('#incidents-table');
  const summary = document.querySelector('#incidents-summary');
  if (!table || !summary) return;

  const data = state.dashboard?.incidents || {};
  const incidents = Array.isArray(data.incidents) ? data.incidents : [];
  const visible = incidents.filter((incident) => matchesQuery([
    incident.orderId,
    incident.incidenceId,
    incident.reason,
    incident.reasonCode,
    incident.rawReason,
    incident.incidentTypeLabel,
    incident.customerName,
    incident.phone,
    incident.chatbyStatus,
    incident.chatbySummary,
    incident.lastCustomerMessage,
    incident.customerIntentDetail,
    incident.resolutionStage,
    incident.operationalInstruction,
    incident.templateRecommendation,
    incident.templateName,
    ...(incident.evidence || []),
    incident.proposedSolution,
    incident.actionRecommended,
    incident.incidentResponseState,
    incident.incidentResponsePendingDecision,
    incident.incidentResponseLatestInbound,
    incident.incidentResponseLatestValid,
    incident.incidentResponseEvidence,
    incident.feedbackCorrection,
    incident.feedbackNote
  ])).filter(incidentMatchesFilter).sort((a, b) => {
    const bIncidenceId = Number(String(b.incidenceId || '').replace(/\D/g, '')) || 0;
    const aIncidenceId = Number(String(a.incidenceId || '').replace(/\D/g, '')) || 0;
    if (bIncidenceId !== aIncidenceId) return bIncidenceId - aIncidenceId;
    const bOrderId = Number(String(b.orderId || '').replace(/\D/g, '')) || 0;
    const aOrderId = Number(String(a.orderId || '').replace(/\D/g, '')) || 0;
    return bOrderId - aOrderId;
  });

  const noChatby = incidents.filter((incident) => !incident.chatbyUserNs).length;
  const customerResponded = incidents.filter((incident) => incident.customerResponded || Number(incident.customerMessages) > 0).length;
  const learned = incidents.filter((incident) => incident.memoryApplied || incident.feedbackVerdict).length;
  const highPriority = incidents.filter((incident) => incident.priority === 'high' || incident.customerResponded || Number(incident.customerMessages) > 0).length;
  const needsAddress = incidents.filter((incident) => inferredIncidentType(incident) === 'address').length;
  const absent = incidents.filter((incident) => inferredIncidentType(incident) === 'absent').length;
  const rejected = incidents.filter((incident) => inferredIncidentType(incident) === 'rejected_goods').length;
  const cards = [
    { label: 'Con aprendizaje', value: learned, detail: 'Feedback aplicado al agente', tone: learned ? 'positive' : 'neutral' },
    { label: 'Alta prioridad', value: highPriority, detail: 'Respuesta o señal accionable', tone: highPriority ? 'positive' : 'neutral' },
    { label: 'Con respuesta', value: customerResponded, detail: 'Alertas para resolver primero', tone: 'positive' },
    { label: 'Pendientes', value: incidents.length, detail: `Actualizado ${formatDateTime(data.updatedAt)}`, tone: 'neutral' },
    { label: 'Ausente', value: absent, detail: 'Coordinar nueva entrega', tone: 'warning' },
    { label: 'Dirección/datos', value: needsAddress, detail: 'Corregir datos de entrega', tone: 'warning' },
    { label: 'No acepta mercancía', value: rejected, detail: 'Validar rechazo/cancelación', tone: 'danger' },
    { label: 'Sin Chatby', value: noChatby, detail: 'Necesitan revisión manual', tone: noChatby ? 'warning' : 'positive' }
  ];

  summary.innerHTML = cards.map((card) => `
    <article class="order-summary-card ${card.tone}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.value)}</strong>
      <small>${escapeHtml(card.detail)}</small>
    </article>
  `).join('');

  if (data.error) {
    table.innerHTML = `<tr><td colspan="8">No se pudo actualizar incidencias: ${escapeHtml(data.error)}</td></tr>`;
    return;
  }

  table.innerHTML = visible.map((incident) => {
    const hasCustomerResponse = incident.customerResponded || Number(incident.customerMessages) > 0;
    const statusTone = incidentTone(incident);
    const type = inferredIncidentType(incident);
    const typeTone = incident.incidentTypeTone || inferredIncidentTone(incident);
    const confidence = incidentConfidence(incident);
    const confidenceTone = incidentConfidenceTone(confidence);
    const confidenceLabel = incidentConfidenceLabel(confidence);
    const evidence = Array.isArray(incident.evidence) ? incident.evidence : [];
    const customerSignalTone = incident.customerSignalTone || statusTone;
    const customerSignalLabel = incident.customerSignalLabel || (hasCustomerResponse ? 'Cliente respondio' : 'Sin respuesta del cliente');
    const customerSignalDetail = incident.customerSignalDetail || (hasCustomerResponse ? 'Hay respuesta entrante en Chatby.' : 'No veo respuesta entrante en Chatby.');
    const memory = incident.memoryApplied
      ? `<small class="incident-memory-applied">Aprendizaje aplicado: ${escapeHtml(incident.memoryText || 'Regla guardada')}</small>`
      : '';
    const feedback = incident.feedbackVerdict
      ? `<small class="incident-feedback-saved">Feedback: ${escapeHtml(incident.feedbackVerdict)} · ${escapeHtml(formatDateTime(incident.feedbackAt))}</small>`
      : '';
    const responseWaitApplies = incident.incidentResponseState === 'WAITING_CUSTOMER_INCIDENT_RESPONSE';
    const remainingHours = Number(incident.incidentResponseRemainingHours);
    const responseWait = responseWaitApplies
      ? `<div class="incident-response-wait ${incident.incidentResponseExpired ? 'is-expired' : ''}">
          <div class="incident-response-wait__header"><b>Espera por incidencia: 48h</b><span>Solo entrenamiento</span></div>
          <small>Inicio: ${escapeHtml(formatDateTime(incident.incidentResponseStartedAt))}</small>
          <small>Limite: ${escapeHtml(formatDateTime(incident.incidentResponseDeadlineAt))}</small>
          <strong>${incident.incidentResponseExpired
            ? 'Plazo cumplido'
            : Number.isFinite(remainingHours) ? `${Math.ceil(remainingHours)}h restantes` : 'Tiempo pendiente de verificar'}</strong>
          <small>Respuesta valida posterior: ${incident.incidentResponseValid ? 'Si' : 'No'}</small>
          ${incident.incidentResponseLatestInbound
            ? `<blockquote>${escapeHtml(incident.incidentResponseLatestInbound)}</blockquote>`
            : '<small>No hay mensaje entrante posterior a la incidencia vigente.</small>'}
          <small>Decision: ${escapeHtml(incident.incidentResponsePendingDecision || 'WAIT_FOR_CUSTOMER')} | comprobaciones: ${escapeHtml(incident.incidentResponseChecks || 0)}</small>
          <small>${escapeHtml(incident.incidentResponseEvidence || '')}</small>
        </div>`
      : '';
    return `
      <tr class="incident-row ${hasCustomerResponse ? 'customer-responded' : ''}">
        <td>
          <strong>#${escapeHtml(incident.orderId)}</strong>
          <small>Incidencia ${escapeHtml(incident.incidenceId || '-')}</small>
          <small>${escapeHtml(formatDateTime(incident.incidenceDate))}</small>
          ${Number.isFinite(Number(incident.incidentAgeHours)) ? `<small>${Math.round(Number(incident.incidentAgeHours))}h abierta</small>` : ''}
          ${hasCustomerResponse ? '<span class="customer-response-badge">Cliente respondió</span>' : ''}
        </td>
        <td>
          <span class="pill ${typeTone}">${escapeHtml(incident.incidentTypeLabel || incidentTypeLabel(type))}</span>
          ${incident.reasonCode ? `<small>Código Dropea: ${escapeHtml(incident.reasonCode)}</small>` : ''}
          <small>${escapeHtml(incident.issueStatus || 'PENDIENTE')} · ${escapeHtml(incident.orderStatus || '')}</small>
        </td>
        <td>
          <strong>${escapeHtml(incident.customerName || 'Sin nombre')}</strong>
          <small>${escapeHtml(incident.phone || 'Sin telefono')}</small>
        </td>
        <td>
          <span class="signal-chip ${customerSignalTone}">${escapeHtml(customerSignalLabel)}</span>
          <small>${escapeHtml(customerSignalDetail)}</small>
          ${incident.resolutionStage ? `<small class="incident-stage">Etapa: ${escapeHtml(incident.resolutionStage)}</small>` : ''}
          <small>${escapeHtml(incident.customerMessages || 0)} mensajes entrantes del cliente</small>
          ${incident.lastCustomerMessage
            ? `<div class="incident-customer-last"><b>Ultimo mensaje del cliente</b><time>${escapeHtml(formatDateTime(incident.lastCustomerAt))}</time><blockquote>${escapeHtml(incident.lastCustomerMessage)}</blockquote></div>`
            : '<div class="incident-customer-last is-waiting"><b>Sin respuesta del cliente</b><small>Pendiente de que el cliente conteste en Chatby.</small></div>'}
          ${confidence !== null ? `<span class="signal-chip ${confidenceTone}">Confianza ${escapeHtml(confidenceLabel)} - ${confidence}%</span>` : ''}
          ${incident.confidenceReason ? `<small class="incident-confidence-reason">${escapeHtml(incident.confidenceReason)}</small>` : ''}
          ${hasCustomerResponse ? '<small class="incident-alert">Revisar respuesta del cliente</small>' : ''}
        </td>
        <td>
          <strong class="incident-mini-title">${escapeHtml(incident.chatbyStatus || 'Sin analizar')}</strong>
          ${incident.customerIntentDetail ? `<small class="incident-intent-detail">${escapeHtml(incident.customerIntentDetail)}</small>` : ''}
          <small>${escapeHtml(incident.chatbySummary || 'Sin resumen')}</small>
          ${memory}
          ${evidence.length ? `<div class="incident-evidence">${evidence.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}</div>` : ''}
        </td>
        <td>
          <strong class="incident-mini-title">${escapeHtml(incident.carrierCompany || 'Transportista')}</strong>
          ${incident.carrierService ? `<small>${escapeHtml(incident.carrierService)}</small>` : ''}
          ${incident.carrierReason
            ? `<div class="incident-carrier-incidence">
                <b>Motivo del transportista</b>
                <p>${escapeHtml(incident.carrierReason)}</p>
                <time>Anotado: ${escapeHtml(formatDateTime(incident.carrierAnnotatedAt))}</time>
                ${incident.carrierObservation ? `<p><b>Observacion:</b> ${escapeHtml(incident.carrierObservation)}</p>` : ''}
                ${incident.carrierLastUpdatedAt ? `<small>Ultima actualizacion: ${escapeHtml(formatDateTime(incident.carrierLastUpdatedAt))}</small>` : ''}
                ${incident.carrierIncidenceId ? `<small>ID incidencia Dropea: ${escapeHtml(incident.carrierIncidenceId)}</small>` : ''}
              </div>`
            : `<div class="incident-carrier-incidence is-unavailable"><b>Motivo del transportista no disponible</b><small>El historial REST de Dropea no esta autenticado; no se sustituye por un evento generico.</small></div>`}
          ${incident.transportLatestEvent?.text
            ? `<div class="incident-carrier-latest"><b>Seguimiento GLS</b><time>${escapeHtml(incident.transportLatestEvent.displayAt || formatDateTime(incident.transportLatestEvent.eventAt))}</time><p>${escapeHtml(incident.transportLatestEvent.text)}</p></div>`
            : '<small>Sin historial detallado aportado por transporte.</small>'}
          <small class="incident-source-note">${escapeHtml(incident.transportLogSource || (incident.transportLogCompleteness === 'summary_only' ? 'Resumen disponible en Dropea' : 'Historial oficial del transporte'))}</small>
          ${Array.isArray(incident.carrierIncidentHistory) && incident.carrierIncidentHistory.length
            ? `<details class="incident-carrier-history"><summary>Historial de incidencias Dropea (${incident.carrierIncidentHistory.length})</summary>${incident.carrierIncidentHistory.map((event) => `<article><time>${escapeHtml(formatDateTime(event.annotatedAt))}</time><p><b>${escapeHtml(event.reason || event.reasonCode || 'Incidencia')}</b>${event.observation ? ` - ${escapeHtml(event.observation)}` : ''}</p></article>`).join('')}</details>`
            : ''}
          ${incident.tracking ? `<small>Tracking: ${escapeHtml(incident.tracking)}</small>` : ''}
        </td>
        <td>
          <span class="signal-chip ${statusTone}">${escapeHtml(incident.actionRecommended || 'Revisión manual')}</span>
          <small>${escapeHtml(incident.recommendedNextStep || incident.proposedSolution || 'Revision manual')}</small>
          ${incident.operationalInstruction ? `<div class="incident-resolution-box"><b>Que haria:</b> ${escapeHtml(incident.operationalInstruction)}</div>` : ''}
          ${responseWait}
          ${incident.operationalDecisionEligible ? `<small class="incident-template-chip">Regla: ${escapeHtml(incident.operationalDecisionRuleId || 'alta confianza')} · ${escapeHtml(incident.operationalDecisionConfidence || 0)}%</small>` : ''}
          ${incident.operationalActionStatus && !['not_applicable', 'verified', 'already_verified'].includes(incident.operationalActionStatus)
            ? `<small class="incident-alert">Estado operativo: ${escapeHtml(incident.operationalActionStatus)}${incident.operationalActionError ? ` · ${escapeHtml(incident.operationalActionError)}` : ''}</small>`
            : ''}
          ${incident.templateRecommendation ? `<small class="incident-template-chip">Plantilla sugerida: ${escapeHtml(incident.templateRecommendation)}</small>` : ''}
          ${incident.decisionTrace ? `<details class="incident-carrier-history"><summary>Auditar decision</summary>
            <article><b>Dropea</b><p>${escapeHtml(incident.decisionTrace.dropea?.selectedTransportEvent || incident.decisionTrace.dropea?.reason || 'Sin evidencia logistica detallada')}</p></article>
            <article><b>Chatby</b><p>${escapeHtml(incident.decisionTrace.chatby?.lastCustomerMessage || 'Sin respuesta entrante verificada del cliente')}</p></article>
            <article><b>Regla aplicada</b><p>${escapeHtml(incident.decisionTrace.rule?.reason || 'Revision manual')}</p></article>
          </details>` : ''}
          ${incident.chatbyUserNs ? `<small>Chatby: ${escapeHtml(incident.chatbyUserNs)}</small>` : ''}
        </td>
        <td>
          <button class="incident-feedback-button" data-incident-feedback="${escapeHtml(incident.orderId)}" data-incidence-id="${escapeHtml(incident.incidenceId || '')}" data-issue-type="${escapeHtml(type)}">
            Enseñar
          </button>
          <small class="incident-feedback-hint">Corrige al agente y queda guardado en memoria.</small>
          ${feedback}
        </td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="8">No hay incidencias pendientes para mostrar.</td></tr>';
}

function discountStatusLabel(status) {
  const value = String(status || '').toUpperCase();
  if (value === 'DISCOUNT_ACCEPTED') return ['Quiere el descuento', 'positive'];
  if (value === 'DISCOUNT_REJECTED') return ['No quiere el pedido', 'danger'];
  if (value === 'NO_RESPONSE') return ['Sin respuesta', 'warning'];
  if (value === 'OTHER_RESPONSE') return ['Otra respuesta', 'warning'];
  if (value === 'STATUS_UNAVAILABLE') return ['Pendiente de verificar', 'neutral'];
  return [value || 'Pendiente', 'neutral'];
}

function renderDiscounts() {
  const rows = (state.dashboard?.discounts || []).filter((item) => matchesQuery([
    item.orderId,
    item.customer,
    item.product,
    item.responseStatus
  ]));
  const accepted = rows.filter((item) => item.responseStatus === 'DISCOUNT_ACCEPTED').length;
  const rejected = rows.filter((item) => item.responseStatus === 'DISCOUNT_REJECTED').length;
  const unanswered = rows.filter((item) => item.responseStatus === 'NO_RESPONSE').length;
  const summary = document.querySelector('#discounts-summary');
  const table = document.querySelector('#discounts-table');
  if (summary) {
    summary.innerHTML = `
      <article class="order-summary-card neutral"><span>Enviadas</span><strong>${rows.length}</strong><small>Plantillas verificadas</small></article>
      <article class="order-summary-card positive"><span>Quieren descuento</span><strong>${accepted}</strong><small>BotÃ³n afirmativo</small></article>
      <article class="order-summary-card danger"><span>No quieren pedido</span><strong>${rejected}</strong><small>BotÃ³n de rechazo</small></article>
      <article class="order-summary-card warning"><span>Sin respuesta</span><strong>${unanswered}</strong><small>Sin mensaje ni acciÃ³n</small></article>
    `;
  }
  if (!table) return;
  table.innerHTML = rows.length ? rows.map((item) => {
    const [label, tone] = discountStatusLabel(item.responseStatus);
    return `
      <tr>
        <td><strong>#${escapeHtml(item.orderId)}</strong><small>${escapeHtml(item.mode === 'AUTHORIZED_SINGLE_TEST' ? 'Prueba autorizada' : 'AutomÃ¡tico')}</small></td>
        <td>${escapeHtml(item.customer)}</td>
        <td>${escapeHtml(item.product)}</td>
        <td>${money(item.originalAmount)}</td>
        <td><strong>${money(item.finalAmount)}</strong><small>Descuento: 5 â‚¬</small></td>
        <td>${formatDateTime(item.sentAt)}</td>
        <td><span class="pill ${tone}">${escapeHtml(label)}</span>${item.respondedAt ? `<small>${formatDateTime(item.respondedAt)}</small>` : ''}</td>
      </tr>
    `;
  }).join('') : '<tr><td colspan="7"><div class="empty-state">TodavÃ­a no hay descuentos enviados.</div></td></tr>';
}

function renderCampaigns() {
  const list = document.querySelector('#campaign-list');
  const campaigns = state.dashboard?.campaigns || [];
  const products = state.dashboard?.campaignProducts || [];
  const days = state.dashboard?.campaignDays || [];
  const meta = state.dashboard?.meta || {};
  if (!campaigns.length) {
    list.innerHTML = `<div class="empty-state">Todavia no hay datos de campanas Meta sincronizados.${meta.lastError ? ` Error actual: ${escapeHtml(meta.lastError)}` : ' Cuando se refresque Meta Dashboard, apareceran aqui.'}</div>`;
    return;
  }

  const sortedCampaigns = [...campaigns].sort((a, b) => {
    const roasDiff = Number(b.roasMeta || b.roasConfirmed || 0) - Number(a.roasMeta || a.roasConfirmed || 0);
    return roasDiff || Number(b.spend || 0) - Number(a.spend || 0);
  });
  const totalSpend = products.reduce((sum, product) => sum + Number(product.spend || 0), 0) || campaigns.reduce((sum, campaign) => sum + Number(campaign.spend || 0), 0);

  const indicatorFor = (campaign) => {
    const roas = Number(campaign.roasMeta || campaign.roasConfirmed || 0);
    const cpa = Number(campaign.cpaPixel || campaign.cpaConfirmed || 0);
    if (roas >= 5) return { label: 'Ganadora', tone: 'winner', note: 'Escalable' };
    if (roas >= 2.5) return { label: 'Correcta', tone: 'steady', note: 'Vigilar CPA' };
    if (roas > 0 || cpa > 0) return { label: 'Débil', tone: 'weak', note: 'Revisar creativo' };
    return { label: 'Sin ventas', tone: 'empty', note: 'Sin purchase' };
  };

  const productCards = products.length ? `
    <div class="meta-period">
      <span>Periodo: ${escapeHtml(meta.period || 'this_month')}</span>
      <strong>${escapeHtml(meta.spendSource || 'Meta')}</strong>
    </div>
    <div class="meta-product-grid">
      ${products.map((product) => `
        <div class="meta-product-card">
          <span>${escapeHtml(product.product)}</span>
          <strong>${money(product.spend)}</strong>
          <small>${product.campaigns} campana${product.campaigns === 1 ? '' : 's'} · ${product.purchases || 0} compras pixel</small>
          <div>
            <b>Peso inversión</b>
            <em>${totalSpend ? percent(product.spend / totalSpend) : '0%'}</em>
          </div>
          <div>
            <b>CPA pixel</b>
            <em>${product.cpaPixel ? money(product.cpaPixel) : 's/d'}</em>
          </div>
          <div>
            <b>ROAS Meta</b>
            <em>${product.roasMeta ? `${product.roasMeta.toFixed(2)}x` : 's/d'}</em>
          </div>
        </div>
      `).join('')}
    </div>
  ` : '';

  const campaignRows = sortedCampaigns.slice(0, 30).map((campaign, index) => {
    const roas = Number(campaign.roasMeta || campaign.roasConfirmed || 0);
    const indicator = indicatorFor(campaign);
    const spendWeight = totalSpend ? Number(campaign.spend || 0) / totalSpend : 0;
    return `
      <tr>
        <td>
          <div class="rank-cell">
            <span>#${index + 1}</span>
            <i class="campaign-indicator ${indicator.tone}"></i>
          </div>
        </td>
        <td>
          <strong>${escapeHtml(campaign.name || 'Campaña Meta')}</strong>
          <small>${escapeHtml([campaign.adsetName, campaign.adName].filter(Boolean).join(' / ') || 'Sin conjunto/anuncio')}</small>
        </td>
        <td><span class="product-tag">${escapeHtml(campaign.product || 'Sin producto')}</span></td>
        <td>${money(campaign.spend)}<small>${percent(spendWeight)} del gasto</small></td>
        <td>${campaign.impressions || 0}<small>${campaign.clicks || 0} clicks · CTR ${campaign.ctr ? `${Number(campaign.ctr).toFixed(2)}%` : 's/d'}</small></td>
        <td>${campaign.purchases || 0}<small>CPA ${campaign.cpaPixel ? money(campaign.cpaPixel) : 's/d'}</small></td>
        <td><strong>${roas ? `${roas.toFixed(2)}x` : 's/d'}</strong><small>Valor ${campaign.purchaseValue ? money(campaign.purchaseValue) : 's/d'}</small></td>
        <td><span class="status-badge ${indicator.tone}">${indicator.label}</span><small>${indicator.note}</small></td>
      </tr>
    `;
  }).join('');

  list.innerHTML = `
    ${productCards}
    <div class="meta-table-card">
      <div class="meta-table-head">
        <div>
          <strong>Ranking de campañas y anuncios</strong>
          <span>Ordenado por ROAS Meta y gasto. Cada fila incluye indicador de rendimiento.</span>
        </div>
        <span>${sortedCampaigns.length} filas</span>
      </div>
      <div class="table-wrap meta-table-wrap">
        <table class="meta-table">
          <thead>
            <tr>
              <th></th>
              <th>Campaña / anuncio</th>
              <th>Producto</th>
              <th>Gasto</th>
              <th>Volumen / tráfico</th>
              <th>Compras</th>
              <th>ROAS</th>
              <th>Indicador</th>
            </tr>
          </thead>
          <tbody>${campaignRows}</tbody>
        </table>
      </div>
    </div>
  `;
}

function renderCampaignsV2() {
  const list = document.querySelector('#campaign-list');
  const campaigns = state.dashboard?.campaigns || [];
  const products = state.dashboard?.campaignProducts || [];
  const meta = state.dashboard?.meta || {};
  if (!list) return;

  if (!campaigns.length) {
    list.innerHTML = `<div class="empty-state">Todavia no hay datos de campanas Meta sincronizados.${meta.lastError ? ` Error actual: ${escapeHtml(meta.lastError)}` : ' Cuando se refresque Meta Dashboard, apareceran aqui.'}</div>`;
    return;
  }

  const sortedCampaigns = [...campaigns].sort((a, b) => (
    String(b.day || b.periodStart || '').localeCompare(String(a.day || a.periodStart || ''))
    || Number(b.spend || 0) - Number(a.spend || 0)
    || Number(b.roasMeta || b.roasConfirmed || 0) - Number(a.roasMeta || a.roasConfirmed || 0)
  ));
  const totals = meta.totals || {};
  const totalSpend = products.reduce((sum, product) => sum + Number(product.spend || 0), 0)
    || campaigns.reduce((sum, campaign) => sum + Number(campaign.spend || 0), 0);

  const indicatorFor = (campaign) => {
    const roas = Number(campaign.roasMeta || campaign.roasConfirmed || 0);
    const cpa = Number(campaign.cpaPixel || campaign.cpaConfirmed || 0);
    const spend = Number(campaign.spend || 0);
    if (roas >= 5) return { label: 'Escalar', tone: 'winner', note: 'ROAS alto. Subir presupuesto poco a poco si mantiene CPA.' };
    if (roas >= 2.5) return { label: 'Mantener', tone: 'steady', note: 'Funciona. Vigilar CPA, frecuencia y margen.' };
    if (roas > 0 || cpa > 0) return { label: 'Optimizar', tone: 'weak', note: 'Hay senales, pero necesita revisar creativo, oferta o publico.' };
    if (spend >= 15) return { label: 'Pausar/Revisar', tone: 'empty', note: 'Gasto sin compras pixel. No seguir invirtiendo a ciegas.' };
    return { label: 'Aprendiendo', tone: 'empty', note: 'Aun sin volumen suficiente para decidir.' };
  };

  const dayIndicator = (day) => {
    const roas = Number(day.roasMeta || 0);
    const spend = Number(day.spend || 0);
    const purchases = Number(day.purchases || 0);
    if (roas >= 5 && purchases > 0) return { label: 'Día ganador', tone: 'winner', note: 'Escalar aprendizajes de creativos/campañas.' };
    if (roas >= 2.5 && purchases > 0) return { label: 'Día rentable', tone: 'steady', note: 'Mantener y vigilar CPA.' };
    if (spend >= 15 && purchases === 0) return { label: 'Día flojo', tone: 'empty', note: 'Gasto sin compras. Revisar antes de invertir más.' };
    if (spend > 0) return { label: 'Día a optimizar', tone: 'weak', note: 'Hay gasto, pero el rendimiento no es fuerte.' };
    return { label: 'Sin inversión', tone: 'empty', note: 'Meta no reporta gasto ese día.' };
  };

  const activeDays = days.filter((day) => Number(day.spend || 0) > 0 || Number(day.purchases || 0) > 0);
  const bestDays = [...activeDays]
    .sort((a, b) => Number(b.roasMeta || 0) - Number(a.roasMeta || 0) || Number(b.purchaseValue || 0) - Number(a.purchaseValue || 0))
    .slice(0, 3);
  const worstDays = [...activeDays]
    .filter((day) => Number(day.spend || 0) >= 1)
    .sort((a, b) => Number(a.roasMeta || 0) - Number(b.roasMeta || 0) || Number(b.spend || 0) - Number(a.spend || 0))
    .slice(0, 3);

  const metaSummary = `
    <div class="meta-live-summary">
      <div class="meta-source-card ${meta.live ? 'is-live' : 'is-fallback'}">
        <span>${meta.live ? 'Dato real en vivo' : 'Dato guardado'}</span>
        <strong>${escapeHtml(meta.spendSource || 'Meta')}</strong>
        <small>Desglose diario · periodo ${escapeHtml(meta.period || 'this_month')} · actualizado ${formatDateTime(meta.updatedAt)} · refresco cada 12h</small>
      </div>
      <div><span>Gasto</span><strong>${money(totals.spend ?? totalSpend)}</strong><small>${meta.rows || campaigns.length} filas leidas</small></div>
      <div><span>Compras pixel</span><strong>${totals.purchases ?? campaigns.reduce((sum, item) => sum + Number(item.purchases || 0), 0)}</strong><small>Segun Meta Ads</small></div>
      <div><span>ROAS Meta</span><strong>${totals.roasMeta ? `${Number(totals.roasMeta).toFixed(2)}x` : 's/d'}</strong><small>Valor compra / gasto</small></div>
      <div><span>CPC medio</span><strong>${totals.cpc ? money(totals.cpc) : 's/d'}</strong><small>${numberCompact(totals.clicks || 0)} clicks</small></div>
    </div>
  `;

  const dayCards = activeDays.length ? `
    <div class="meta-day-board">
      <section>
        <div class="meta-day-title"><strong>Mejores días</strong><span>ROAS y valor de compra</span></div>
        ${bestDays.map((day) => {
          const indicator = dayIndicator(day);
          return `
            <article class="meta-day-card ${indicator.tone}">
              <div><strong>${escapeHtml(day.day)}</strong><span class="status-badge ${indicator.tone}">${indicator.label}</span></div>
              <p>${money(day.spend)} gastados · ${day.purchases || 0} compras · ROAS ${day.roasMeta ? `${Number(day.roasMeta).toFixed(2)}x` : 's/d'}</p>
              <small>Mejor campaña: ${escapeHtml(day.bestCampaign || 'sin dato')}</small>
            </article>
          `;
        }).join('')}
      </section>
      <section>
        <div class="meta-day-title"><strong>Días a revisar</strong><span>Gasto con bajo retorno</span></div>
        ${worstDays.map((day) => {
          const indicator = dayIndicator(day);
          return `
            <article class="meta-day-card ${indicator.tone}">
              <div><strong>${escapeHtml(day.day)}</strong><span class="status-badge ${indicator.tone}">${indicator.label}</span></div>
              <p>${money(day.spend)} gastados · ${day.purchases || 0} compras · ROAS ${day.roasMeta ? `${Number(day.roasMeta).toFixed(2)}x` : '0.00x'}</p>
              <small>${escapeHtml(indicator.note)}</small>
            </article>
          `;
        }).join('')}
      </section>
    </div>
  ` : '';
  const visibleDayCards = '';

  const productCards = products.length ? `
    <div class="meta-product-grid">
      ${products.map((product) => `
        <div class="meta-product-card">
          <span>${escapeHtml(product.product)}</span>
          <strong>${money(product.spend)}</strong>
          <small>${product.campaigns} campana${product.campaigns === 1 ? '' : 's'} - ${product.purchases || 0} compras pixel</small>
          <div><b>Peso inversion</b><em>${totalSpend ? percent(product.spend / totalSpend) : '0%'}</em></div>
          <div><b>CPA pixel</b><em>${product.cpaPixel ? money(product.cpaPixel) : 's/d'}</em></div>
          <div><b>ROAS Meta</b><em>${product.roasMeta ? `${product.roasMeta.toFixed(2)}x` : 's/d'}</em></div>
          <div><b>CTR</b><em>${product.ctr ? `${(product.ctr * 100).toFixed(2)}%` : 's/d'}</em></div>
        </div>
      `).join('')}
    </div>
  ` : '';

  const campaignRows = sortedCampaigns.slice(0, 40).map((campaign, index) => {
    const roas = Number(campaign.roasMeta || campaign.roasConfirmed || 0);
    const indicator = indicatorFor(campaign);
    const spendWeight = totalSpend ? Number(campaign.spend || 0) / totalSpend : 0;
    return `
      <tr>
        <td><div class="rank-cell"><span>#${index + 1}</span><i class="campaign-indicator ${indicator.tone}"></i></div></td>
        <td>
          <strong>${escapeHtml(campaign.name || 'Campana Meta')}</strong>
          <small>${escapeHtml(campaign.day || campaign.periodStart || 'Sin fecha')} · ${escapeHtml([campaign.adsetName, campaign.adName].filter(Boolean).join(' / ') || 'Sin conjunto/anuncio')}</small>
        </td>
        <td><span class="product-tag">${escapeHtml(campaign.product || 'Sin producto')}</span></td>
        <td>${money(campaign.spend)}<small>${percent(spendWeight)} del gasto</small></td>
        <td>${numberCompact(campaign.impressions || 0)}<small>${campaign.clicks || 0} clicks - CTR ${campaign.ctr ? `${Number(campaign.ctr).toFixed(2)}%` : 's/d'}</small></td>
        <td>${campaign.purchases || 0}<small>CPA ${campaign.cpaPixel ? money(campaign.cpaPixel) : 's/d'}</small></td>
        <td><strong>${roas ? `${roas.toFixed(2)}x` : 's/d'}</strong><small>Valor ${campaign.purchaseValue ? money(campaign.purchaseValue) : 's/d'}</small></td>
        <td><span class="status-badge ${indicator.tone}">${indicator.label}</span><small>${escapeHtml(indicator.note)}</small></td>
      </tr>
    `;
  }).join('');

  list.innerHTML = `
    ${metaSummary}
    ${visibleDayCards}
    ${productCards}
    <div class="meta-table-card">
      <div class="meta-table-head">
        <div>
          <strong>Campañas y anuncios por día</strong>
          <span>Datos diarios reales desde Meta. Los días sin gasto no aparecen como inversión.</span>
        </div>
        <span>${sortedCampaigns.length} filas</span>
      </div>
      <div class="table-wrap meta-table-wrap">
        <table class="meta-table">
          <thead>
            <tr>
              <th></th>
              <th>Campana / anuncio</th>
              <th>Producto</th>
              <th>Gasto</th>
              <th>Volumen / trafico</th>
              <th>Compras</th>
              <th>ROAS</th>
              <th>Accion</th>
            </tr>
          </thead>
          <tbody>${campaignRows}</tbody>
        </table>
      </div>
    </div>
  `;
}

function renderDecisions() {
  const list = document.querySelector('#agent-list');
  const decisions = state.dashboard?.decisions || [];
  if (!decisions.length) {
    list.innerHTML = '<div class="empty-state">No hay decisiones del agente cargadas todavia.</div>';
    return;
  }

  list.innerHTML = decisions.slice(0, 12).map((decision) => `
    <div class="decision">
      <div>
        <strong>#${escapeHtml(decision.orderId)} · ${escapeHtml(decision.action || 'decision')}</strong>
        <span>${escapeHtml(decision.reason || decision.message || 'Sin motivo registrado')}</span>
      </div>
      <b>${decision.confidence ?? '-'}%</b>
    </div>
  `).join('');
}

function renderAgentOperationalHealth() {
  const scoreboard = document.querySelector('#agent-scoreboard');
  const signalMap = document.querySelector('#agent-signal-map');
  if (!scoreboard || !signalMap) return;

  const orders = state.dashboard?.orders || [];
  const learning = state.dashboard?.learning || {};
  const feedback = state.dashboard?.feedback || [];
  const memory = state.dashboard?.agentMemory || [];
  const sources = state.dashboard?.sources || [];
  const connectionVault = state.dashboard?.connectionVault || {};
  const connectedSources = sources.filter((source) => source.ok).length;
  const totalSources = sources.length || 1;
  const confirmed = countOrdersByFilter(orders, 'confirm');
  const needsAttention = countOrdersByFilter(orders, 'address') + countOrdersByFilter(orders, 'issue') + countOrdersByFilter(orders, 'review');

  scoreboard.innerHTML = [
    { label: 'Memoria activa', value: memory.length || learning.memoryCount || 0, detail: 'Reglas guardadas' },
    { label: 'Feedback recibido', value: feedback.length || learning.feedbackCount || 0, detail: 'Correcciones aplicadas' },
    { label: 'Listos para confirmar', value: confirmed, detail: 'Con señal clara' },
    { label: 'Requieren atención', value: needsAttention, detail: 'Dirección, incidencia o revisión' },
    { label: 'Conexiones OK', value: `${connectedSources}/${totalSources}`, detail: connectionVault.lastHealthcheckAt ? `Última revisión: ${connectionVault.lastHealthcheckAt}` : 'Según lectura actual' }
  ].map((item) => `
    <article>
      <span>${escapeHtml(item.label)}</span>
      <strong>${escapeHtml(item.value)}</strong>
      <small>${escapeHtml(item.detail)}</small>
    </article>
  `).join('');

  const signals = [
    { key: 'confirm', label: 'Confirmación clara', detail: 'Confirmar en Dropea si el modo real está activo.', tone: 'positive' },
    { key: 'address', label: 'Cambio de dirección', detail: 'No confirmar. Corregir datos y dejar pendiente.', tone: 'warning' },
    { key: 'issue', label: 'Ausente o incidencia', detail: 'Coordinar entrega o revisar incidencia antes de actuar.', tone: 'warning' },
    { key: 'blocked', label: 'Rechazo/cancelación', detail: 'No confirmar y registrar motivo.', tone: 'danger' },
    { key: 'review', label: 'Duda o manual', detail: 'Esperar señal clara o revisión humana.', tone: 'neutral' }
  ];

  signalMap.innerHTML = signals.map((signal) => `
    <article class="${signal.tone}">
      <strong>${escapeHtml(signal.label)}</strong>
      <span>${escapeHtml(countOrdersByFilter(orders, signal.key))} pedidos</span>
      <small>${escapeHtml(signal.detail)}</small>
    </article>
  `).join('');
}

function renderAgentDiagnostics() {
  const list = document.querySelector('#agent-list');
  if (!list) return;
  const orders = state.dashboard?.orders || [];
  const diagnosedOrders = orders
    .filter((order) => order.agentRecommendedLabel || order.customerSignalLabel || order.agentAction || order.status)
    .slice(0, 14);

  if (!diagnosedOrders.length) {
    list.innerHTML = '<div class="empty-state">No hay pedidos diagnosticados por el agente todavia.</div>';
    return;
  }

  list.innerHTML = diagnosedOrders.map((order) => `
    <div class="decision agent-decision-card ${escapeHtml(order.agentDecisionTone || 'neutral')}">
      <div>
        <strong>#${escapeHtml(order.orderId)} · ${escapeHtml(order.agentRecommendedLabel || 'Sin accion')}</strong>
        <span><b>Señal:</b> ${escapeHtml(order.customerSignalLabel || 'Sin señal')} · ${escapeHtml(order.customerSignalDetail || '')}</span>
        <span><b>Porque:</b> ${escapeHtml(order.agentDecisionExplanation || order.agentReason || order.note || 'Sin explicacion registrada')}</span>
        <span><b>Siguiente paso:</b> ${escapeHtml(order.agentNextStep || 'Esperar nueva informacion')}</span>
      </div>
      <b>${order.agentUsefulConfidence ?? order.agentConfidence ?? '-'}%</b>
    </div>
  `).join('');
}

function renderFeedback() {
  const list = document.querySelector('#feedback-list');
  if (!list) return;
  const feedback = state.dashboard?.feedback || [];
  if (!feedback.length) {
    list.innerHTML = '<div class="empty-state">Todavia no has enviado feedback al agente desde el dashboard.</div>';
    return;
  }

  list.innerHTML = feedback.slice(0, 12).map((item) => `
    <div class="decision">
      <div>
        <strong>#${escapeHtml(item.orderId)} · ${escapeHtml(item.verdict)}</strong>
        <span>${escapeHtml(item.correction || item.note || 'Correccion registrada')}</span>
      </div>
      <b>OK</b>
    </div>
  `).join('');
}

function renderProductsLegacy() {
  const grid = document.querySelector('#product-cards');
  const products = state.dashboard?.products || [];
  grid.innerHTML = products.map((product) => `
    <div class="product-card">
      <span>${escapeHtml(product.status || 'Activo')}</span>
      <strong>${escapeHtml(product.name)}</strong>
      <p>${money(product.price)} · ${product.orders || 0} pedidos · margen ${product.margin ?? '-'}%</p>
    </div>
  `).join('');
  renderBusinessManager();
}

function renderBusinessManager() {
  const panel = document.querySelector('#business-manager-report');
  if (!panel) return;
  const manager = state.dashboard?.businessManager;
  if (!manager) {
    panel.innerHTML = '<div class="empty-state">Todavia no hay informe del manager del negocio.</div>';
    return;
  }

  const kpis = manager.kpis || {};
  const campaignActions = manager.campaignActions || [];
  const reports = manager.productReports || [];
  panel.innerHTML = `
    <div class="business-hero">
      <div>
        <span>${escapeHtml(manager.role || 'Marketing y producto')}</span>
        <strong>${escapeHtml(manager.name || 'Manager del negocio')}</strong>
        <p>${escapeHtml(manager.summary || '')}</p>
        <small>Actualizado ${escapeHtml(formatDateTime(manager.updatedAt))}${manager.lastRequestedAt ? ` · ultimo informe pedido ${escapeHtml(formatDateTime(manager.lastRequestedAt))}` : ''}</small>
      </div>
      <div class="business-next">
        <span>Siguiente movimiento</span>
        <strong>${escapeHtml(manager.recommendedNextMove || 'Esperar mas datos')}</strong>
      </div>
    </div>

    <div class="business-kpis">
      <div><span>Gasto Meta</span><strong>${money(kpis.metaSpend)}</strong></div>
      <div><span>Compras pixel</span><strong>${escapeHtml(kpis.metaPurchases ?? 0)}</strong></div>
      <div><span>ROAS Meta</span><strong>${Number(kpis.metaRoas || 0).toFixed(2)}x</strong></div>
      <div><span>Beneficio final</span><strong>${money(kpis.businessProfit)}</strong></div>
    </div>

    <div class="business-columns">
      <section>
        <div class="business-section-title">
          <span>Meta Ads</span>
          <strong>Acciones para escalar</strong>
        </div>
        <div class="business-action-list">
          ${campaignActions.length ? campaignActions.map((item) => `
            <article class="business-action ${escapeHtml(item.tone || 'neutral')}">
              <div>
                <span>${escapeHtml(item.label || 'Analizar')}</span>
                <strong>${escapeHtml(item.campaign || 'Campana Meta')}</strong>
                <small>${escapeHtml(item.product || 'Sin producto')} · ${escapeHtml(item.day || 'sin fecha')}</small>
              </div>
              <b>${Number(item.roas || 0).toFixed(2)}x</b>
              <p>${escapeHtml(item.action || '')}</p>
            </article>
          `).join('') : '<div class="empty-state">Sin campanas suficientes para recomendar escalado.</div>'}
        </div>
      </section>

      <section>
        <div class="business-section-title">
          <span>Radar beauty Espana</span>
          <strong>Productos potenciales</strong>
        </div>
        <div class="business-product-list">
          ${reports.map((item) => `
            <article class="business-product-card">
              <div class="business-product-head">
                <div>
                  <span>${escapeHtml(item.category)}</span>
                  <strong>${escapeHtml(item.name)}</strong>
                </div>
                <b>${escapeHtml(item.score)}</b>
              </div>
              <p>${escapeHtml(item.why)}</p>
              <div class="business-tags">
                <span>${escapeHtml(item.priority)}</span>
                <span>${escapeHtml(item.expectedTicket)}</span>
                <span>${escapeHtml(item.sourceType)}</span>
              </div>
              <small><b>Cliente:</b> ${escapeHtml(item.targetAudience)}</small>
              <small><b>Proveedor:</b> ${escapeHtml(item.supplierTarget)}</small>
              <small><b>Angulos Meta:</b> ${escapeHtml((item.metaAngles || []).join(' · '))}</small>
              <div class="business-card-actions">
                <a href="${escapeHtml(item.alibabaSearch)}" target="_blank" rel="noopener">Buscar en Alibaba</a>
                <span>${escapeHtml((item.validation || []).slice(0, 2).join(' · '))}</span>
              </div>
            </article>
          `).join('')}
        </div>
      </section>
    </div>

    <div class="business-safeguards">
      ${(manager.safeguards || []).map((item) => `<span>${escapeHtml(item)}</span>`).join('')}
    </div>
  `;
}

function renderProducts() {
  const grid = document.querySelector('#product-cards');
  const products = state.dashboard?.products || [];
  grid.innerHTML = products.map((product) => {
    const conversion = product.conversionRate === null || product.conversionRate === undefined ? 's/d' : percent(product.conversionRate);
    const metaCtr = product.metaCtr ? `${Number(product.metaCtr).toFixed(2)}%` : 's/d';
    return `
      <article class="product-card product-card-pro">
        <div class="product-card-top">
          <span>${escapeHtml(product.status || 'Activo')}</span>
          <b>${escapeHtml(product.recommendation || 'Sin recomendacion')}</b>
        </div>
        <strong>${escapeHtml(product.name)}</strong>
        <p>${money(product.price)} precio base · margen estimado ${product.margin ?? '-'}%</p>
        <div class="product-metric-grid">
          <div><span>Pedidos</span><strong>${escapeHtml(product.orders || 0)}</strong></div>
          <div><span>Confirmados</span><strong>${escapeHtml(product.confirmedOrders || 0)}</strong></div>
          <div><span>Ingresos</span><strong>${money(product.revenue)}</strong></div>
          <div><span>Conversion</span><strong>${conversion}</strong></div>
        </div>
        <div class="product-meta-strip">
          <div><span>Meta Ads</span><strong>${money(product.metaSpend)}</strong><small>gasto</small></div>
          <div><span>ROAS</span><strong>${Number(product.metaRoas || 0).toFixed(2)}x</strong><small>pixel Meta</small></div>
          <div><span>CPA</span><strong>${product.metaCpa ? money(product.metaCpa) : 's/d'}</strong><small>${product.metaPurchases || 0} compras</small></div>
          <div><span>CTR</span><strong>${metaCtr}</strong><small>${product.metaClicks || 0} clicks</small></div>
        </div>
        <div class="product-bottom-line">
          <span>Contribucion estimada: ${money(product.contribution)}</span>
          <span>${product.metaImpressions ? `${numberCompact(product.metaImpressions)} impresiones` : 'Sin impresiones Meta'}</span>
        </div>
      </article>
    `;
  }).join('');
  renderBusinessManager();
}

function renderResearch() {
  const list = document.querySelector('#research-list');
  const research = state.dashboard?.research || [];
  list.innerHTML = research.map((item) => `
    <div class="research-item">
      <div>
        <strong>${escapeHtml(item.name)}</strong>
        <span>${escapeHtml(item.basis || 'Sin fuente')} · ${escapeHtml(item.note)}</span>
      </div>
      <b>${item.score}</b>
    </div>
  `).join('');
}

function renderSources() {
  const list = document.querySelector('#sources-list');
  if (!list) return;
  const sources = state.dashboard?.sources || [];
  const vault = state.dashboard?.connectionVault || {};
  const envGroups = Object.entries(vault.envVars || {});
  const sourceCards = sources.map((source) => `
    <div class="source-item ${source.ok ? 'ok' : 'bad'}">
      <span></span>
      <div>
        <strong>${escapeHtml(source.name)}</strong>
        <small>${source.ok ? 'Conectado' : escapeHtml(source.error || 'Fuente pendiente de sincronización')}</small>
      </div>
    </div>
  `).join('');
  const vaultCards = envGroups.map(([service, values]) => {
    const details = Object.entries(values).map(([key, value]) => `
      <small><b>${escapeHtml(key)}:</b> ${escapeHtml(value)}</small>
    `).join('');
    return `
      <div class="source-item vault">
        <span></span>
        <div>
          <strong>${escapeHtml(service)}</strong>
          ${details}
        </div>
      </div>
    `;
  }).join('');

  list.innerHTML = `
    ${sourceCards}
    ${vaultCards}
    ${vault.storagePolicy ? `<div class="source-policy">${escapeHtml(vault.storagePolicy)} Runbook: ${escapeHtml(vault.runbook || 'pendiente')}.</div>` : ''}
  `;
}

function renderSystem() {
  const system = state.dashboard?.system || {};
  const learning = state.dashboard?.learning || {};
  const render = system.render || {};
  setText('#system-agent-mode', render.agentDryRun ? 'Simulacion' : 'Modo real');
  setText('#system-agent-status', render.agentEnabled ? 'Agente activo' : 'Agente apagado');
  setText('#system-last-cycle', render.lastAutomationCycleAt || system.localState?.lastAutomationCycleAt || 'Sin dato');
  setText('#system-pending', String(render.orders?.pending ?? state.dashboard?.kpis?.pending ?? 0));
  setText('#learning-note', `${learning.feedbackCount || 0} correcciones guardadas. ${learning.mode || ''}`);
}

function renderKpis() {
  const kpis = state.dashboard?.kpis || {};
  const report = state.financeReport;
  const exactProfit = report?.totals?.exactNetProfit ?? null;
  setText('#kpi-orders', String(kpis.orders ?? 0));
  setText('#kpi-confirm-rate', percent(kpis.confirmRate));
  setText('#kpi-revenue', report ? money(report.totals?.revenue) : '—');
  setText('#kpi-profit', money(exactProfit));
  setText('#kpi-spend', report?.coverage?.meta ? money(report.totals?.metaSpend) : '—');
  setText('#kpi-review', String(kpis.manualReview ?? 0));
  setText('#kpi-profit-note', exactProfit === null
    ? 'Pendiente de fuentes o costes completos'
    : `${report?.statusLabel || 'Periodo calculado'} · ${exactProfit >= 0 ? 'operación en positivo' : 'operación en negativo'}`);
  setText('#hero-orders', String(kpis.orders ?? 0));
  setText('#hero-confirm-rate', percent(kpis.confirmRate));
  setText('#hero-profit', money(exactProfit));

  const profitCard = document.querySelector('#profit-card');
  if (profitCard) {
    profitCard.classList.toggle('positive', exactProfit !== null && exactProfit >= 0);
    profitCard.classList.toggle('danger', exactProfit !== null && exactProfit < 0);
  }
}

function renderFinanceCharts(finance) {
  const trend = document.querySelector('#finance-trend-chart');
  const costs = document.querySelector('#finance-cost-chart');
  const volume = document.querySelector('#finance-volume-chart');
  const totals = finance?.totals || {};
  const days = [...(finance?.days || [])].sort((a, b) => a.day.localeCompare(b.day));

  if (trend) {
    if (!days.length) {
      trend.innerHTML = '<div class="empty-state">No hay datos diarios para representar.</div>';
    } else {
      const width = 760;
      const height = 228;
      const pad = { left: 45, right: 14, top: 16, bottom: 30 };
      const values = days.flatMap((day) => [day.realRevenue, day.totalCosts, day.netProfit]).filter((value) => Number.isFinite(Number(value)));
      const min = Math.min(0, ...values.map(Number));
      const max = Math.max(1, ...values.map(Number));
      const range = max - min || 1;
      const x = (index) => pad.left + (index * (width - pad.left - pad.right)) / Math.max(1, days.length - 1);
      const y = (value) => pad.top + ((max - Number(value || 0)) * (height - pad.top - pad.bottom)) / range;
      const points = (field) => days.map((day, index) => `${x(index).toFixed(1)},${y(day[field]).toFixed(1)}`).join(' ');
      const zeroY = y(0).toFixed(1);
      const ticks = Array.from({ length: 5 }, (_, index) => min + ((max - min) * index) / 4);
      const grid = ticks.map((value) => {
        const tickY = y(value).toFixed(1);
        return `<line x1="${pad.left}" y1="${tickY}" x2="${width - pad.right}" y2="${tickY}" stroke="rgba(38,57,75,.09)" />
          <text x="${pad.left - 7}" y="${Number(tickY) + 4}" text-anchor="end">${escapeHtml(new Intl.NumberFormat('es-ES', { notation: 'compact', maximumFractionDigits: 1 }).format(value))} €</text>`;
      }).join('');
      const labels = days.map((day, index) => index % 5 === 0 || index === days.length - 1
        ? `<text x="${x(index).toFixed(1)}" y="218" text-anchor="middle">${escapeHtml(day.day.slice(8))}</text>`
        : '').join('');
      trend.innerHTML = `
        <div class="finance-chart-legend">
          <span><i style="background:#0d8b8f"></i>Facturación real</span>
          <span><i style="background:#e86d57"></i>Gastos totales</span>
          <span><i style="background:#26394b"></i>Beneficio neto</span>
        </div>
        <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Evolución diaria de facturación, gastos y beneficio">
          <g fill="#65727f" font-family="Trebuchet MS, sans-serif" font-size="10">${grid}</g>
          <line x1="${pad.left}" y1="${zeroY}" x2="${width - pad.right}" y2="${zeroY}" stroke="rgba(38,57,75,.2)" stroke-width="1" />
          <polyline points="${points('realRevenue')}" fill="none" stroke="#0d8b8f" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" />
          <polyline points="${points('totalCosts')}" fill="none" stroke="#e86d57" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" />
          <polyline points="${points('netProfit')}" fill="none" stroke="#26394b" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" />
          <g fill="#65727f" font-family="Trebuchet MS, sans-serif" font-size="11">${labels}</g>
        </svg>`;
    }
  }

  if (volume) {
    const max = Math.max(1, ...days.flatMap((day) => [Number(day.delivered || 0), Number(day.returned || 0)]));
    volume.innerHTML = days.length
      ? `<div class="finance-chart-legend"><span><i style="background:#0d8b8f"></i>Entregados</span><span><i style="background:#e86d57"></i>Devueltos</span></div>
        <div class="finance-volume-bars">${days.map((day) => `
          <div class="finance-volume-day" title="${escapeHtml(day.day)} · ${day.delivered || 0} entregados · ${day.returned || 0} devueltos">
            <div class="finance-volume-columns">
              <span class="is-delivered" style="height:${Math.max(2, (Number(day.delivered || 0) / max) * 100).toFixed(1)}%"></span>
              <span class="is-returned" style="height:${Math.max(2, (Number(day.returned || 0) / max) * 100).toFixed(1)}%"></span>
            </div>
            <small>${escapeHtml(day.day.slice(8))}</small>
          </div>`).join('')}</div>`
      : '<div class="empty-state">No hay actividad diaria para representar.</div>';
  }

  if (costs) {
    const rows = [
      ['Producto', totals.productCost],
      ['Envío (ida)', totals.outboundShippingCost],
      ['Tarifa COD', totals.codCost],
      ['Fulfillment', totals.outboundFulfillmentCost],
      ['Devoluciones', totals.returnCost],
      ['Publicidad', totals.metaSpend],
      ['Gastos fijos', totals.fixedCosts]
    ];
    const max = Math.max(1, ...rows.map(([, value]) => Number(value) || 0));
    const totalCosts = Number(totals.totalCosts || 0);
    costs.innerHTML = rows.map(([label, value]) => `
      <div class="finance-cost-row">
        <span>${escapeHtml(label)}<small>${totalCosts ? percentValue((Number(value || 0) / totalCosts) * 100) : '—'}</small></span>
        <div class="finance-cost-bar"><span style="width:${Math.max(0, Math.min(100, (Number(value || 0) / max) * 100)).toFixed(1)}%"></span></div>
        <b>${money(value)}</b>
      </div>`).join('');
  }
}

const FINANCE_COLUMNS = [
  ['day', 'Fecha', 'text'], ['created', 'Pedidos creados', 'number'], ['confirmed', 'Confirmados', 'number'],
  ['rejected', 'Rechazados', 'number'], ['sent', 'Enviados', 'number'], ['inTransit', 'En tránsito', 'number'],
  ['delivered', 'Pedidos entregados', 'number'], ['deliveredUnits', 'Unidades entregadas', 'number'],
  ['returned', 'Pedidos devueltos', 'number'], ['returnedUnits', 'Unidades devueltas', 'number'], ['incidentOrders', 'Pedidos con incidencia', 'number'],
  ['realRevenue', 'Facturación', 'money'], ['productCost', 'Coste producto', 'money'], ['outboundShippingCost', 'Coste envío', 'money'],
  ['outboundFulfillmentCost', 'Coste fulfillment', 'money'], ['codCost', 'Coste COD', 'money'],
  ['returnCost', 'Coste devoluciones', 'money'], ['dropeaAdjustmentsCost', 'IVA / ajustes Dropea', 'money'], ['metaSpend', 'Publicidad', 'money'], ['fixedCosts', 'Gastos fijos', 'money'],
  ['oneOffCosts', 'Gastos puntuales', 'money'], ['otherCosts', 'Otros costes', 'money'], ['totalCosts', 'Costes totales', 'money'],
  ['contributionMargin', 'Margen contribución', 'money'], ['netProfit', 'Beneficio neto', 'money'],
  ['marginPercent', 'Margen %', 'percent'], ['roiPercent', 'ROI', 'percent'], ['roas', 'ROAS', 'ratio']
];

function financeValue(value, type) {
  if (type === 'money') return money(value);
  if (type === 'percent') return percentValue(value);
  if (type === 'ratio') return Number.isFinite(Number(value)) ? `${Number(value).toFixed(2)}x` : '—';
  return value ?? '—';
}

function deltaText(delta, { invert = false, percentOnly = false } = {}) {
  if (!financeCompareInput?.checked || !delta || delta.absolute === null) return 'Comparación desactivada';
  const sign = Number(delta.absolute) > 0 ? '+' : '';
  const trend = Number(delta.absolute) === 0 ? 'Sin cambio' : `${invert ? (Number(delta.absolute) > 0 ? '▲ más coste' : '▼ menos coste') : (Number(delta.absolute) > 0 ? '▲' : '▼')}`;
  if (percentOnly) return `${trend} ${delta.percent === null ? '—' : percentValue(Math.abs(delta.percent))}`;
  return `${trend} ${sign}${money(delta.absolute)} · ${delta.percent === null ? 'base 0' : percentValue(Math.abs(delta.percent))}`;
}

const financeChartInstances = new Map();

function financeChart(node, option) {
  if (!node) return null;
  if (!window.echarts) {
    node.innerHTML = '<div class="empty-state">El motor gráfico no se ha podido cargar.</div>';
    return null;
  }
  const existing = financeChartInstances.get(node.id);
  const chart = existing && !existing.isDisposed() ? existing : window.echarts.init(node, null, { renderer: 'canvas' });
  financeChartInstances.set(node.id, chart);
  chart.setOption(option, { notMerge: true, lazyUpdate: false });
  return chart;
}

function euroAxis(value) {
  return new Intl.NumberFormat('es-ES', { notation: 'compact', maximumFractionDigits: 1 }).format(value) + ' €';
}

function sparkline(node, values, color = '#1677ff') {
  const clean = values.map((value) => Number.isFinite(Number(value)) ? Number(value) : null);
  if (clean.filter((value) => value !== null).length < 2) { node.replaceChildren(); return; }
  financeChart(node, {
    animation: false, grid: { left: 0, right: 0, top: 3, bottom: 0 }, xAxis: { type: 'category', show: false, data: clean.map((_, index) => index) },
    yAxis: { type: 'value', show: false, scale: true }, tooltip: { show: false },
    series: [{ type: 'line', data: clean, symbol: 'none', smooth: .25, lineStyle: { color, width: 2 }, areaStyle: { color: window.echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: `${color}33` }, { offset: 1, color: `${color}00` }]) } }]
  });
}

function renderExecutiveCharts(finance) {
  const days = finance.days || [];
  document.querySelectorAll('[data-finance-spark]').forEach((node) => {
    const field = node.dataset.financeSpark;
    sparkline(node, days.map((day) => day[field]), node.closest('.is-primary') ? '#8be3d3' : '#1677ff');
  });
  const trend = document.querySelector('#finance-trend-chart');
  if (trend) {
    const active = new Set([...document.querySelectorAll('[data-finance-series]:checked')].map((item) => item.dataset.financeSeries));
    if (!days.length || !active.size) trend.innerHTML = '<div class="empty-state">No hay datos completos para representar.</div>';
    else financeChart(trend, {
      animationDuration: 350, color: ['#1677ff', '#f97316', '#0f766e'], grid: { left: 64, right: 24, top: 38, bottom: 42 },
      legend: { top: 0, textStyle: { color: '#52606d', fontWeight: 700 } },
      tooltip: { trigger: 'axis', backgroundColor: '#102a43', borderWidth: 0, textStyle: { color: '#fff' }, formatter(params) {
        const day = days[params[0]?.dataIndex] || {};
        return `<b>${escapeHtml(day.day || '')}</b><br>Facturación&nbsp;&nbsp;${money(day.realRevenue)}<br>Producto&nbsp;&nbsp;${money(day.productCost)}<br>Envío&nbsp;&nbsp;${money(day.outboundShippingCost)}<br>Fulfillment&nbsp;&nbsp;${money(day.outboundFulfillmentCost)}<br>COD&nbsp;&nbsp;${money(day.codCost)}<br>Devoluciones&nbsp;&nbsp;${money(day.returnCost)}<br>Publicidad&nbsp;&nbsp;${money(day.metaSpend)}<br>Gastos fijos&nbsp;&nbsp;${money(day.fixedCosts)}<br>Puntuales&nbsp;&nbsp;${money(day.oneOffCosts)}<br>Otros&nbsp;&nbsp;${money(day.otherCosts)}<br><b>Coste total&nbsp;&nbsp;${money(day.totalCosts)}</b><br><b>Beneficio&nbsp;&nbsp;${money(day.netProfit)}</b><br>ROI&nbsp;&nbsp;${percentValue(day.roiPercent)}<br>ROAS&nbsp;&nbsp;${Number.isFinite(Number(day.roas)) ? Number(day.roas).toFixed(2) + 'x' : 'Dato pendiente de fuente'}`;
      } },
      xAxis: { type: 'category', data: days.map((day) => day.day.slice(8)), axisLine: { lineStyle: { color: '#d9e2ec' } }, axisLabel: { color: '#627d98' } },
      yAxis: { type: 'value', axisLabel: { formatter: euroAxis, color: '#627d98' }, splitLine: { lineStyle: { color: '#edf2f7' } } },
      series: [
        active.has('realRevenue') ? { name: 'Facturación', type: 'bar', data: days.map((day) => day.realRevenue), itemStyle: { color: '#1677ff', borderRadius: [4, 4, 0, 0] }, barMaxWidth: 18 } : null,
        active.has('totalCosts') ? { name: 'Costes', type: 'bar', data: days.map((day) => day.totalCosts), itemStyle: { color: '#f97316', borderRadius: [4, 4, 0, 0] }, barMaxWidth: 18 } : null,
        active.has('netProfit') ? { name: 'Beneficio', type: 'line', data: days.map((day) => day.netProfit), smooth: .2, symbolSize: 5, lineStyle: { width: 3, color: '#0f766e' }, itemStyle: { color: '#0f766e' } } : null
      ].filter(Boolean)
    });
  }
  const funnel = document.querySelector('#finance-funnel');
  if (funnel) {
    const count = finance.counts || {}; const stages = [['Creados', count.created], ['Confirmados', count.confirmed], ['Enviados', count.sent], ['Entregados', count.delivered]];
    financeChart(funnel, { animationDuration: 350, title: { subtext: `Rechazados ${count.rejected || 0} · Devueltos ${count.returned || 0}`, left: 'center', bottom: 0, subtextStyle: { color: '#b45309', fontWeight: 700 } }, tooltip: { trigger: 'item', formatter: ({ name, value }) => `${escapeHtml(name)}: <b>${value}</b><br>${percentValue(Number(value || 0) * 100 / Math.max(1, count.created || 0))} de la cohorte` }, series: [{ type: 'funnel', top: 4, bottom: 34, left: '12%', width: '76%', minSize: '38%', maxSize: '100%', sort: 'descending', gap: 3, label: { show: true, position: 'inside', color: '#fff', fontWeight: 800, formatter: '{b}  {c}' }, itemStyle: { borderColor: '#fff', borderWidth: 2 }, data: stages.map(([name, value], index) => ({ name, value: value || 0, itemStyle: { color: ['#0b4f6c', '#1677ff', '#0891b2', '#0f766e'][index] } })) }] });
  }
  const cost = document.querySelector('#finance-cost-chart');
  if (cost) {
    const totals = finance.totals || {}; const entries = [['Producto', totals.productCost], ['Publicidad', totals.metaSpend], ['Envío', totals.outboundShippingCost], ['Fulfillment', totals.outboundFulfillmentCost], ['COD', totals.codCost], ['Devoluciones', totals.returnCost], ['IVA / ajustes Dropea', totals.dropeaAdjustmentsCost], ['Fijos', totals.fixedCosts], ['Puntuales', totals.oneOffCosts], ['Otros', totals.otherCosts]].filter(([, value]) => value !== null && value !== undefined);
    financeChart(cost, { animationDuration: 350, grid: { left: 100, right: 70, top: 8, bottom: 24 }, tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: money }, xAxis: { type: 'value', axisLabel: { formatter: euroAxis }, splitLine: { lineStyle: { color: '#edf2f7' } } }, yAxis: { type: 'category', inverse: true, data: entries.map(([name]) => name), axisLine: { show: false }, axisTick: { show: false } }, series: [{ type: 'bar', data: entries.map(([, value]) => value), barMaxWidth: 18, label: { show: true, position: 'right', formatter: ({ value }) => money(value), color: '#334e68', fontWeight: 700 }, itemStyle: { color: '#1677ff', borderRadius: [0, 5, 5, 0] } }] });
  }
  const cumulative = document.querySelector('#finance-cumulative-chart');
  if (cumulative) {
    let running = 0; const values = days.map((day) => Number.isFinite(Number(day.netProfit)) ? (running += Number(day.netProfit)) : null);
    financeChart(cumulative, { animationDuration: 350, grid: { left: 64, right: 24, top: 24, bottom: 38 }, tooltip: { trigger: 'axis', valueFormatter: money }, xAxis: { type: 'category', data: days.map((day) => day.day.slice(8)), axisLabel: { color: '#627d98' } }, yAxis: { type: 'value', axisLabel: { formatter: euroAxis }, splitLine: { lineStyle: { color: '#edf2f7' } } }, series: [{ name: 'Beneficio acumulado', type: 'line', smooth: .18, symbolSize: 5, data: values, lineStyle: { width: 3, color: '#0f766e' }, itemStyle: { color: '#0f766e' }, areaStyle: { color: window.echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: '#0f766e44' }, { offset: 1, color: '#0f766e00' }]) }, markLine: { symbol: 'none', lineStyle: { color: '#94a3b8', type: 'dashed' }, data: [{ yAxis: 0 }] } }] });
  }
  const status = document.querySelector('#finance-status-chart');
  if (status) {
    const breakdown = finance.counts?.statusBreakdown || {};
    const data = [
      ['Entregados', breakdown.delivered, '#10b981'],
      ['Devueltos', breakdown.returned, '#ef4444'],
      ['En el aire', breakdown.inAir, '#f59e0b'],
      ['Pendientes', breakdown.pending, '#3b82f6'],
      ['Cancelados antes de envío', breakdown.cancelled, '#94a3b8']
    ].filter(([, value]) => Number(value) > 0);
    financeChart(status, { animationDuration: 350, tooltip: { trigger: 'item', formatter: ({ name, value, percent }) => `${escapeHtml(name)}: <b>${value}</b> · ${percent}%` }, legend: { type: 'scroll', bottom: 0, textStyle: { color: '#52606d', fontWeight: 700 } }, series: [{ type: 'pie', radius: ['47%', '72%'], center: ['50%', '43%'], avoidLabelOverlap: true, label: { formatter: '{b}\n{c} · {d}%', color: '#334e68', fontWeight: 700 }, data: data.map(([name, value, color]) => ({ name, value, itemStyle: { color } })) }] });
  }
  const volume = document.querySelector('#finance-volume-chart');
  if (volume) financeChart(volume, { animationDuration: 350, color: ['#3b82f6', '#10b981', '#ef4444'], grid: { left: 54, right: 20, top: 42, bottom: 38 }, legend: { top: 0, textStyle: { color: '#52606d', fontWeight: 700 } }, tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } }, xAxis: { type: 'category', data: days.map((day) => day.day.slice(8)), axisLabel: { color: '#627d98' } }, yAxis: { type: 'value', minInterval: 1, axisLabel: { color: '#627d98' }, splitLine: { lineStyle: { color: '#edf2f7' } } }, series: [{ name: 'Creados', type: 'bar', data: days.map((day) => day.created), barMaxWidth: 14 }, { name: 'Entregados', type: 'bar', data: days.map((day) => day.delivered), barMaxWidth: 14 }, { name: 'Devueltos', type: 'bar', data: days.map((day) => day.returned), barMaxWidth: 14 }] });
  const dailyProfit = document.querySelector('#finance-daily-profit-chart');
  if (dailyProfit) financeChart(dailyProfit, { animationDuration: 350, grid: { left: 64, right: 24, top: 26, bottom: 38 }, tooltip: { trigger: 'axis', valueFormatter: money }, xAxis: { type: 'category', data: days.map((day) => day.day.slice(8)), axisLabel: { color: '#627d98' } }, yAxis: { type: 'value', axisLabel: { formatter: euroAxis }, splitLine: { lineStyle: { color: '#edf2f7' } } }, series: [{ name: 'Beneficio / pérdida', type: 'bar', barMaxWidth: 22, data: days.map((day) => ({ value: day.netProfit, itemStyle: { color: Number(day.netProfit) < 0 ? '#ef4444' : '#10b981', borderRadius: Number(day.netProfit) < 0 ? [0, 0, 5, 5] : [5, 5, 0, 0] } })), markLine: { symbol: 'none', lineStyle: { color: '#64748b', type: 'dashed' }, data: [{ yAxis: 0 }] } }] });
  renderFinanceHistory(finance);
}

function renderFinanceHistory(finance) {
  const node = document.querySelector('#finance-history-chart'); if (!node) return;
  const field = document.querySelector('#finance-history-metric')?.value || 'exactNetProfit';
  const windowSize = Number(document.querySelector('#finance-history-window')?.value || 6);
  const rows = (finance.history || []).slice(-windowSize);
  const operational = ['delivered', 'returned'].includes(field);
  const values = rows.map((row) => Number((operational ? row.counts?.[field] : row.totals?.[field]) ?? 0));
  if (!rows.length) { node.innerHTML = '<div class="empty-state">Aún no hay histórico suficiente.</div>'; return; }
  financeChart(node, { animationDuration: 350, grid: { left: 64, right: 24, top: 24, bottom: 38 }, tooltip: { trigger: 'axis', valueFormatter: operational ? (value) => `${value} pedidos` : money }, xAxis: { type: 'category', data: rows.map((row) => row.month.slice(5) + '/' + row.month.slice(2, 4)) }, yAxis: { type: 'value', axisLabel: { formatter: operational ? '{value}' : euroAxis }, splitLine: { lineStyle: { color: '#edf2f7' } } }, series: [{ name: document.querySelector('#finance-history-metric')?.selectedOptions?.[0]?.textContent || field, type: 'bar', data: values, barMaxWidth: 44, itemStyle: { color: ({ value }) => value < 0 ? '#dc2626' : '#1677ff', borderRadius: [6, 6, 0, 0] }, label: { show: true, position: 'top', formatter: ({ value }) => operational ? value : money(value), color: '#334e68', fontWeight: 700 } }] });
}

function renderFinanceTable(finance) {
  if (!state.financeVisibleColumns) state.financeVisibleColumns = new Set(FINANCE_COLUMNS.map(([key]) => key));
  const columns = FINANCE_COLUMNS.filter(([key]) => state.financeVisibleColumns.has(key));
  const head = document.querySelector('#finance-days-head'); const body = document.querySelector('#finance-days-table'); const foot = document.querySelector('#finance-days-total');
  if (head) head.innerHTML = `<tr>${columns.map(([key, label]) => `<th><button type="button" data-finance-sort="${key}">${escapeHtml(label)} ${state.financeSort.key === key ? (state.financeSort.direction === 'asc' ? '↑' : '↓') : ''}</button></th>`).join('')}</tr>`;
  const sorted = [...(finance.days || [])].sort((a, b) => { const av = a[state.financeSort.key]; const bv = b[state.financeSort.key]; const result = state.financeSort.key === 'day' ? String(av).localeCompare(String(bv)) : Number(av || 0) - Number(bv || 0); return state.financeSort.direction === 'asc' ? result : -result; });
  const drilldownType = { delivered: 'delivered', returned: 'returned', rejected: 'rejected', incidentOrders: 'incidentOrders' };
  if (body) body.innerHTML = sorted.length ? sorted.map((day) => `<tr class="${day.returned ? 'has-return' : ''}">${columns.map(([key, , type]) => {
    const value = financeValue(day[key], type);
    const canOpen = drilldownType[key] && Number(day[key]) > 0;
    return `<td class="${key === 'netProfit' ? (Number(day[key]) < 0 ? 'finance-negative' : 'finance-positive') : ''}">${canOpen ? `<button class="finance-drilldown-button" type="button" data-finance-day="${escapeHtml(day.day)}" data-finance-drilldown="${drilldownType[key]}">${value}</button>` : value}</td>`;
  }).join('')}</tr>`).join('') : `<tr><td colspan="${columns.length}"><div class="empty-state">No hay actividad en el periodo.</div></td></tr>`;
  const eventTotal = (key) => (finance.days || []).reduce((sum, day) => sum + (Number(day[key]) || 0), 0);
  const total = { day: 'TOTAL', created: eventTotal('created'), confirmed: eventTotal('confirmed'), rejected: eventTotal('rejected'), sent: eventTotal('sent'), inTransit: eventTotal('inTransit'), delivered: eventTotal('delivered'), deliveredUnits: eventTotal('deliveredUnits'), returned: eventTotal('returned'), returnedUnits: eventTotal('returnedUnits'), incidentOrders: eventTotal('incidentOrders'), realRevenue: finance.totals.realRevenue, productCost: finance.totals.productCost, outboundShippingCost: finance.totals.outboundShippingCost, outboundFulfillmentCost: finance.totals.outboundFulfillmentCost, codCost: finance.totals.codCost, returnCost: finance.totals.returnCost, dropeaAdjustmentsCost: finance.totals.dropeaAdjustmentsCost, metaSpend: finance.totals.metaSpend, fixedCosts: finance.totals.fixedCosts, oneOffCosts: finance.totals.oneOffCosts, otherCosts: finance.totals.otherCosts, totalCosts: finance.totals.totalCosts, contributionMargin: finance.totals.contributionMargin, netProfit: finance.totals.exactNetProfit, marginPercent: finance.totals.marginPercent, roiPercent: finance.totals.roiPercent, roas: finance.totals.roas };
  if (foot) foot.innerHTML = `<tr>${columns.map(([key, , type]) => `<td>${financeValue(total[key], type)}</td>`).join('')}</tr>`;
  document.querySelectorAll('[data-finance-sort]').forEach((button) => button.addEventListener('click', () => { const key = button.dataset.financeSort; state.financeSort = { key, direction: state.financeSort.key === key && state.financeSort.direction === 'asc' ? 'desc' : 'asc' }; renderFinanceTable(finance); }));
  const menu = document.querySelector('#finance-column-menu');
  if (menu) menu.innerHTML = FINANCE_COLUMNS.map(([key, label]) => `<label><input type="checkbox" data-finance-column="${key}" ${state.financeVisibleColumns.has(key) ? 'checked' : ''} ${key === 'day' ? 'disabled' : ''}> ${escapeHtml(label)}</label>`).join('');
  document.querySelectorAll('[data-finance-drilldown]').forEach((button) => button.addEventListener('click', () => {
    const day = button.dataset.financeDay; const type = button.dataset.financeDrilldown; const ids = finance.drilldowns?.[day]?.[type] || [];
    const dialog = document.querySelector('#finance-drilldown-dialog');
    setText('#finance-drilldown-title', `${button.closest('table')?.querySelector(`[data-finance-sort="${type}"]`)?.textContent?.replace(/[↑↓]/g, '').trim() || 'Pedidos'} · ${day}`);
    setText('#finance-drilldown-note', `${ids.length} pedidos componen este indicador. Solo se muestran identificadores operativos; no se incluyen datos personales.`);
    const target = document.querySelector('#finance-drilldown-orders'); if (target) target.innerHTML = ids.length ? ids.map((id) => `<span>#${escapeHtml(id)}</span>`).join('') : '<div class="empty-state">Detalle pendiente de sincronización para este día.</div>';
    dialog?.showModal();
  }));
}

function renderFinanceExecutive() {
  const finance = state.financeReport; const coverage = document.querySelector('#finance-coverage');
  if (state.financeLoading) { if (coverage) { coverage.className = 'finance-coverage finance-skeleton'; coverage.textContent = 'Conciliando eventos, costes y publicidad…'; } return; }
  if (state.financeError || !finance) { if (coverage) { coverage.className = 'finance-coverage is-error'; coverage.textContent = state.financeError ? `No se pudo cargar: ${state.financeError}` : 'Selecciona un periodo.'; } return; }
  const c = finance.counts || {}; const t = finance.totals || {}; const d = finance.comparison?.deltas || {};
  setText('#finance-profit', money(t.exactNetProfit)); setText('#finance-revenue', money(t.realRevenue)); setText('#finance-total-costs', money(t.totalCosts));
  setText('#finance-roi', percentValue(t.roiPercent)); setText('#finance-roas', Number.isFinite(Number(t.roas)) ? `${Number(t.roas).toFixed(2)}x` : '—'); setText('#finance-margin', percentValue(t.marginPercent));
  setText('#finance-delta-profit', deltaText(d.exactNetProfit)); setText('#finance-delta-revenue', deltaText(d.realRevenue)); setText('#finance-delta-costs', deltaText(d.totalCosts, { invert: true }));
  setText('#finance-delta-roi', deltaText(d.roiPercent, { percentOnly: true })); setText('#finance-delta-roas', deltaText(d.roas, { percentOnly: true })); setText('#finance-delta-margin', deltaText(d.marginPercent, { percentOnly: true }));
  setText('#finance-orders', c.created ?? 0); setText('#finance-confirmed', c.confirmed ?? 0); setText('#finance-rejected', c.rejected ?? 0); setText('#finance-sent', c.sent ?? 0); setText('#finance-transit', c.inTransit ?? 0); setText('#finance-delivered', c.delivered ?? 0); setText('#finance-delivered-units', c.deliveredUnits ?? 0); setText('#finance-returned', c.returned ?? 0); setText('#finance-returned-units', c.returnedUnits ?? 0); setText('#finance-incidents', c.incidentOrders ?? 0);
  setText('#finance-confirm-rate', `${percentValue(c.confirmationRatePercent)} · ${c.confirmed || 0}/${c.created || 0}`); setText('#finance-reject-rate', `${percentValue(c.rejectionRatePercent)} · ${c.rejected || 0}/${c.created || 0}`); setText('#finance-delivery-rate', `${percentValue(c.deliveryRatePercent)} · ${c.delivered || 0}/${c.sent || 0} envíos`); setText('#finance-return-rate', `${percentValue(c.returnRatePercent)} · ${c.returned || 0}/${c.sent || 0} envíos`); setText('#finance-incident-rate', `${percentValue(c.incidentRatePercent)} · ${c.incidentOrders || 0}/${c.sent || 0} envíos`);
  const statusBreakdown = c.statusBreakdown || {};
  const monthlyBrief = document.querySelector('#finance-monthly-brief');
  if (monthlyBrief) monthlyBrief.innerHTML = `
    <div><span>Beneficio neto del mes</span><strong>${money(t.exactNetProfit)}</strong><small>${money(t.realRevenue)} facturados − ${money(t.totalCosts)} de costes</small></div>
    <div><span>Entregados</span><strong>${statusBreakdown.delivered ?? c.delivered ?? 0}</strong><small>${percentValue(c.deliveryRatePercent)} sobre envíos</small></div>
    <div><span>Devueltos</span><strong>${statusBreakdown.returned ?? c.returned ?? 0}</strong><small>${percentValue(c.returnRatePercent)} · ${money(t.returnCost)}</small></div>
    <div><span>En el aire</span><strong>${statusBreakdown.inAir ?? c.inAir ?? 0}</strong><small>${statusBreakdown.pending ?? c.pending ?? 0} aún pendientes</small></div>
    <div><span>Meta + fijos</span><strong>${money(Number(t.metaSpend || 0) + Number(t.fixedCosts || 0) + Number(t.oneOffCosts || 0))}</strong><small>Meta ${money(t.metaSpend)} · estructura ${money(Number(t.fixedCosts || 0) + Number(t.oneOffCosts || 0))}</small></div>`;
  setText('#finance-status-badge', finance.statusLabel); if (coverage) { coverage.className = `finance-coverage ${finance.quality?.status === 'OK' ? 'is-ok' : 'is-warning'}`; coverage.textContent = `${finance.period.since} → ${finance.period.until} · Calidad ${finance.quality?.score ?? 0}% · desglose Dropea publicado ${finance.coverage?.dropeaBreakdownPublishedPercent ?? 0}% (definitivo ${finance.coverage?.dropeaBreakdownPercent ?? 0}%)`; }
  const fresh = document.querySelector('#finance-freshness'); if (fresh) fresh.innerHTML = Object.entries(finance.freshness?.sources || {}).map(([name, value]) => `<span class="${value.status === 'OK' ? 'is-ok' : 'is-warning'}"><b>${escapeHtml(name)}</b> ${escapeHtml(value.status)} · ${value.lastSyncAt ? formatDateTime(value.lastSyncAt) : 'sin sincronización'}</span>`).join('');
  const projection = document.querySelector('#finance-projection'); if (projection) { projection.hidden = !finance.projection; projection.innerHTML = finance.projection ? `<div><span>Realizado MTD</span><strong>${money(t.exactNetProfit)}</strong></div><div><span>Proyección de cierre</span><strong>${money(finance.projection.netProfit)}</strong><small>${escapeHtml(finance.projection.note)} · confianza ${escapeHtml(finance.projection.confidence)}</small></div>` : ''; }
  const warnings = document.querySelector('#finance-warnings'); if (warnings) warnings.innerHTML = finance.quality?.issues?.length ? finance.quality.issues.map((item) => `<div><strong>${escapeHtml(item.code)}</strong> · ${escapeHtml(item.message)}</div>`).join('') : '<div class="ok">Fuentes y cálculos reconciliados.</div>';
  const controls = document.querySelector('#finance-controls'); if (controls) controls.innerHTML = `<strong>Conciliación</strong>${Object.entries(finance.controls || {}).map(([name, ok]) => `<span class="${ok ? 'is-ok' : 'is-pending'}">${ok ? '✓' : '!'} ${escapeHtml(name)}</span>`).join('')}`;
  const audit = document.querySelector('#finance-audit'); if (audit) { audit.hidden = !finance.audit; audit.textContent = finance.audit ? `Control cruzado de julio: el libro validado marca ${money(finance.audit.benchmarkNetProfit)} y el cálculo pedido a pedido marca ${money(finance.audit.computedNetProfit)}. Diferencia: ${money(finance.audit.variance)}. El libro se mantiene como referencia, no sustituye los movimientos reales de Dropea.` : ''; }
  const expenses = finance.expenseLedger || [];
  const recurringExpenses = expenses.filter((item) => item.type === 'recurring_monthly' || item.type === 'recurring_daily').reduce((sum, item) => sum + Number(item.appliedAmount || 0), 0);
  const oneOffExpenses = expenses.filter((item) => item.type === 'one_off').reduce((sum, item) => sum + Number(item.appliedAmount || 0), 0);
  const expenseTotals = document.querySelector('#finance-expense-totals'); if (expenseTotals) expenseTotals.innerHTML = `<div><span>Total del mes</span><strong>${money(recurringExpenses + oneOffExpenses)}</strong></div><div><span>Recurrentes</span><strong>${money(recurringExpenses)}</strong></div><div><span>Puntuales</span><strong>${money(oneOffExpenses)}</strong></div>`;
  const expenseTable = document.querySelector('#finance-expenses-table'); if (expenseTable) expenseTable.innerHTML = expenses.length ? expenses.map((item) => `<tr><td><strong>${escapeHtml(item.name)}</strong></td><td>${item.type === 'one_off' ? 'Puntual' : 'Recurrente'}</td><td>${escapeHtml(item.category || 'Otros')}</td><td>${money(item.amount)}</td><td>${money(item.appliedAmount)}</td><td>${escapeHtml(item.startDate || item.date || '—')}</td><td>${escapeHtml(item.endDate || 'Sin fecha fin')}</td><td><small>${escapeHtml(item.source || 'ledger')}</small></td></tr>`).join('') : '<tr><td colspan="8"><div class="empty-state">No hay gastos configurados en este mes.</div></td></tr>';
  const statusNames = { delivered: 'Entregado', returned: 'Devuelto', inTransit: 'En el aire', incident: 'Incidencia', pending: 'Pendiente', rejected: 'Cancelado' };
  const ordersTable = document.querySelector('#finance-orders-cost-table'); if (ordersTable) ordersTable.innerHTML = finance.orders?.length ? finance.orders.map((order) => `<tr><td><strong>#${escapeHtml(order.orderId)}</strong><small>${escapeHtml(order.externalOrderId || '')}</small></td><td><span class="finance-status-pill is-${escapeHtml(order.status)}">${escapeHtml(statusNames[order.status] || order.status)}</span></td><td>${escapeHtml(order.createdDay || '—')}</td><td>${escapeHtml(order.settlementDay || '—')}</td><td>${order.units}</td><td>${money(order.orderAmount)}</td><td>${money(order.dropeaExpenses)}</td><td>${money(order.productCost)}</td><td>${money(order.outboundShippingCost)}</td><td>${money(order.outboundFulfillmentCost)}</td><td>${money(order.codCost)}</td><td>${money(order.returnCost)}</td><td>${money(order.dropeaAdjustmentsCost)}</td><td class="${Number(order.dropeaOrderProfit) < 0 ? 'finance-negative' : 'finance-positive'}">${money(order.dropeaOrderProfit)}</td><td class="${Number(order.contributionAfterProduct) < 0 ? 'finance-negative' : 'finance-positive'}">${money(order.contributionAfterProduct)}</td><td><span class="finance-source-pill">${order.breakdownStatus === 'DROPEA_FINAL' ? 'Dropea real' : order.breakdownStatus === 'DROPEA_ESTIMATE' ? 'Dropea estimado' : order.breakdownStatus === 'NOT_SETTLED' ? 'No liquidado' : 'Respaldo'}</span></td></tr>`).join('') : '<tr><td colspan="16"><div class="empty-state">No hay pedidos con actividad en este periodo.</div></td></tr>';
  const summary = document.querySelector('#finance-summary'); if (summary) summary.innerHTML = `<p class="eyebrow">Resumen de ${escapeHtml(finance.period.month)}</p><h4>${money(t.realRevenue)} facturados · ${money(t.exactNetProfit)} de beneficio · ROI ${percentValue(t.roiPercent)}</h4><p>${c.delivered || 0} pedidos y ${c.deliveredUnits || 0} unidades entregadas. ${c.returned || 0} devoluciones con ${money(t.returnCost)} de retorno real. Costes Dropea adicionales/IVA: ${money(t.dropeaAdjustmentsCost)}. Publicidad: ${money(t.metaSpend)} · gastos fijos y puntuales: ${money(Number(t.fixedCosts || 0) + Number(t.oneOffCosts || 0))}.</p>`;
  const products = document.querySelector('#finance-products-table'); if (products) products.innerHTML = finance.products?.length ? finance.products.map((p) => `<tr><td><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.sku)} · product ${escapeHtml(String(p.productId ?? 'sin ID'))} · variant ${escapeHtml(String(p.variantId ?? 'sin ID'))}</small></td><td>${p.deliveredOrders}</td><td>${p.deliveredUnits}</td><td>${money(p.revenue)}</td><td>${money(p.productCost)}</td><td>${money(p.logisticsCost)}</td><td>${p.returnedOrders}</td><td>${p.returnedUnits}</td><td>${money(p.returnCost)}</td><td>${p.attributedAdSpend === null ? 'Sin atribución fiable por producto' : money(p.attributedAdSpend)}</td><td>${money(p.totalCostBeforeAds)}</td><td>${money(p.profit)}</td><td>${percentValue(p.marginPercent)}</td><td>${percentValue(p.roiPercent)}</td><td>${percentValue(p.returnRatePercent)}</td></tr>`).join('') : '<tr><td colspan="15"><div class="empty-state">No hay entregas por producto.</div></td></tr>';
  renderExecutiveCharts(finance); renderFinanceTable(finance);
}

function renderFinance() {
  return renderFinanceExecutive();
  const finance = state.financeReport;
  const coverage = document.querySelector('#finance-coverage');
  const audit = document.querySelector('#finance-audit');
  const warnings = document.querySelector('#finance-warnings');
  const controls = document.querySelector('#finance-controls');
  const daysTable = document.querySelector('#finance-days-table');
  const daysTotal = document.querySelector('#finance-days-total');
  const productsTable = document.querySelector('#finance-products-table');

  if (state.financeLoading) {
    if (audit) audit.hidden = true;
    if (coverage) {
      coverage.className = 'finance-coverage';
      coverage.textContent = 'Conciliando pedidos de Dropea y gasto de Meta Ads...';
    }
    return;
  }
  if (state.financeError || !finance) {
    if (audit) audit.hidden = true;
    if (coverage) {
      coverage.className = 'finance-coverage is-error';
      coverage.textContent = state.financeError
        ? `No se pudo conciliar el periodo: ${state.financeError}`
        : 'Selecciona un mes para cargar la conciliación.';
    }
    return;
  }

  const counts = finance.counts || {};
  const totals = finance.totals || {};
  const reportCoverage = finance.coverage || {};
  const orderCount = counts.dropeaOrders ?? counts.total ?? 0;
  setText('#finance-orders-label', 'Pedidos creados');
  setText('#finance-orders-source', 'Cohorte mensual de Dropea');
  setText('#finance-orders-column', 'Creados');
  setText('#finance-orders', String(orderCount));
  setText('#finance-sent', String(counts.sent ?? 0));
  setText('#finance-delivered', String(counts.delivered ?? 0));
  setText('#finance-delivered-units', String(counts.deliveredUnits ?? counts.delivered ?? 0));
  setText('#finance-delivery-events', String(counts.deliveryEvents ?? 0));
  setText('#finance-returned', String(counts.returned ?? 0));
  setText('#finance-returned-units', `${counts.returnedUnits ?? counts.returned ?? 0} unidades afectadas`);
  setText('#finance-cancelled', String(counts.cancelled ?? 0));
  setText('#finance-open', String(Number(counts.active || 0) + Number(counts.incidents || 0)));
  setText('#finance-not-sent', String(counts.notSent ?? 0));
  setText('#finance-confirm-rate', reportCoverage.orders ? `Confirmación ${percentValue(counts.confirmationRatePercent)}` : 'Confirmación pendiente');
  setText('#finance-delivery-rate', `Entrega ${percentValue(counts.deliveryRatePercent)}`);
  setText('#finance-revenue', money(totals.realRevenue ?? totals.revenue));
  setText('#finance-total-costs', money(totals.totalCosts));
  setText('#finance-meta', reportCoverage.meta ? money(totals.metaSpend) : '—');
  setText('#finance-real-cpa', `CPA real ${money(totals.realCpa)}`);
  setText('#finance-return-cost', money(totals.returnCost));
  setText('#finance-return-unit-cost', `Tarifa ${money(finance.policy?.returnPerReturnedOrder)}/pedido devuelto`);
  setText('#finance-roi', percentValue(totals.roiPercent));
  setText('#finance-profit', money(totals.exactNetProfit));
  setText('#finance-product-cost', money(totals.productCost));
  setText('#finance-outbound-cost', money(totals.outboundShippingCost));
  setText('#finance-cod-cost', money(totals.codCost));
  setText('#finance-fulfillment-cost', money(totals.outboundFulfillmentCost));
  setText('#finance-fixed-cost', money(totals.fixedCosts));
  setText('#finance-formula', reportCoverage.exactProfitAvailable
    ? 'Facturación real − producto − logística − publicidad − fijos'
    : 'Cálculo pendiente: falta una fuente económica obligatoria');
  setText('#finance-status-badge', finance.statusLabel || finance.status || 'Periodo calculado');

  if (audit) {
    audit.hidden = !finance.audit;
    audit.innerHTML = finance.audit
      ? `Corrección de julio: el saldo parcial anterior era <strong>${money(finance.audit.previousPanelAmount)}</strong>. El beneficio neto correcto es <strong>${money(finance.audit.correctedNetProfit)}</strong>, una corrección de <strong>−${money(finance.audit.overstatement)}</strong>. La diferencia procedía de costes de producto, logística, devoluciones y gastos fijos que no se estaban restando.`
      : '';
  }

  if (coverage) {
    coverage.className = `finance-coverage ${reportCoverage.closedActual ? 'is-ok' : 'is-warning'}`;
    coverage.textContent = `${finance.period?.since || ''} a ${finance.period?.until || ''}. ${reportCoverage.explanation || ''}`;
  }
  if (warnings) {
    const items = [
      ...(finance.warnings || []),
      !reportCoverage.closedActual && finance.status === 'provisional' ? 'Mes abierto: las entregas, devoluciones y atribución de Meta todavía pueden cambiar.' : null,
      !reportCoverage.closedActual && finance.status === 'reconstructed' ? 'Periodo reconstruido con el estado actual de las APIs; no sustituye un cierre contable importado.' : null
    ].filter(Boolean);
    warnings.innerHTML = items.length
      ? items.map((item) => `<div>${escapeHtml(item)}</div>`).join('')
      : '<div class="ok">Todas las partidas del periodo están conciliadas.</div>';
  }
  if (controls) {
    const checks = [
      ['Periodo completo', finance.controls?.fullPeriodBoundary],
      ['Estados Dropea', finance.controls?.ordersPartitionReconciled],
      ['Ingresos por producto', finance.controls?.productRevenueReconciled],
      ['Suma de costes', finance.controls?.costsReconciled],
      ['Beneficio neto', finance.controls?.profitReconciled],
      ['Meta Ads', reportCoverage.meta]
    ];
    controls.innerHTML = `<strong>Controles de conciliación</strong>${checks.map(([label, passed]) => `
      <span class="${passed ? 'is-ok' : 'is-pending'}"><i>${passed ? '✓' : '!'}</i>${escapeHtml(label)}</span>`).join('')}`;
  }
  if (daysTable) {
    daysTable.innerHTML = finance.days?.length
      ? finance.days.map((day) => `<tr>
          <td><strong>${escapeHtml(day.day)}</strong></td>
          <td>${day.dropeaOrders ?? '—'}</td><td>${day.sent ?? 0}</td><td>${day.delivered ?? 0}</td>
          <td>${day.deliveredUnits ?? day.delivered ?? 0}</td><td>${day.deliveryEvents ?? 0}</td><td>${day.returned ?? 0}</td>
          <td>${money(day.estimatedRevenue)}</td><td>${money(day.realRevenue)}</td><td>${money(day.productCost)}</td>
          <td>${money(day.outboundShippingCost)}</td><td>${money(day.codCost)}</td><td>${money(day.outboundFulfillmentCost)}</td>
          <td>${money(day.returnCost)}</td><td>${money(day.metaSpend)}</td><td>${money(day.fixedCosts)}</td>
          <td>${money(day.totalCosts)}</td><td class="${Number(day.netProfit) < 0 ? 'finance-negative' : 'finance-positive'}">${money(day.netProfit)}</td>
          <td>${percentValue(day.roiPercent)}</td><td>${money(day.estimatedCpa)}</td><td>${money(day.realCpa)}</td>
          <td>${percentValue(day.confirmationRatePercent)}</td><td>${percentValue(day.deliveryRatePercent)}</td>
        </tr>`).join('')
      : '<tr><td colspan="23"><div class="empty-state">No hay pedidos en este periodo.</div></td></tr>';
  }
  if (daysTotal) {
    daysTotal.innerHTML = `<tr>
      <td><strong>TOTAL</strong></td><td>${orderCount}</td><td>${counts.sent ?? 0}</td><td>${counts.delivered ?? 0}</td>
      <td>${counts.deliveredUnits ?? counts.delivered ?? 0}</td><td>${counts.deliveryEvents ?? 0}</td><td>${counts.returned ?? 0}</td>
      <td>${money(totals.estimatedRevenue)}</td><td>${money(totals.realRevenue)}</td>
      <td>${money(totals.productCost)}</td><td>${money(totals.outboundShippingCost)}</td><td>${money(totals.codCost)}</td>
      <td>${money(totals.outboundFulfillmentCost)}</td><td>${money(totals.returnCost)}</td><td>${money(totals.metaSpend)}</td>
      <td>${money(totals.fixedCosts)}</td><td>${money(totals.totalCosts)}</td>
      <td class="${Number(totals.exactNetProfit) < 0 ? 'finance-negative' : 'finance-positive'}">${money(totals.exactNetProfit)}</td>
      <td>${percentValue(totals.roiPercent)}</td><td>${money(totals.estimatedCpa)}</td><td>${money(totals.realCpa)}</td>
      <td>${percentValue(counts.confirmationRatePercent)}</td><td>${percentValue(counts.deliveryRatePercent)}</td>
    </tr>`;
  }
  if (productsTable) {
    productsTable.innerHTML = finance.products?.length
      ? finance.products.map((product) => `<tr>
          <td><strong>${escapeHtml(product.name)}</strong>${product.unknownCostUnits ? `<small>${product.unknownCostUnits} uds. sin coste publicado</small>` : ''}</td>
          <td>${product.units}</td><td>${money(product.revenue)}</td><td>${money(product.productCost ?? product.knownProductCost)}</td>
          <td>${money(product.marginBeforeLogisticsAndAds)}</td>
        </tr>`).join('')
      : '<tr><td colspan="5"><div class="empty-state">No hay productos entregados en este periodo.</div></td></tr>';
  }
  renderFinanceCharts(finance);
}

async function loadFinanceReport({ force = false } = {}) {
  const month = financeMonthInput?.value || currentMadridMonth();
  state.financeLoading = true;
  state.financeError = null;
  renderFinance();
  let pending = false;
  try {
    const params = new URLSearchParams({ month });
    if (force) params.set('refresh', '1');
    const response = await fetch(`/api/finance?${params}`);
    const payload = await readJsonResponse(response);
    if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    if (payload.pending && !payload.finance) {
      pending = true;
      window.clearTimeout(state.financePollTimer);
      state.financePollTimer = window.setTimeout(() => loadFinanceReport(), 5000);
      return;
    }
    state.financeReport = payload.finance;
  } catch (error) {
    state.financeError = error instanceof Error ? error.message : String(error);
  } finally {
    state.financeLoading = pending;
    renderFinance();
    renderKpis();
  }
}

function renderAgentChat() {
  const chat = document.querySelector('#agent-chat');
  if (!chat) return;
  const messages = state.dashboard?.agentChat || [];
  chat.innerHTML = messages.length
    ? messages.map((message) => `
      <div class="chat-message ${message.role === 'user' ? 'is-user' : 'is-agent'}">
        <strong>${message.role === 'user' ? 'Samuel' : 'Agente'}</strong>
        <p>${escapeHtml(message.text)}</p>
      </div>
    `).join('')
    : '<div class="empty-state">Todavia no hay conversacion. Puedes escribirle instrucciones o preguntarle por sus decisiones.</div>';
  chat.scrollTop = chat.scrollHeight;

  const memory = document.querySelector('#agent-memory');
  if (memory) {
    const lessons = state.dashboard?.agentMemory || [];
    memory.innerHTML = lessons.length
      ? lessons.slice(0, 10).map((lesson) => `
        <article class="memory-item">
          <b>${escapeHtml(lesson.type || 'regla')}</b>
          <span>${escapeHtml(lesson.text)}</span>
          <small>${escapeHtml(lesson.source || 'memoria')} ${lesson.createdAt ? `· ${escapeHtml(lesson.createdAt)}` : ''}</small>
        </article>
      `).join('')
      : '<div class="empty-state">Aun no hay reglas generales guardadas. Escribe una instruccion y el agente la convertira en memoria.</div>';
  }
}

async function sendAgentMessage(message) {
  const input = document.querySelector('#agent-chat-input');
  const button = agentChatForm.querySelector('button');
  if (input) input.value = '';
  button.disabled = true;
  button.textContent = 'Pensando...';
  try {
    const response = await fetch('/api/agent-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });
    const payload = await readJsonResponse(response);
    if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    await loadDashboard();
  } catch (error) {
    alert(`No se pudo hablar con el agente: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    button.disabled = false;
    button.textContent = 'Enviar';
  }
}

function renderPanels() {
  document.body.dataset.section = state.section;
  pageTitle.textContent = titles[state.section];
  navItems.forEach((item) => item.classList.toggle('is-active', item.dataset.section === state.section));
  panels.forEach((panel) => {
    const visible = panel.dataset.panel.split(' ').includes(state.section);
    panel.hidden = !visible;
  });
}

function renderError() {
  const banner = document.querySelector('#status-banner');
  if (!banner) return;
  if (state.loading) {
    banner.hidden = false;
    banner.textContent = 'Cargando datos reales del sistema...';
    banner.className = 'status-banner';
    return;
  }
  if (state.error) {
    banner.hidden = false;
    banner.textContent = `No se pudo cargar el dashboard: ${state.error}`;
    banner.className = 'status-banner is-error';
    return;
  }
  const meta = state.dashboard?.meta || {};
  banner.hidden = false;
  banner.className = `status-banner ${meta.live ? 'is-ok' : 'is-warning'}`;
  const metaMode = meta.cached
    ? `cache rapido${meta.cacheAgeMinutes !== null && meta.cacheAgeMinutes !== undefined ? `, ${meta.cacheAgeMinutes} min` : ''}`
    : (meta.live ? 'en vivo' : 'fallback');
  const nextMeta = meta.nextRefreshAt ? ` Proximo Meta: ${formatDateTime(meta.nextRefreshAt)}.` : '';
  banner.textContent = `Datos actualizados ${formatDateTime(state.dashboard?.generatedAt)}. Meta: ${meta.spendSource || 'sin fuente'} (${metaMode}).${nextMeta} ${refreshCountdownText()}`;
}

function render() {
  renderPanels();
  renderError();
  if (!state.dashboard) return;

  if (state.section === 'overview') {
    renderKpis();
    renderFinance();
    renderOrders();
    renderCampaignsV2();
    renderSystem();
    return;
  }

  if (state.section === 'orders') {
    renderOrders();
    return;
  }

  if (state.section === 'incidents') {
    renderIncidents();
    return;
  }

  if (state.section === 'discounts') {
    renderDiscounts();
    return;
  }

  if (state.section === 'agent') {
    renderAgentChat();
    renderAgentOperationalHealth();
    renderAgentDiagnostics();
    renderFeedback();
    return;
  }

  if (state.section === 'meta') {
    renderCampaignsV2();
    return;
  }

  if (state.section === 'products') {
    renderProducts();
    renderResearch();
    return;
  }

  if (state.section === 'research') {
    renderResearch();
    return;
  }

  if (state.section === 'sources') {
    renderSources();
    renderSystem();
    return;
  }

  if (state.section === 'settings') {
    renderFinance();
    renderAgentDiagnostics();
    renderSources();
    renderSystem();
  }
}

async function loadDashboard({ silent = false } = {}) {
  if (!silent) state.loading = true;
  state.error = null;
  if (!silent) render();

  try {
    const response = await fetch('/api/dashboard');
    const payload = await readJsonResponse(response);
    if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    state.dashboard = payload.dashboard;
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
  } finally {
    if (!silent) state.loading = false;
    render();
  }
}

async function refreshDashboardNow() {
  const hasDashboard = Boolean(state.dashboard);
  state.loading = !hasDashboard;
  state.error = null;
  render();

  try {
    const response = await fetch('/api/dashboard-refresh', { method: 'POST' });
    const payload = await readJsonResponse(response);
    if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    state.dashboard = payload.dashboard;
    if (payload.refresh) {
      [5000, 10000].forEach((delay) => {
        window.setTimeout(() => {
          loadDashboard({ silent: true }).catch(() => {});
        }, delay);
      });
    }
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
  } finally {
    state.loading = false;
    render();
  }
}

async function requestBusinessManagerReport() {
  if (!businessManagerButton) return;
  businessManagerButton.disabled = true;
  businessManagerButton.textContent = 'Analizando...';
  try {
    const response = await fetch('/api/business-manager-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: 'Informe solicitado desde Productos' })
    });
    const payload = await readJsonResponse(response);
    if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    state.dashboard = payload.dashboard;
    state.section = 'products';
    render();
  } catch (error) {
    alert(`No se pudo generar el informe del manager: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    businessManagerButton.disabled = false;
    businessManagerButton.textContent = 'Pedir informe';
  }
}

function scheduleAutoRefresh() {
  if (refreshCountdownTimer) window.clearInterval(refreshCountdownTimer);

  refreshCountdownTimer = window.setInterval(() => {
    if (!state.loading && !state.error) renderError();
  }, 60000);
}

async function readJsonResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`El servidor no devolvio JSON valido (${response.status}): ${text.slice(0, 160)}`);
  }
}

navItems.forEach((item) => {
  item.addEventListener('click', () => {
    state.section = item.dataset.section;
    render();
  });
});

searchInput.addEventListener('input', (event) => {
  state.query = event.target.value;
  renderOrders();
  renderIncidents();
});

orderFilterButtons.forEach((button) => {
  button.addEventListener('click', () => {
    state.orderFilter = button.dataset.orderFilter || 'all';
    orderFilterButtons.forEach((item) => item.classList.toggle('is-active', item === button));
    renderOrders();
  });
});

incidentFilterButtons.forEach((button) => {
  button.addEventListener('click', () => {
    state.incidentFilter = button.dataset.incidentFilter || 'all';
    incidentFilterButtons.forEach((item) => item.classList.toggle('is-active', item === button));
    renderIncidents();
  });
});

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-feedback-order]');
  if (!button) return;
  feedbackOrderId = button.dataset.feedbackOrder;
  document.querySelector('#feedback-title').textContent = `Pedido #${feedbackOrderId}`;
  document.querySelector('#feedback-correction').value = '';
  document.querySelector('#feedback-note').value = '';
  feedbackDialog.showModal();
});

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-incident-feedback]');
  if (!button) return;
  feedbackIncident = {
    orderId: button.dataset.incidentFeedback,
    incidenceId: button.dataset.incidenceId || '',
    issueType: button.dataset.issueType || ''
  };
  document.querySelector('#incident-feedback-title').textContent = `Incidencia #${feedbackIncident.incidenceId || '-'} · pedido #${feedbackIncident.orderId}`;
  document.querySelector('#incident-feedback-correction').value = '';
  document.querySelector('#incident-feedback-note').value = '';
  incidentFeedbackDialog?.showModal();
});

document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-cancel-dropea-order]');
  if (!button) return;
  const orderId = button.dataset.cancelDropeaOrder;
  if (!orderId) return;
  const confirmed = window.confirm(`Vas a cancelar en Dropea el pedido #${orderId}. Esta accion es real. ¿Continuar?`);
  if (!confirmed) return;

  button.disabled = true;
  button.textContent = 'Cancelando...';
  try {
    const response = await fetch('/api/logistics/cancel-dropea-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId })
    });
    const payload = await readJsonResponse(response);
    if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    alert(`Pedido #${orderId} cancelado en Dropea. Estado despues: ${payload.after || 'verificado'}`);
    await loadDashboard();
  } catch (error) {
    alert(`No se pudo cancelar el pedido #${orderId}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    button.disabled = false;
    button.textContent = 'Cancelar Dropea';
  }
});

feedbackClose.addEventListener('click', () => {
  feedbackDialog.close();
});

incidentFeedbackClose?.addEventListener('click', () => {
  incidentFeedbackDialog?.close();
});

feedbackForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!feedbackOrderId) return;
  const submit = feedbackForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  submit.textContent = 'Guardando...';
  try {
    const response = await fetch('/api/agent-feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: feedbackOrderId,
        verdict: document.querySelector('#feedback-verdict').value,
        correction: document.querySelector('#feedback-correction').value,
        note: document.querySelector('#feedback-note').value
      })
    });
    const payload = await readJsonResponse(response);
    if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    feedbackDialog.close();
    await loadDashboard();
  } catch (error) {
    alert(`No se pudo guardar el feedback: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    submit.disabled = false;
    submit.textContent = 'Guardar feedback';
  }
});

incidentFeedbackForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!feedbackIncident?.orderId) return;
  const submit = incidentFeedbackForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  submit.textContent = 'Guardando...';
  try {
    const response = await fetch('/api/incident-feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: feedbackIncident.orderId,
        incidenceId: feedbackIncident.incidenceId,
        issueType: feedbackIncident.issueType,
        verdict: document.querySelector('#incident-feedback-verdict').value,
        correction: document.querySelector('#incident-feedback-correction').value,
        note: document.querySelector('#incident-feedback-note').value
      })
    });
    const payload = await readJsonResponse(response);
    if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    incidentFeedbackDialog?.close();
    await loadDashboard();
  } catch (error) {
    alert(`No se pudo guardar el feedback de incidencia: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    submit.disabled = false;
    submit.textContent = 'Guardar aprendizaje';
  }
});

financeMonthInput?.addEventListener('change', () => loadFinanceReport());
function moveFinanceMonth(offset) {
  const value = financeMonthInput?.value || currentMadridMonth();
  const [year, month] = value.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1 + offset, 1)).toISOString().slice(0, 7);
  const from = state.financeReport?.availableRange?.from || '2026-05';
  const to = state.financeReport?.availableRange?.to || currentMadridMonth();
  if (next < from || next > to || !financeMonthInput) return;
  financeMonthInput.value = next;
  loadFinanceReport();
}
financePrevButton?.addEventListener('click', () => moveFinanceMonth(-1));
financeNextButton?.addEventListener('click', () => moveFinanceMonth(1));
financeCompareInput?.addEventListener('change', renderFinance);
document.querySelector('#finance-history-metric')?.addEventListener('change', () => renderFinanceHistory(state.financeReport || {}));
document.querySelector('#finance-history-window')?.addEventListener('change', () => renderFinanceHistory(state.financeReport || {}));
document.querySelectorAll('[data-finance-series]').forEach((input) => input.addEventListener('change', () => renderExecutiveCharts(state.financeReport || {})));
document.querySelector('#finance-drilldown-close')?.addEventListener('click', () => document.querySelector('#finance-drilldown-dialog')?.close());
window.addEventListener('resize', () => financeChartInstances.forEach((chart) => { if (!chart.isDisposed()) chart.resize(); }));
document.querySelector('#finance-columns')?.addEventListener('click', () => {
  const menu = document.querySelector('#finance-column-menu');
  if (menu) menu.hidden = !menu.hidden;
});
document.querySelector('#finance-column-menu')?.addEventListener('change', (event) => {
  const key = event.target?.dataset?.financeColumn;
  if (!key || !state.financeVisibleColumns) return;
  if (event.target.checked) state.financeVisibleColumns.add(key); else state.financeVisibleColumns.delete(key);
  renderFinanceTable(state.financeReport || {});
});
document.querySelector('#finance-csv')?.addEventListener('click', () => {
  const report = state.financeReport;
  if (!report?.days?.length) return;
  const separator = ';';
  const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const rows = [FINANCE_COLUMNS.map(([, label]) => quote(label)).join(separator), ...report.days.map((day) => FINANCE_COLUMNS.map(([key]) => quote(day[key])).join(separator))];
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([`\uFEFF${rows.join('\n')}`], { type: 'text/csv;charset=utf-8' }));
  link.download = `suleia-rentabilidad-${report.period.month}.csv`;
  link.click(); URL.revokeObjectURL(link.href);
});
document.querySelector('#finance-expense-toggle')?.addEventListener('click', () => {
  if (!financeExpenseForm) return;
  financeExpenseForm.hidden = !financeExpenseForm.hidden;
  const start = document.querySelector('#finance-expense-start');
  if (!financeExpenseForm.hidden && start && !start.value) start.value = `${financeMonthInput?.value || currentMadridMonth()}-01`;
});
financeExpenseForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = financeExpenseForm.querySelector('button[type="submit"]');
  const message = document.querySelector('#finance-expense-message');
  submit.disabled = true;
  if (message) message.textContent = 'Guardando y recalculando el mes…';
  try {
    const response = await fetch('/api/finance-expenses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: document.querySelector('#finance-expense-name')?.value,
        type: document.querySelector('#finance-expense-type')?.value,
        amount: document.querySelector('#finance-expense-amount')?.value,
        startDate: document.querySelector('#finance-expense-start')?.value,
        endDate: document.querySelector('#finance-expense-end')?.value,
        category: document.querySelector('#finance-expense-category')?.value
      })
    });
    const payload = await readJsonResponse(response);
    if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    financeExpenseForm.reset();
    financeExpenseForm.hidden = true;
    if (message) message.textContent = '';
    await loadFinanceReport();
  } catch (error) {
    if (message) message.textContent = `No se pudo guardar: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    submit.disabled = false;
  }
});
financeRefreshButton?.addEventListener('click', async () => {
  financeRefreshButton.disabled = true;
  financeRefreshButton.textContent = 'Conciliando...';
  await loadFinanceReport({ force: true });
  financeRefreshButton.disabled = false;
  financeRefreshButton.textContent = 'Actualizar periodo';
});

agentChatForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = document.querySelector('#agent-chat-input');
  const message = input.value.trim();
  if (!message) return;
  await sendAgentMessage(message);
});

document.querySelectorAll('[data-agent-prompt]').forEach((button) => {
  button.addEventListener('click', async () => {
    await sendAgentMessage(button.dataset.agentPrompt || '');
  });
});

document.querySelectorAll('[data-agent-prefix]').forEach((button) => {
  button.addEventListener('click', () => {
    const input = document.querySelector('#agent-chat-input');
    if (!input) return;
    input.value = `${button.dataset.agentPrefix || ''}${input.value}`.trimStart();
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
});

businessManagerButton?.addEventListener('click', requestBusinessManagerReport);

syncButton.addEventListener('click', async () => {
  syncButton.textContent = 'Actualizando...';
  syncButton.disabled = true;
  await Promise.all([refreshDashboardNow(), loadFinanceReport({ force: true })]);
  syncButton.textContent = 'Actualizar datos';
  syncButton.disabled = false;
});

if (financeMonthInput) financeMonthInput.value = currentMadridMonth();
scheduleAutoRefresh();
Promise.all([loadDashboard(), loadFinanceReport()]).catch(() => {});
