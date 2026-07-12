const state = {
  section: 'overview',
  query: '',
  orderFilter: 'all',
  incidentFilter: 'all',
  loading: true,
  error: null,
  dashboard: null
};

const titles = {
  overview: 'Vista general',
  orders: 'Pedidos',
  incidents: 'Incidencias',
  agent: 'Control del agente',
  meta: 'Meta Ads',
  products: 'Productos',
  research: 'Competencia y oportunidades',
  settings: 'Costes y reglas'
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
const financeSettingsForm = document.querySelector('#finance-settings-form');
const agentChatForm = document.querySelector('#agent-chat-form');
const businessManagerButton = document.querySelector('#business-manager-button');
let feedbackOrderId = null;
let feedbackIncident = null;
let refreshCountdownTimer = null;

const META_REFRESH_HOURS = 12;

function money(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '€0,00';
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(number);
}

function percent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0%';
  return new Intl.NumberFormat('es-ES', { style: 'percent', maximumFractionDigits: 0 }).format(number);
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
      label: status.includes('rejected_unanswered') ? 'Rechazado por 36h sin respuesta' : 'Rechazar por 36h sin respuesta',
      detail: 'Sin confirmacion ni cambio de direccion tras 36h. Accion en Dropea: cancelar/rechazar pedido.',
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
    { label: data.agentName || 'Agente de incidencias', value: 'Activo', detail: data.agentModeLabel || 'Entrenamiento; sin acciones automaticas', tone: 'positive' },
    { label: 'Con respuesta', value: orders.filter((order) => Number(order.customerMessages) > 0).length, detail: 'Cliente contesto en Chatby', tone: 'positive' },
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
      const rowClasses = ['order-row'];
      if (isScheduled) rowClasses.push('is-scheduled');
      if (isConfirmedByCustomer) rowClasses.push('is-confirmed');
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
    incident.feedbackCorrection,
    incident.feedbackNote
  ])).filter(incidentMatchesFilter).sort((a, b) => {
    const bOrderId = Number(String(b.orderId || '').replace(/\D/g, '')) || 0;
    const aOrderId = Number(String(a.orderId || '').replace(/\D/g, '')) || 0;
    if (bOrderId !== aOrderId) return bOrderId - aOrderId;
    const bIncidenceId = Number(String(b.incidenceId || '').replace(/\D/g, '')) || 0;
    const aIncidenceId = Number(String(a.incidenceId || '').replace(/\D/g, '')) || 0;
    return bIncidenceId - aIncidenceId;
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
          ${incident.transportLatestEvent?.text
            ? `<div class="incident-carrier-latest"><b>Ultimo evento</b><time>${escapeHtml(formatDateTime(incident.transportLatestEvent.eventAt))}</time><p>${escapeHtml(incident.transportLatestEvent.text)}</p></div>`
            : '<small>Sin historial detallado aportado por transporte.</small>'}
          <small class="incident-source-note">${incident.transportLogCompleteness === 'summary_only' ? 'Resumen disponible en la API de Dropea' : 'Historial de transporte'}</small>
          ${Array.isArray(incident.transportHistory) && incident.transportHistory.length
            ? `<details class="incident-carrier-history"><summary>Ver historial (${incident.transportHistory.length})</summary>${incident.transportHistory.map((event) => `<article><time>${escapeHtml(formatDateTime(event.eventAt))}</time><p>${escapeHtml(event.text)}</p></article>`).join('')}</details>`
            : ''}
          ${incident.tracking ? `<small>Tracking: ${escapeHtml(incident.tracking)}</small>` : ''}
        </td>
        <td>
          <span class="signal-chip ${statusTone}">${escapeHtml(incident.actionRecommended || 'Revisión manual')}</span>
          <small>${escapeHtml(incident.recommendedNextStep || incident.proposedSolution || 'Revision manual')}</small>
          ${incident.operationalInstruction ? `<div class="incident-resolution-box"><b>Que haria:</b> ${escapeHtml(incident.operationalInstruction)}</div>` : ''}
          ${incident.templateRecommendation ? `<small class="incident-template-chip">Plantilla sugerida: ${escapeHtml(incident.templateRecommendation)}</small>` : ''}
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
        <small>${source.ok ? 'Conectado' : escapeHtml(source.error || 'No disponible')}</small>
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
  const finance = state.dashboard?.finance || {};
  setText('#kpi-orders', String(kpis.orders ?? 0));
  setText('#kpi-confirm-rate', percent(kpis.confirmRate));
  setText('#kpi-revenue', money(kpis.revenue));
  setText('#kpi-profit', money(kpis.estimatedProfit));
  setText('#kpi-spend', money(kpis.spend));
  setText('#kpi-review', String(kpis.manualReview ?? 0));
  setText('#kpi-profit-note', Number(finance.businessProfit) >= 0 ? 'Operacion en positivo' : 'Operacion en negativo');
  setText('#hero-orders', String(kpis.orders ?? 0));
  setText('#hero-confirm-rate', percent(kpis.confirmRate));
  setText('#hero-profit', money(kpis.estimatedProfit));

  const profitCard = document.querySelector('#profit-card');
  if (profitCard) {
    profitCard.classList.toggle('positive', Number(finance.businessProfit) >= 0);
    profitCard.classList.toggle('danger', Number(finance.businessProfit) < 0);
  }
}

function renderFinance() {
  const finance = state.dashboard?.finance || {};
  setText('#finance-dropea-profit', money(finance.dropeaProfit));
  setText('#finance-revenue', money(finance.revenue));
  setText('#finance-orders', `${finance.recognizedOrders || 0} pedidos reconocidos`);
  setText('#finance-alt-costs', money((Number(finance.productCost) || 0) + (Number(finance.paymentFees) || 0)));
  setText('#finance-meta', money(finance.metaSpend));
  setText('#finance-profit', money(finance.businessProfit));
  setText('#finance-formula', finance.formula || 'Beneficio = ingresos - costes');
  const input = document.querySelector('#finance-dropea-input');
  if (input && !input.matches(':focus')) input.value = Number.isFinite(Number(finance.dropeaProfit)) ? String(finance.dropeaProfit).replace('.', ',') : '';

  const warnings = document.querySelector('#finance-warnings');
  if (warnings) {
    const items = finance.warnings || [];
    warnings.innerHTML = items.length
      ? items.map((item) => `<div>${escapeHtml(item)}</div>`).join('')
      : '<div class="ok">Calculo sin avisos relevantes.</div>';
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

async function loadDashboard() {
  state.loading = true;
  state.error = null;
  render();

  try {
    const response = await fetch('/api/dashboard');
    const payload = await readJsonResponse(response);
    if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    state.dashboard = payload.dashboard;
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
  } finally {
    state.loading = false;
    render();
  }
}

async function refreshDashboardNow() {
  state.loading = true;
  state.error = null;
  render();

  try {
    const response = await fetch('/api/dashboard-refresh', { method: 'POST' });
    const payload = await readJsonResponse(response);
    if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    state.dashboard = payload.dashboard;
    if (payload.refresh) {
      window.setTimeout(() => {
        loadDashboard().catch(() => {});
      }, 5000);
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

financeSettingsForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = document.querySelector('#finance-dropea-input');
  const value = input.value.trim();
  const button = financeSettingsForm.querySelector('button');
  button.disabled = true;
  button.textContent = 'Guardando...';
  try {
    const response = await fetch('/api/finance-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dropeaProfit: value })
    });
    const payload = await readJsonResponse(response);
    if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    await loadDashboard();
  } catch (error) {
    alert(`No se pudo guardar el beneficio Dropea: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    button.disabled = false;
    button.textContent = 'Guardar beneficio Dropea';
  }
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
  await refreshDashboardNow();
  syncButton.textContent = 'Actualizar datos';
  syncButton.disabled = false;
});

scheduleAutoRefresh();
loadDashboard();
