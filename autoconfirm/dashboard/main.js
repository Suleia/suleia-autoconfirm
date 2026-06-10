const state = {
  section: 'overview',
  query: '',
  loading: true,
  error: null,
  dashboard: null
};

const titles = {
  overview: 'Vista general',
  orders: 'Pedidos',
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
const feedbackDialog = document.querySelector('#feedback-dialog');
const feedbackForm = document.querySelector('#feedback-form');
const feedbackClose = document.querySelector('#feedback-close');
const financeSettingsForm = document.querySelector('#finance-settings-form');
const agentChatForm = document.querySelector('#agent-chat-form');
let feedbackOrderId = null;

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

function escapeHtml(value) {
  return String(value ?? '')
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
  if (action.includes('not_confirm')) return false;
  return action.includes('confirm') || intent.includes('confirm') || status.includes('confirm');
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

function renderOrders() {
  const table = document.querySelector('#orders-table');
  const orders = state.dashboard?.orders || [];
  const rows = orders
    .filter((order) => matchesQuery([order.orderId, order.customer, order.product, order.status, order.agentAction]))
    .map((order) => {
      const orderState = friendlyOrderState(order);
      const evidence = agentEvidence(order);
      return `
        <tr>
          <td><strong>#${escapeHtml(order.orderId)}</strong><small>${escapeHtml(order.createdAt || '')}</small></td>
          <td>${escapeHtml(order.product || 'Producto')}</td>
          <td>
            <span class="pill ${orderState.tone}">${escapeHtml(orderState.label)}</span>
            <small>${escapeHtml(orderState.detail)}</small>
          </td>
          <td>
            <span class="signal-chip ${evidence.tone}">${escapeHtml(evidence.label)}</span>
            <small>${escapeHtml(evidence.detail)}</small>
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
            ${order.feedbackVerdict ? `<small>Feedback: ${escapeHtml(order.feedbackVerdict)}</small>` : ''}
          </td>
      </tr>
    `;
    });
  table.innerHTML = rows.join('') || '<tr><td colspan="6">No hay resultados para esta busqueda.</td></tr>';
}

function renderCampaigns() {
  const list = document.querySelector('#campaign-list');
  const campaigns = state.dashboard?.campaigns || [];
  const products = state.dashboard?.campaignProducts || [];
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

function renderProducts() {
  const grid = document.querySelector('#product-cards');
  const products = state.dashboard?.products || [];
  grid.innerHTML = products.map((product) => `
    <div class="product-card">
      <span>${escapeHtml(product.status || 'Activo')}</span>
      <strong>${escapeHtml(product.name)}</strong>
      <p>${money(product.price)} · ${product.orders || 0} pedidos · margen ${product.margin ?? '-'}%</p>
    </div>
  `).join('');
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
  list.innerHTML = sources.map((source) => `
    <div class="source-item ${source.ok ? 'ok' : 'bad'}">
      <span></span>
      <div>
        <strong>${escapeHtml(source.name)}</strong>
        <small>${source.ok ? 'Conectado' : escapeHtml(source.error || 'No disponible')}</small>
      </div>
    </div>
  `).join('');
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
  banner.hidden = true;
}

function render() {
  renderPanels();
  renderError();
  renderKpis();
  renderFinance();
  renderAgentChat();
  renderOrders();
  renderCampaigns();
  renderAgentDiagnostics();
  renderFeedback();
  renderProducts();
  renderResearch();
  renderSources();
  renderSystem();
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

feedbackClose.addEventListener('click', () => {
  feedbackDialog.close();
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

syncButton.addEventListener('click', async () => {
  syncButton.textContent = 'Actualizando...';
  syncButton.disabled = true;
  await loadDashboard();
  syncButton.textContent = 'Actualizar datos';
  syncButton.disabled = false;
});

loadDashboard();
