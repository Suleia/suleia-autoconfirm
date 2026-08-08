const state = { view: 'orders', offset: 0, limit: 50, total: 0, filters: {}, config: null, token: null, summary: null, finance: null };
const operationsBase = location.pathname.startsWith('/operations') ? '/operations' : '';
const $ = (id) => document.getElementById(id);
const text = (value, fallback = '—') => value === undefined || value === null || value === '' ? fallback : String(value);
const short = (value) => { const v = text(value); return v.length > 22 ? `${v.slice(0, 10)}…${v.slice(-7)}` : v; };
const date = (value, dateOnly = false) => value ? new Intl.DateTimeFormat('es-ES', dateOnly ? { dateStyle: 'medium' } : { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';
const money = (value, currency = 'EUR') => value === null || value === undefined ? 'No disponible' : new Intl.NumberFormat('es-ES', { style: 'currency', currency: currency || 'EUR' }).format(Number(value));
const node = (tag, className, content) => { const el = document.createElement(tag); if (className) el.className = className; if (content !== undefined) el.textContent = content; return el; };

function randomString() { const bytes = crypto.getRandomValues(new Uint8Array(32)); return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(''); }
async function sha256(value) { const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function redirectUri() { return `${location.origin}${location.pathname}`; }

function showLoginError(message) { const notice = $('login-notice'); notice.textContent = message; notice.hidden = !message; }
async function prepareLogin() {
  if (!state.config?.oauth?.issuer || !state.config.oauth.client_id || !state.config.oauth.scope) throw new Error('La configuración de acceso está incompleta.');
  if (!globalThis.crypto?.getRandomValues || !globalThis.crypto?.subtle) throw new Error('Este navegador no permite iniciar el acceso seguro.');
  const verifier = randomString() + randomString(); const loginState = randomString();
  sessionStorage.setItem('suleia_pkce_verifier', verifier); sessionStorage.setItem('suleia_oauth_state', loginState);
  const challenge = await sha256(verifier); const url = new URL(`${state.config.oauth.issuer}/protocol/openid-connect/auth`);
  Object.entries({ client_id: state.config.oauth.client_id, response_type: 'code', scope: state.config.oauth.scope, redirect_uri: redirectUri(), state: loginState, code_challenge: challenge, code_challenge_method: 'S256', audience: state.config.oauth.audience }).forEach(([key, value]) => url.searchParams.set(key, value));
  const button = $('login-button'); button.href = url.toString(); button.textContent = 'Iniciar sesión'; button.setAttribute('aria-disabled', 'false');
}

async function exchangeCode(code, returnedState) {
  const expected = sessionStorage.getItem('suleia_oauth_state'); const verifier = sessionStorage.getItem('suleia_pkce_verifier');
  if (!expected || expected !== returnedState || !verifier) throw new Error('La validación de acceso no coincide.');
  const response = await fetch(`${state.config.oauth.issuer}/protocol/openid-connect/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: state.config.oauth.client_id, code, redirect_uri: redirectUri(), code_verifier: verifier }) });
  if (!response.ok) throw new Error('No se pudo completar el acceso seguro.');
  const payload = await response.json();
  sessionStorage.removeItem('suleia_pkce_verifier'); sessionStorage.removeItem('suleia_oauth_state');
  sessionStorage.setItem('suleia_access_token', payload.access_token); sessionStorage.setItem('suleia_token_expires_at', String(Date.now() + payload.expires_in * 1000));
  history.replaceState({}, document.title, location.pathname); return payload.access_token;
}

function activeToken() { const token = sessionStorage.getItem('suleia_access_token'); const expires = Number(sessionStorage.getItem('suleia_token_expires_at') || 0); return token && expires > Date.now() + 15000 ? token : null; }
async function api(path) { const response = await fetch(`${operationsBase}${path}`, { headers: { Authorization: `Bearer ${state.token}` } }); if (response.status === 401 || response.status === 403) { signOut(false); throw new Error('Tu sesión ha caducado.'); } if (!response.ok) throw new Error('La lectura no está disponible temporalmente.'); return (await response.json()).data; }
function signOut(remote = true) { sessionStorage.removeItem('suleia_access_token'); sessionStorage.removeItem('suleia_token_expires_at'); state.token = null; $('app').hidden = true; $('login').hidden = false; if (remote && state.config) { const url = new URL(`${state.config.oauth.issuer}/protocol/openid-connect/logout`); url.searchParams.set('client_id', state.config.oauth.client_id); url.searchParams.set('post_logout_redirect_uri', redirectUri()); location.assign(url.toString()); } }

function badge(value) { const v = text(value); const lower = v.toLowerCase(); let tone = 'gray'; if (/ready|pass|exact|verified|delivered|finish|resolved|responded|permitida/.test(lower)) tone = 'green'; else if (/wait|pending|medium|review|active|incidence/.test(lower)) tone = 'amber'; else if (/high|critical|blocked|error|stale|conflict|reject|return|cancel/.test(lower)) tone = 'red'; else if (/human|simulation/.test(lower)) tone = 'purple'; else if (/info|shipping|transit/.test(lower)) tone = 'blue'; return node('span', `badge ${tone}`, v); }
function summaryCard(label, value, detail, tone = '') { const card = node('article', `summary-card ${tone}`.trim()); card.append(node('span', '', label), node('strong', '', text(value, '0')), node('small', '', detail)); return card; }
function showNotice(message) { const el = $('notice'); el.textContent = message; el.hidden = !message; }
function productText(value) { if (Array.isArray(value)) return value.filter(Boolean).join(', ') || 'Producto no informado'; if (typeof value === 'object' && value) return Object.values(value).filter((item) => typeof item === 'string').join(', ') || 'Producto no informado'; return text(value, 'Producto no informado'); }
function stacked(primary, secondary, className = '') { const box = node('div', `stacked ${className}`.trim()); box.append(node('strong', '', text(primary))); if (secondary) box.append(node('small', '', text(secondary))); return box; }
function percentage(value, total) { return total ? `${Math.round((Number(value || 0) / Number(total)) * 100)} %` : 'No disponible'; }

function renderSummary() {
  const root = $('summary'); root.replaceChildren();
  if (state.view === 'finance') return;
  const data = state.view === 'orders' ? state.summary?.orders : state.summary?.incidents;
  if (state.view === 'orders') {
    root.append(
      summaryCard('Pedidos observados', data?.total, 'Copia operativa Dropea'),
      summaryCard('Pendientes', data?.pending, 'Esperando señal o gestión', 'amber'),
      summaryCard('Entregados', data?.delivered, 'Entregados o finalizados', 'green'),
      summaryCard('Con incidencia', data?.with_active_issue ?? data?.incidence, 'Seguimiento operativo', 'amber'),
      summaryCard('Cancelados o rechazados', data?.cancelled_or_rejected, 'No deben confirmarse', 'red'),
      summaryCard('Revisión humana', data?.human_review, 'La automatización queda bloqueada', 'purple')
    );
  } else {
    root.append(
      summaryCard('Pendientes', data?.pending, 'Incidencias activas'),
      summaryCard('Cliente respondió', data?.responded, 'Señal disponible', 'green'),
      summaryCard('Esperando cliente', data?.awaiting_customer, 'Sin respuesta concluyente', 'amber'),
      summaryCard('Riesgo alto', data?.high_risk, 'Revisión prioritaria', 'red'),
      summaryCard('Bloqueadas', data?.blocked, 'Sin acción automática', 'purple'),
      summaryCard('Datos caducados', data?.stale, 'No usar para decidir', 'red')
    );
  }
  const last = data?.last_sync_at || state.summary?.protections?.last_reconciled_at;
  $('last-sync').textContent = date(last);
  if (data?.stale > 0) showNotice('Hay datos desactualizados. Las decisiones afectadas permanecen bloqueadas.');
}

const filterDefinitions = {
  orders: [
    ['lifecycle', 'Estado', ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPING', 'DELIVERED', 'FINISHED', 'INCIDENCE', 'CANCELLED', 'REJECTED', 'RETURNED']],
    ['risk', 'Riesgo', ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']],
    ['freshness', 'Datos', ['FRESH', 'STALE', 'UNKNOWN']],
    ['identity', 'Identidad', ['EXACT', 'VERIFIED', 'CONFLICTING', 'UNKNOWN']]
  ],
  incidents: [
    ['type', 'Tipo', ['RECIPIENT_ABSENT', 'ADDRESS_INCORRECT', 'PENDING_DATA', 'REFUSED_BY_RECIPIENT', 'POSSIBLE_RETURN', 'RETURN_REQUESTED', 'PICKUP_AT_AGENCY', 'DELIVERY_FAILED', 'ADMINISTRATIVE_ISSUE', 'PENDING_AUTHORIZATION', 'RETAINED', 'CUSTOMS_ISSUE', 'DAMAGED_PACKAGE', 'LOST_PACKAGE', 'GENERAL_INCIDENCE', 'UNKNOWN']],
    ['risk', 'Riesgo', ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']],
    ['freshness', 'Datos', ['FRESH', 'STALE', 'UNKNOWN']]
  ]
};
function renderFilters() { const root = $('filters'); root.replaceChildren(); for (const [key, label, options] of filterDefinitions[state.view] || []) { const select = node('select', 'filter-select'); select.setAttribute('aria-label', label); select.append(new Option(`Todos · ${label}`, '')); for (const option of options) select.append(new Option(option, option)); select.value = state.filters[key] || ''; select.addEventListener('change', () => { state.filters[key] = select.value; state.offset = 0; loadQueue(); }); root.append(select); } }
function cell(content, className = '') { const td = node('td', className); td.append(content instanceof Node ? content : document.createTextNode(text(content))); return td; }
function actionStatus(item) { return Number(item.actions_executed || 0) === 0 ? stacked('Sin acción real', 'Panel de lectura · 0 ejecuciones', 'safe-action') : stacked('Revisión requerida', 'Estado inesperado', 'blocked-action'); }
function protectionBadges(item) { const box = node('div', 'protection-badges'); if (item.duplicate_status === 'DUPLICATE_ACTIVE_ORDER') box.append(badge('DUPLICADO')); if (item.test_order) box.append(badge('TEST')); if (item.chatby_cleanup_status === 'DELETE_ELIGIBLE') box.append(badge('CHATBY CLEANUP')); if (['BLOCK_ELIGIBLE', 'BLOCK_PENDING', 'BLOCK_REQUESTED', 'BLOCKED_VERIFIED'].includes(item.return_block_status)) box.append(badge('RETURN BLOCK')); return box; }
function rowOrder(item) {
  const tr = node('tr'); tr.tabIndex = 0;
  const decision = item.simulated_decision || item.simulated_action_type || 'SIN EVALUAR';
  const client = item.latest_customer_intent || item.conversation_status || 'SIN SEÑAL';
  const issue = item.active_issue_type || (Number(item.incident_count || 0) ? `${item.incident_count} incidencia(s)` : 'Sin incidencia');
  const recommendation = node('div', 'decision-summary'); recommendation.append(stacked(decision, (item.blocking_reasons || []).join(' · ') || `Riesgo ${text(item.risk)}`), protectionBadges(item));
  tr.append(
    cell(stacked(`#${short(item.dropea_order_id)}`, date(item.created_at_utc))),
    cell(stacked(productText(item.product_display_names), `${item.product_summary?.total_units ?? '—'} unidad(es)`)),
    cell(recommendation),
    cell(actionStatus(item)),
    cell(stacked(client, item.contradiction ? 'Contradicción detectada' : text(item.conversation_status, 'Sin conversación'))),
    cell(stacked(text(item.lifecycle_status || item.status), issue)),
    cell(stacked(money(item.total_amount, item.currency), text(item.payment_method))),
    cell(badge(item.data_quality_status || item.freshness))
  );
  tr.addEventListener('click', () => openDetail(item.canonical_order_id)); tr.addEventListener('keydown', (event) => { if (event.key === 'Enter') openDetail(item.canonical_order_id); }); return tr;
}
function rowIncident(item) {
  const tr = node('tr'); tr.tabIndex = 0;
  const customer = item.customer_replied_after_issue ? 'RESPONDIÓ' : (item.conversation_status || 'SIN RESPUESTA');
  const decision = item.simulated_decision || 'REVISIÓN PENDIENTE';
  const action = item.simulated_action_type || 'NINGUNA';
  tr.append(
    cell(stacked(`#${short(item.dropea_issue_id)}`, `Pedido #${short(item.dropea_order_id)}`)),
    cell(stacked(text(item.normalized_type), text(item.initial_carrier_description_sanitized || item.initial_carrier_code))),
    cell(stacked(customer, text(item.customer_intent || item.conversation_reason))),
    cell(stacked(decision, `Propuesta: ${action}`)),
    cell(stacked(text(item.interpretation_summary, 'Sin explicación disponible'), `Confianza ${text(item.interpretation_confidence)}`)),
    cell(stacked(text(item.carrier), `Intento ${text(item.delivery_attempt_number)}`)),
    cell(stacked(text(item.risk), `QA ${text(item.qa_status)}`)),
    cell(stacked(date(item.timer_due_at), text(item.timer_status))),
    cell(badge(item.data_quality_status || item.freshness))
  );
  tr.addEventListener('click', () => openDetail(item.canonical_issue_id)); tr.addEventListener('keydown', (event) => { if (event.key === 'Enter') openDetail(item.canonical_issue_id); }); return tr;
}
function renderHead() { const labels = state.view === 'orders' ? ['Pedido / fecha', 'Producto', 'Decisión recomendada', 'Acción real', 'Señal del cliente', 'Estado / incidencia', 'Importe', 'Calidad'] : ['Incidencia / pedido', 'Situación', 'Cliente', 'Decisión del agente', 'Explicación', 'GLS', 'Riesgo / QA', 'Temporizador', 'Calidad']; const tr = node('tr'); labels.forEach((label) => tr.append(node('th', '', label))); $('table-head').replaceChildren(tr); }

async function loadQueue() { if (state.view === 'finance') return; showNotice(''); const params = new URLSearchParams({ limit: String(state.limit), offset: String(state.offset) }); Object.entries(state.filters).forEach(([key, value]) => { if (value) params.set(key, value); }); try { const data = await api(`/api/operations/${state.view}?${params}`); state.total = data.total; const body = $('table-body'); body.replaceChildren(...data.items.map(state.view === 'orders' ? rowOrder : rowIncident)); $('empty-state').hidden = data.items.length > 0; $('result-count').textContent = `${data.total} registros`; $('prev-page').disabled = state.offset === 0; $('next-page').disabled = state.offset + state.limit >= data.total; } catch (error) { showNotice(error.message); } }
function field(label, value, asBadge = false) { const el = node('div', 'field'); el.append(node('span', '', label), asBadge ? badge(value) : node('strong', '', text(value))); return el; }
function section(title, fields, className = '') { const box = node('section', `detail-section ${className}`.trim()); box.append(node('h3', '', title)); const grid = node('div', 'field-grid'); fields.forEach((item) => grid.append(field(...item))); box.append(grid); return box; }
function timeline(items) { const box = node('section', 'detail-section'); box.append(node('h3', '', 'Cronología')); const list = node('div', 'timeline'); for (const item of items || []) { const row = node('div', 'timeline-item'); row.append(node('strong', '', text(item.event_type)), node('span', '', `${date(item.occurred_at)} · ${text(item.source)} · ${text(item.freshness)}`)); list.append(row); } if (!(items || []).length) list.append(node('span', '', 'Sin eventos disponibles')); box.append(list); return box; }
function relatedIncidents(items) { const box = node('section', 'detail-section'); box.append(node('h3', '', 'Incidencias relacionadas')); if (!(items || []).length) { box.append(node('p', 'muted', 'Este pedido no tiene incidencias registradas.')); return box; } const list = node('div', 'related-list'); for (const item of items) list.append(stacked(`${text(item.normalized_type)} · ${text(item.status)}`, `${text(item.carrier)} · ${date(item.updated_at)}`)); box.append(list); return box; }
async function openDetail(id) {
  $('drawer-backdrop').hidden = false; $('detail-drawer').classList.add('open'); $('detail-drawer').setAttribute('aria-hidden', 'false'); $('detail-title').textContent = 'Cargando…'; $('detail-content').replaceChildren();
  try {
    const data = await api(`/api/operations/${state.view}/${encodeURIComponent(id)}`); const root = $('detail-content');
    if (state.view === 'orders') {
      const order = data.order; $('detail-title').textContent = `Pedido ${short(order.dropea_order_id)}`;
      root.append(
        section('Pedido', [['Estado', order.lifecycle_status || order.status, true], ['Subestado', order.sub_status], ['Producto', productText(order.product_display_names)], ['Unidades', order.product_summary?.total_units], ['Importe', money(order.total_amount, order.currency)], ['Pago', order.payment_method], ['Transportista', order.carrier], ['Datos', order.data_quality_status || order.freshness, true]]),
        section('PROTECCIONES OPERATIVAS', [['Teléfono', order.phone_last4 ? `***${order.phone_last4}` : '—'], ['Duplicado', order.duplicate_status || 'NO', true], ['Pedido TEST', order.test_order ? 'SÍ' : 'NO', true], ['Confirmación automática', order.automatic_confirmation_allowed ? 'PERMITIDA' : 'BLOQUEADA', true], ['Chatby cleanup', order.chatby_cleanup_status || 'NO EVALUADO', true], ['Bloqueos Chatby', (order.chatby_cleanup_blockers || []).join(', ') || 'NINGUNO'], ['Return block', order.return_block_status || 'NO EVALUADO', true], ['Motivo', order.return_block_reason || '—']]),
        section('Decisión operativa observada', [['Recomendación', order.simulated_decision || 'SIN EVALUAR', true], ['Acción simulada', order.simulated_action_type || 'NINGUNA', true], ['Política', order.policy_version], ['Riesgo', order.risk, true], ['Bloqueos', (order.blocking_reasons || []).join(', ') || 'NINGUNO'], ['Revisión humana', order.human_review ? 'REQUERIDA' : 'NO', true], ['Acciones reales', order.actions_executed || 0], ['Escrituras externas', order.production_writes || 0]], 'decision-card'),
        section('Señal del cliente', [['Conversación', order.conversation_status || 'UNKNOWN', true], ['Intención', order.latest_customer_intent || 'SIN SEÑAL', true], ['Respondió tras incidencia', order.customer_replied_after_issue ? 'SÍ' : 'NO'], ['Última actividad', date(order.latest_customer_activity_at)], ['Contradicción', order.contradiction ? 'SÍ' : 'NO', true], ['Temporizador', order.timer_status || 'NO ACTIVO', true], ['Vence', date(order.timer_due_at)]]),
        section('Ciclo de vida', [['Creado', date(order.created_at_utc)], ['Confirmado', date(order.confirmed_at_utc)], ['Procesando', date(order.processing_at_utc)], ['Entregado', date(order.delivered_at_utc)], ['Cancelado', date(order.cancelled_at_utc)], ['Devuelto', date(order.returned_at_utc)], ['Fuente', order.source_system], ['Actualizado', date(order.source_updated_at)]]),
        section('Control económico', [['Valor del pedido', money(order.total_amount, order.currency)], ['Costes reales', 'PENDIENTE DE FUENTE', true], ['Beneficio', 'NO CALCULABLE', true], ['Exactitud', 'SOLO VALOR DEL PEDIDO', true], ['Escrituras en Dropea', '0']]),
        relatedIncidents(data.incidents), timeline(data.timeline)
      );
    } else {
      const incident = data.incident; $('detail-title').textContent = `Incidencia ${short(incident.dropea_issue_id)}`;
      root.append(
        section('Situación logística', [['Tipo', incident.normalized_type, true], ['Tipo original', incident.raw_type], ['Estado', incident.status, true], ['Activa', incident.is_active ? 'SÍ' : 'NO'], ['Transportista', incident.carrier], ['Código carrier', incident.initial_carrier_code], ['Descripción', incident.initial_carrier_description_sanitized], ['Intento', incident.delivery_attempt_number], ['Antigüedad', incident.age_seconds ? `${Math.round(Number(incident.age_seconds) / 3600)} h` : '—']]),
        section('Información del cliente', [['Conversación', incident.conversation_status || 'UNKNOWN', true], ['Motivo', incident.conversation_reason], ['Respondió', incident.customer_replied_after_issue ? 'SÍ' : 'NO', true], ['Intención', incident.customer_intent || 'SIN SEÑAL', true], ['Resumen', incident.interpretation_summary], ['Confianza', incident.interpretation_confidence], ['Última actividad', date(incident.latest_customer_activity_at)], ['Último botón', incident.last_button_intent], ['Contradicción', incident.contradiction ? 'SÍ' : 'NO', true]]),
        section('Decisión del agente', [['Decisión', incident.simulated_decision || 'REVISIÓN PENDIENTE', true], ['Acción propuesta', incident.simulated_action_type || 'NINGUNA', true], ['Política', incident.policy_version], ['Riesgo', incident.risk, true], ['QA', incident.qa_status, true], ['Revisión humana', incident.human_review ? 'REQUERIDA' : 'NO', true], ['Bloqueos', (incident.blocking_reasons || []).join(', ') || 'NINGUNO'], ['Acciones ejecutadas', incident.actions_executed || 0], ['Escrituras externas', incident.production_writes || 0]], 'decision-card'),
        section('Evidencia y viabilidad', [['Capacidad Dropea', incident.capability_status, true], ['Resolución Dropea', incident.resolution_status, true], ['Opciones permitidas', (incident.allowed_resolution_options || []).join(', ') || 'NO INFORMADAS'], ['Mapeo GLS', incident.mapping_status, true], ['Temporizador', incident.timer_status || 'NO ACTIVO', true], ['Vence', date(incident.timer_due_at)], ['Frescura conversación', incident.conversation_freshness, true], ['Calidad general', incident.data_quality_status || incident.freshness, true]]),
        timeline(data.timeline)
      );
    }
  } catch (error) { $('detail-content').append(node('div', 'notice', error.message)); }
}
function closeDetail() { $('drawer-backdrop').hidden = true; $('detail-drawer').classList.remove('open'); $('detail-drawer').setAttribute('aria-hidden', 'true'); }

function financeMetric(label, value, detail, tone = '') { const card = node('article', `finance-metric ${tone}`.trim()); card.append(node('span', '', label), node('strong', '', value), node('small', '', detail)); return card; }
function renderFinance() {
  const data = state.finance; if (!data) return;
  const totals = data.totals || {}; const currency = totals.currency || 'EUR';
  $('last-sync').textContent = date(totals.source_updated_at);
  $('finance-hero').replaceChildren(
    financeMetric('Valor bruto de pedidos', money(totals.gross_order_value, currency), 'Importe de pedidos en la cohorte', 'primary'),
    financeMetric('Valor de pedidos entregados', money(totals.delivered_order_value, currency), 'No equivale todavía a cobro conciliado', 'positive'),
    financeMetric('Valor comprometido abierto', money(totals.open_order_value, currency), `${text(totals.open_orders, '0')} pedidos abiertos`, 'warning'),
    financeMetric('Gastos totales', 'No disponible', 'Pendiente de fuente conciliada', 'unknown'),
    financeMetric('Beneficio · ROI · Margen', 'No calculable', 'No se estiman costes ausentes', 'unknown')
  );
  const funnel = [
    ['Pedidos Dropea', totals.orders_total], ['Confirmados', totals.confirmed], ['Enviados', totals.shipping],
    ['Entregados', totals.delivered], ['En el aire', totals.open_orders], ['Incidencias', totals.incidences], ['Devueltos', totals.returned]
  ];
  $('finance-funnel').replaceChildren(...funnel.map(([label, value]) => summaryCard(label, value, percentage(value, totals.orders_total))));
  const costs = [['Producto', data.costs?.product], ['Transporte', data.costs?.transport], ['Fulfillment', data.costs?.fulfillment], ['Contra reembolso', data.costs?.cod], ['Devoluciones', data.costs?.returns], ['Publicidad', data.costs?.advertising], ['Gastos externos', data.costs?.external]];
  $('finance-costs').replaceChildren(...costs.map(([label, value]) => { const row = node('div', 'cost-row'); row.append(node('strong', '', label), badge(value === null ? 'PENDIENTE DE FUENTE' : money(value, currency))); return row; }));
  const amountCoverage = percentage(totals.orders_with_amount, totals.orders_total);
  $('finance-quality').replaceChildren(
    stacked('Perspectiva', 'Cohorte Dropea por fecha de creación'),
    stacked('Cobertura de importes', `${amountCoverage} · ${text(totals.orders_with_amount, '0')} de ${text(totals.orders_total, '0')} pedidos`),
    stacked('Exactitud', 'Valor del pedido disponible · costes sin fuente'),
    stacked('Estado del cierre', data.provisional ? 'PROVISIONAL' : 'RECONCILIADO'),
    ...((data.limitations || []).map((item) => stacked('Límite conocido', item)))
  );
  $('finance-daily').replaceChildren(...(data.daily || []).map((item) => { const tr = node('tr'); tr.append(cell(date(item.day, true)), cell(item.orders), cell(item.delivered), cell(item.incidences), cell(item.returned), cell(money(item.gross_order_value, currency)), cell(money(item.delivered_order_value, currency)), cell('Pendiente de fuente'), cell('No calculable'), cell(badge('PROVISIONAL'))); return tr; }));
}
async function loadFinance() { showNotice(''); const period = $('finance-period').value; try { state.finance = await api(`/api/operations/finance?period=${encodeURIComponent(period)}`); renderFinance(); } catch (error) { showNotice(error.message); } }
async function refresh() { try { state.summary = await api('/api/operations/summary'); renderSummary(); if (state.view === 'finance') await loadFinance(); else await loadQueue(); } catch (error) { showNotice(error.message); } }
function setView(view) {
  state.view = view; state.offset = 0; state.filters = {}; closeDetail();
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
  const titles = { orders: 'Pedidos operativos', incidents: 'Incidencias', finance: 'Control de gasto' }; $('view-title').textContent = titles[view];
  const finance = view === 'finance'; $('summary').hidden = finance; $('finance-view').hidden = !finance; $('queue-card').hidden = finance;
  if (finance) { loadFinance(); return; }
  $('queue-title').textContent = view === 'orders' ? 'Pedidos observados' : 'Incidencias pendientes'; renderHead(); renderFilters(); renderSummary(); loadQueue();
}

async function init() {
  state.config = await fetch(`${operationsBase}/api/config`).then((response) => { if (!response.ok) throw new Error('Configuración privada no disponible.'); return response.json(); });
  const params = new URLSearchParams(location.search); state.token = activeToken();
  if (params.has('error')) { history.replaceState({}, document.title, location.pathname); throw new Error('El proveedor de acceso rechazó el inicio de sesión. Inténtalo de nuevo.'); }
  if (params.has('code')) state.token = await exchangeCode(params.get('code'), params.get('state'));
  if (!state.token) { await prepareLogin(); showLoginError(''); $('login').hidden = false; $('app').hidden = true; return; }
  $('login').hidden = true; $('app').hidden = false; renderHead(); renderFilters(); await refresh();
  setInterval(() => { if (document.visibilityState === 'visible' && activeToken()) refresh(); }, state.config.refresh_interval_seconds * 1000);
}
$('logout-button').addEventListener('click', () => signOut(true)); $('refresh-button').addEventListener('click', refresh); $('finance-period').addEventListener('change', loadFinance); $('prev-page').addEventListener('click', () => { state.offset = Math.max(0, state.offset - state.limit); loadQueue(); }); $('next-page').addEventListener('click', () => { state.offset += state.limit; loadQueue(); }); document.querySelectorAll('.nav-item').forEach((item) => item.addEventListener('click', () => setView(item.dataset.view))); $('close-drawer').addEventListener('click', closeDetail); $('drawer-backdrop').addEventListener('click', closeDetail); document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeDetail(); });
init().catch(async (error) => { $('login').hidden = false; $('app').hidden = true; try { if (state.config) await prepareLogin(); } catch {} showLoginError(error.message); });
