const state = { view: 'orders', offset: 0, limit: 25, total: 0, filters: { lifecycle: 'PENDING' }, config: null, token: null, summary: null, finance: null, queueRequest: 0, queueController: null, detailRequest: 0, detailController: null, refreshing: false };
const operationsBase = location.pathname.startsWith('/operations') ? '/operations' : '';
const $ = (id) => document.getElementById(id);
const text = (value, fallback = '—') => value === undefined || value === null || value === '' ? fallback : String(value);
const short = (value) => { const v = text(value); return v.length > 22 ? `${v.slice(0, 10)}…${v.slice(-7)}` : v; };
const date = (value, dateOnly = false) => { if (!value || typeof value === 'object') return '—'; const parsed = new Date(value); return Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat('es-ES', dateOnly ? { dateStyle: 'medium', timeZone: 'Europe/Madrid' } : { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Madrid' }).format(parsed) : '—'; };
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
async function api(path, { signal } = {}) { const response = await fetch(`${operationsBase}${path}`, { headers: { Authorization: `Bearer ${state.token}`, Accept: 'application/json' }, signal }); if (response.status === 401 || response.status === 403) { signOut(false); throw new Error('Tu sesión ha caducado.'); } if (response.status === 429) throw new Error('Demasiadas actualizaciones seguidas. Espera unos segundos.'); if (!response.ok) throw new Error('La lectura no está disponible temporalmente.'); return (await response.json()).data; }
function signOut(remote = true) { sessionStorage.removeItem('suleia_access_token'); sessionStorage.removeItem('suleia_token_expires_at'); state.token = null; $('app').hidden = true; $('login').hidden = false; if (remote && state.config) { const url = new URL(`${state.config.oauth.issuer}/protocol/openid-connect/logout`); url.searchParams.set('client_id', state.config.oauth.client_id); url.searchParams.set('post_logout_redirect_uri', redirectUri()); location.assign(url.toString()); } }

function badge(value) { const v = text(value); const lower = v.toLowerCase(); let tone = 'gray'; if (/ready|pass|exact|verified|delivered|finish|resolved|responded|permitida/.test(lower)) tone = 'green'; else if (/wait|pending|medium|review|active|incidence/.test(lower)) tone = 'amber'; else if (/high|critical|blocked|error|stale|conflict|reject|return|cancel/.test(lower)) tone = 'red'; else if (/human|simulation/.test(lower)) tone = 'purple'; else if (/info|shipping|transit/.test(lower)) tone = 'blue'; return node('span', `badge ${tone}`, v); }
function summaryCard(label, value, detail, tone = '') { const card = node('article', `summary-card ${tone}`.trim()); card.append(node('span', '', label), node('strong', '', text(value, '0')), node('small', '', detail)); return card; }
function showNotice(message) { const el = $('notice'); el.textContent = message; el.hidden = !message; }
function productText(value) { if (Array.isArray(value)) return value.filter(Boolean).join(', ') || 'Producto no informado'; if (typeof value === 'object' && value) return Object.values(value).filter((item) => typeof item === 'string').join(', ') || 'Producto no informado'; return text(value, 'Producto no informado'); }
function stacked(primary, secondary, className = '') { const box = node('div', `stacked ${className}`.trim()); box.append(node('strong', '', text(primary))); if (secondary) box.append(node('small', '', text(secondary))); return box; }
function percentage(value, total) { return total ? `${Math.round((Number(value || 0) / Number(total)) * 100)} %` : 'No disponible'; }
const labels = {
  ACTIVE: 'Activas', HISTORICAL: 'Históricas', ALL: 'Todas',
  ADDRESS_INCORRECT: 'Problema de dirección', RECIPIENT_ABSENT: 'Destinatario ausente',
  REFUSED_BY_RECIPIENT: 'Rechazado por destinatario', GENERAL_INCIDENCE: 'Incidencia general',
  UNKNOWN: 'No determinado', VALID_RESPONSE: 'Respuesta válida',
  NO_VALID_RESPONSE: 'Sin respuesta válida', NOT_VERIFIABLE: 'No verificable',
  UNMAPPED: 'Código pendiente de gobernar', MAPPED: 'Mapping gobernado', VERIFIED: 'Verificado',
  PENDING: 'Pendiente', RESOLVED: 'Resuelta', CLOSED: 'Cerrada',
  FRESH: 'Vigente', STALE: 'Caducado', UNAVAILABLE: 'No disponible',
  EXPIRED: 'Vencido', BLOCKED: 'Bloqueada', REVIEW: 'Revisión',
  CONFIRM: 'Confirmación clara', REJECT: 'Rechazo o cancelación', ADDRESS_CHANGE: 'Cambio de dirección',
  PROMOTION_CHANGE: 'Cambio de promoción', NO_RESPONSE: 'Sin respuesta', UNCLEAR: 'Respuesta no concluyente',
  NOT_VERIFIABLE: 'No verificable', NO_CONVERSATION: 'Sin conversación asociada',
  REVIEW_CHATBY_LINK: 'Revisar enlace con Chatby', REVIEW_CUSTOMER_RESPONSE: 'Revisar respuesta del cliente',
  WAITING_CUSTOMER: 'Esperando al cliente', HUMAN_REVIEW: 'Revisión humana',
  REVIEW_ADDRESS_CHANGE: 'Revisar dirección', REVIEW_DELIVERY_AVAILABILITY: 'Revisar disponibilidad',
  REVIEW_REJECTION: 'Revisar rechazo', REVIEW_INCIDENT: 'Revisar incidencia'
};
const blockerLabels = {
  CHATBY_AUTH_401: 'Chatby no autorizado (HTTP 401)', CHATBY_EVIDENCE_STALE: 'Evidencia de Chatby caducada',
  CHATBY_EVIDENCE_NOT_VERIFIABLE: 'Evidencia de Chatby no verificable', CHATBY_UNAVAILABLE: 'Chatby no disponible',
  MISSING_VALID_CUSTOMER_RESPONSE: 'Falta una respuesta válida del cliente', GLS_CODE_UNMAPPED: 'Código GLS sin mapping gobernado',
  POLICY_NOT_PERSISTED: 'Política no persistida', LOGISTICS_STATUS_UNKNOWN: 'Viabilidad logística no verificada',
  TIMER_EXPIRED_NOT_RECONCILED: 'Timer vencido pendiente de reconciliar', INSUFFICIENT_EVIDENCE: 'Evidencia insuficiente'
};
const proposalLabels = {
  VALIDATE_COMPLETE_ADDRESS: 'validar la dirección completa',
  VALIDATE_DELIVERY_AVAILABILITY: 'validar disponibilidad para la entrega',
  HUMAN_REVIEW_REQUIRED: 'realizar una revisión humana del expediente'
};
const translated = (value) => labels[value] || text(value);
const translatedBlockers = (values) => (values || []).map((value) => blockerLabels[value] || value);
const proposal = (value) => proposalLabels[value] || text(value, 'revisión humana del expediente');
const duration = (seconds) => { if (seconds === null || seconds === undefined || seconds === '') return '—'; const value = Math.max(0, Number(seconds)); if (!Number.isFinite(value)) return '—'; if (value >= 86400) return `${Math.floor(value / 86400)} d ${Math.floor((value % 86400) / 3600)} h`; if (value >= 3600) return `${Math.floor(value / 3600)} h`; return `${Math.floor(value / 60)} min`; };
const optionLabel = (key, value) => key === 'timer' && value === 'ACTIVE' ? 'Activo' : key === 'active' ? (value === 'true' ? 'Activa' : 'Inactiva') : translated(value);

function renderSummary() {
  const root = $('summary'); root.replaceChildren();
  if (state.view === 'finance') return;
  const data = state.view === 'orders' ? state.summary?.orders : state.summary?.incidents;
  if (state.view === 'orders') {
    root.append(
      summaryCard('Con respuesta', data?.with_customer_response, 'Cliente contestó en Chatby', 'green'),
      summaryCard('Pedido previo', data?.prior_order, 'Posible duplicidad a revisar', 'red'),
      summaryCard('Cola operativa', data?.pending, 'Solo pendientes de Dropshipper'),
      summaryCard('Confirmar ahora', data?.confirm_now, 'Señal clara; se respetan todas las reglas', 'green'),
      summaryCard('Dirección', data?.address_change, 'No confirmar hasta revisar', 'amber'),
      summaryCard('Incidencias', data?.with_active_issue ?? data?.incidence, 'Seguimiento antes de actuar', 'amber'),
      summaryCard('Bloqueados', Number(data?.reject_signal || 0) + Number(data?.review_signal || 0), 'Rechazo, ambigüedad o falta de evidencia', 'red')
    );
  } else {
    const activeScope = (data?.scope || 'ACTIVE') === 'ACTIVE';
    const updated = `Actualizado ${date(data?.last_sync_at)}`;
    root.append(
      summaryCard(activeScope ? 'Pendientes' : 'Seleccionadas', data?.pending, `${activeScope ? 'Incidencias activas de Dropea' : `Alcance: ${translated(data?.scope)}`} · ${updated}`),
      summaryCard('Con respuesta', data?.responded, `Respuesta posterior a la incidencia · ${updated}`, 'green'),
      summaryCard('Alta prioridad', data?.high_risk, `Requiere atención · ${updated}`, 'red'),
      summaryCard('Destinatario ausente', data?.recipient_absent, `Seguimiento de entrega · ${updated}`, 'amber'),
      summaryCard('Dirección / datos', data?.address_issues, `Datos de envío a revisar · ${updated}`, 'amber'),
      summaryCard('No acepta mercancía', data?.refused, `Rechazo del destinatario · ${updated}`, 'red'),
      summaryCard('Sin Chatby', data?.without_conversation, `No es un fallo de conexión: falta asociación técnica · ${updated}`, 'purple'),
      summaryCard('Fuente no vigente', data?.stale, `Dropea o Chatby no sincronizados recientemente · ${updated}`, 'red')
    );
  }
  const last = data?.last_sync_at || state.summary?.protections?.last_reconciled_at;
  $('last-sync').textContent = date(last);
  if (data?.stale > 0) showNotice('Hay datos desactualizados. Las decisiones afectadas permanecen bloqueadas.');
}

const filterDefinitions = {
  orders: [],
  incidents: [
    ['scope', 'Alcance', ['ACTIVE', 'HISTORICAL', 'ALL']],
    ['active', 'Actividad', ['true', 'false']],
    ['status', 'Estado', ['PENDING', 'RESOLVED', 'CLOSED']],
    ['type', 'Tipo', ['RECIPIENT_ABSENT', 'ADDRESS_INCORRECT', 'PENDING_DATA', 'REFUSED_BY_RECIPIENT', 'POSSIBLE_RETURN', 'RETURN_REQUESTED', 'PICKUP_AT_AGENCY', 'DELIVERY_FAILED', 'ADMINISTRATIVE_ISSUE', 'PENDING_AUTHORIZATION', 'RETAINED', 'CUSTOMS_ISSUE', 'DAMAGED_PACKAGE', 'LOST_PACKAGE', 'GENERAL_INCIDENCE', 'UNKNOWN']],
    ['mapping', 'Mapping GLS', ['MAPPED', 'VERIFIED', 'UNMAPPED', 'UNKNOWN']],
    ['response', 'Evidencia cliente', ['VALID_RESPONSE', 'NO_VALID_RESPONSE', 'NO_CONVERSATION', 'NOT_VERIFIABLE']],
    ['risk', 'Riesgo', ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']],
    ['freshness', 'Datos', ['FRESH', 'STALE', 'UNAVAILABLE', 'UNKNOWN']],
    ['qa', 'QA', ['PASS', 'REVIEW', 'BLOCKED']],
    ['timer', 'Timer efectivo', ['ACTIVE', 'EXPIRED', 'COMPLETED', 'CANCELLED']],
    ['decision', 'Situación', ['REVIEW_CHATBY_LINK', 'REVIEW_CUSTOMER_RESPONSE', 'WAITING_CUSTOMER', 'HUMAN_REVIEW']]
  ]
};
function renderFilters() {
  const root = $('filters'); root.replaceChildren();
  const changed = (key, value) => {
    state.filters[key] = value; state.offset = 0;
    if (key === 'scope' && value === 'ACTIVE') { delete state.filters.active; delete state.filters.status; }
    if ((key === 'active' && value === 'false') || (key === 'status' && value && value !== 'PENDING')) state.filters.scope = 'ALL';
    renderFilters(); loadQueue();
  };
  if (state.view === 'orders') {
    for (const [value, label] of [['', 'Todos'], ['CONFIRM', 'Confirmar'], ['ADDRESS', 'Dirección'], ['INCIDENTS', 'Incidencias'], ['REJECT', 'No confirmar'], ['REVIEW', 'Revisión'], ['NO_RESPONSE', 'Sin respuesta']]) {
      const button = node('button', `filter-chip ${(state.filters.category || '') === value ? 'active' : ''}`.trim(), label);
      button.type = 'button'; button.addEventListener('click', () => changed('category', value)); root.append(button);
    }
    return;
  }
  for (const [key, label, options] of filterDefinitions[state.view] || []) {
    const select = node('select', 'filter-select'); select.setAttribute('aria-label', label);
    select.append(new Option(`Todos · ${label}`, ''));
    for (const option of options) select.append(new Option(optionLabel(key, option), option));
    select.value = state.filters[key] || '';
    select.addEventListener('change', () => changed(key, select.value)); root.append(select);
  }
  if (state.view === 'incidents') {
    for (const [key, label, type] of [['q', 'Pedido o incidencia', 'search'], ['carrier_code', 'Código GLS', 'search'], ['from', 'Desde', 'date'], ['to', 'Hasta', 'date']]) {
      const input = node('input', 'filter-select'); input.type = type; input.placeholder = label;
      input.setAttribute('aria-label', label); input.value = state.filters[key] || '';
      input.addEventListener('change', () => changed(key, input.value));
      if (type === 'search') input.addEventListener('keydown', (event) => { if (event.key === 'Enter') changed(key, input.value); });
      root.append(input);
    }
  }
}
function cell(content, className = '') { const td = node('td', className); td.append(content instanceof Node ? content : document.createTextNode(text(content))); return td; }
function actionStatus(item) {
  const lifecycle = item.lifecycle_status || item.status;
  if (lifecycle && lifecycle !== 'PENDING') return stacked(`Estado real: ${translated(lifecycle)}`, `Dropea · ${date(item.source_updated_at)}`, 'safe-action');
  return Number(item.actions_executed || 0) === 0 ? stacked('Sin acción real', 'Observación segura · 0 ejecuciones', 'safe-action') : stacked('Revisión requerida', 'Estado inesperado', 'blocked-action');
}
function protectionBadges(item) { const box = node('div', 'protection-badges'); if (item.duplicate_status === 'DUPLICATE_ACTIVE_ORDER') box.append(badge('DUPLICADO')); if (item.test_order) box.append(badge('TEST')); if (item.chatby_cleanup_status === 'DELETE_ELIGIBLE') box.append(badge('CHATBY CLEANUP')); if (['BLOCK_ELIGIBLE', 'BLOCK_PENDING', 'BLOCK_REQUESTED', 'BLOCKED_VERIFIED'].includes(item.return_block_status)) box.append(badge('RETURN BLOCK')); return box; }
function orderRecommendation(item) {
  if (item.duplicate_status === 'DUPLICATE_ACTIVE_ORDER') return ['Revisar pedido previo', 'No confirmar hasta descartar duplicidad'];
  if (item.active_issue_id) return ['Resolver incidencia', `Incidencia ${translated(item.active_issue_type)}`];
  const intent = item.latest_customer_intent || 'NO_RESPONSE';
  const values = {
    CONFIRM: ['Confirmar según reglas', 'Señal clara del cliente; mantener demoras y protecciones'],
    REJECT: ['No confirmar', 'El cliente rechaza o cancela el pedido'],
    ADDRESS_CHANGE: ['Revisar dirección', 'No confirmar hasta corregir los datos de envío'],
    PROMOTION_CHANGE: ['Revisar promoción', 'El cliente solicita modificar el pedido'],
    NO_RESPONSE: ['Esperar respuesta', 'No hay una señal clara del cliente'],
    UNCLEAR: ['Revisar respuesta', 'La respuesta no permite decidir con seguridad'],
    NOT_VERIFIABLE: ['Revisión manual', 'La evidencia disponible no es verificable'],
    UNKNOWN: ['Revisión manual', 'No hay clasificación suficiente']
  };
  return values[intent] || values.UNKNOWN;
}
function rowOrder(item) {
  const tr = node('tr'); tr.tabIndex = 0;
  const [recommended, reason] = orderRecommendation(item);
  const client = item.latest_customer_intent || 'NO_RESPONSE';
  const confidence = item.customer_signal_confidence === null || item.customer_signal_confidence === undefined ? 'Confianza no disponible' : `Confianza ${Math.round(Number(item.customer_signal_confidence) * 100)} %`;
  const recommendation = node('div', 'decision-summary'); recommendation.append(stacked(recommended, reason), protectionBadges(item));
  const customer = item.safe_customer_reference ? `Teléfono ···${item.safe_customer_reference}` : 'Cliente protegido';
  const quality = node('div', 'stacked'); quality.append(badge(item.data_quality_status || item.freshness), node('small', '', `Actualizado ${date(item.source_updated_at)}`));
  tr.append(
    cell(stacked(`#${short(item.dropea_order_id)}`, date(item.created_at_utc))),
    cell(stacked(productText(item.product_display_names), `${item.product_summary?.total_units ?? '—'} unidad(es) · Dropea + Chatby`)),
    cell(recommendation),
    cell(actionStatus(item)),
    cell(stacked(translated(client), `${Number(item.customer_messages || 0)} mensaje(s) · ${confidence}`)),
    cell(stacked(customer, money(item.total_amount, item.currency))),
    cell(quality)
  );
  tr.addEventListener('click', () => openDetail(item.canonical_order_id)); tr.addEventListener('keydown', (event) => { if (event.key === 'Enter') openDetail(item.canonical_order_id); }); return tr;
}
function rowIncident(item) {
  const tr = node('tr'); tr.tabIndex = 0;
  const customer = translated(item.operational_response_status);
  const conversation = item.conversation_status === 'FOUND' ? 'Conversación localizada' : item.conversation_status === 'NONE' ? 'Sin conversación asociada' : 'Asociación no verificable';
  const timer = item.effective_timer_status === 'EXPIRED' ? 'Plazo vencido; revisar' : translated(item.effective_timer_status);
  const quality = node('div', 'stacked'); quality.append(badge(item.operational_freshness_status), node('small', '', `Actualizado ${date(item.panel_updated_at || item.updated_at)}`));
  tr.append(
    cell(stacked(`#${short(item.dropea_issue_id)}`, `Pedido #${short(item.dropea_order_id)}`)),
    cell(stacked(translated(item.interpreted_type), `${translated(item.status)} · ${item.is_active ? 'Activa' : 'Inactiva'} · ${text(item.carrier)}`)),
    cell(stacked(customer, `${conversation} · ${Number(item.messages_used || 0)} mensaje(s)`)),
    cell(stacked(translated(item.operational_decision_status), timer)),
    cell(stacked(translated(item.operational_recommendation), 'Propuesta de revisión; ninguna acción ejecutada')),
    cell(stacked(`Dropea ${item.dropea_sync_current ? 'conectado' : 'sincronización atrasada'}`, `Chatby ${item.chatby_sync_current ? 'conectado' : 'sincronización atrasada'}`)),
    cell(quality)
  );
  tr.addEventListener('click', () => openDetail(item.canonical_issue_id)); tr.addEventListener('keydown', (event) => { if (event.key === 'Enter') openDetail(item.canonical_issue_id); }); return tr;
}
function renderHead() { const labels = state.view === 'orders' ? ['Pedido / fecha', 'Producto', 'Acción recomendada', 'Acción real', 'Señal del cliente', 'Cliente / importe', 'Calidad'] : ['Incidencia / pedido', 'Motivo', 'Señal del cliente', 'Estado operativo', 'Acción recomendada', 'Conexiones', 'Calidad']; const tr = node('tr'); labels.forEach((label) => tr.append(node('th', '', label))); $('table-head').replaceChildren(tr); }

async function loadQueue() {
  if (state.view === 'finance') return;
  const view = state.view; const request = ++state.queueRequest;
  state.queueController?.abort(); state.queueController = new AbortController();
  showNotice(''); $('queue-card').setAttribute('aria-busy', 'true');
  const params = new URLSearchParams({ limit: String(state.limit), offset: String(state.offset) });
  Object.entries(state.filters).forEach(([key, value]) => { if (value) params.set(key, value); });
  try {
    const endpoint = view === 'incidents' ? `/api/operations/incidents/overview?${params}` : `/api/operations/orders?${params}`;
    const data = await api(endpoint, { signal: state.queueController.signal });
    if (request !== state.queueRequest || view !== state.view) return;
    if (view === 'incidents') { state.summary = { ...(state.summary || {}), incidents: data.summary }; renderSummary(); }
    if (data.total > 0 && state.offset >= data.total) {
      state.offset = Math.floor((data.total - 1) / state.limit) * state.limit;
      loadQueue(); return;
    }
    if (data.total === 0) state.offset = 0;
    state.total = data.total; if (view === 'orders') renderSummary(); const items = data.items || []; const body = $('table-body');
    body.replaceChildren(...items.map(view === 'orders' ? rowOrder : rowIncident)); $('empty-state').hidden = items.length > 0;
    $('result-count').textContent = `${data.total} registros`; $('page-status').textContent = data.total ? `${state.offset + 1}–${Math.min(state.offset + state.limit, data.total)} de ${data.total}` : '0 de 0';
    $('prev-page').disabled = state.offset === 0; $('next-page').disabled = state.offset + state.limit >= data.total;
  } catch (error) { if (error.name !== 'AbortError' && request === state.queueRequest) showNotice(error.message); }
  finally { if (request === state.queueRequest) $('queue-card').setAttribute('aria-busy', 'false'); }
}
function field(label, value, asBadge = false) { const el = node('div', 'field'); el.append(node('span', '', label), asBadge ? badge(value) : node('strong', '', text(value))); return el; }
function section(title, fields, className = '') { const box = node('section', `detail-section ${className}`.trim()); box.append(node('h3', '', title)); const grid = node('div', 'field-grid'); fields.forEach((item) => grid.append(field(...item))); box.append(grid); return box; }
function timeline(items) { const box = node('section', 'detail-section'); box.append(node('h3', '', 'Cronología')); const list = node('div', 'timeline'); for (const item of items || []) { const row = node('div', 'timeline-item'); row.append(node('strong', '', text(item.event_type)), node('span', '', `${date(item.occurred_at)} · ${text(item.source)} · ${text(item.freshness)}`)); list.append(row); } if (!(items || []).length) list.append(node('span', '', 'Sin eventos disponibles')); box.append(list); return box; }
function relatedIncidents(items) { const box = node('section', 'detail-section'); box.append(node('h3', '', 'Incidencias relacionadas')); if (!(items || []).length) { box.append(node('p', 'muted', 'Este pedido no tiene incidencias registradas.')); return box; } const list = node('div', 'related-list'); for (const item of items) list.append(stacked(`${text(item.normalized_type)} · ${text(item.status)}`, `${text(item.carrier)} · ${date(item.updated_at)}`)); box.append(list); return box; }
async function openDetail(id) {
  const view = state.view; const request = ++state.detailRequest;
  state.detailController?.abort(); state.detailController = new AbortController();
  $('drawer-backdrop').hidden = false; $('detail-drawer').classList.add('open'); $('detail-drawer').setAttribute('aria-hidden', 'false'); $('detail-title').textContent = 'Cargando…'; $('detail-content').replaceChildren();
  try {
    const data = await api(`/api/operations/${view}/${encodeURIComponent(id)}`, { signal: state.detailController.signal });
    if (request !== state.detailRequest || view !== state.view) return;
    const root = $('detail-content');
    if (view === 'orders') {
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
        section('Identidad y situación', [['ID canónico incidencia', incident.canonical_issue_id], ['ID Dropea incidencia', incident.dropea_issue_id], ['ID canónico pedido', incident.canonical_order_id], ['ID Dropea pedido', incident.dropea_order_id], ['Mercado / tienda', `${text(incident.market)} / ${text(incident.store_id)}`], ['Identidad', incident.identity_status, true], ['Estado', translated(incident.status), true], ['Activa', incident.is_active ? 'SÍ' : 'NO'], ['Creada', date(incident.created_at)], ['Actualizada', date(incident.updated_at)], ['Antigüedad', duration(incident.age_seconds)], ['Resolución', incident.resolution_status || 'NO DISPONIBLE']]),
        section('Tipología, GLS y capacidad', [['Tipo normalizado', translated(incident.normalized_type)], ['Tipo original Dropea', translated(incident.raw_type)], ['Tipo interpretado', translated(incident.interpreted_type), true], ['Base de interpretación', incident.interpretation_basis], ['Transportista', incident.carrier], ['Código GLS original', incident.initial_carrier_code], ['Subestado GLS', incident.initial_carrier_substatus_code], ['Descripción observada', incident.initial_carrier_description_sanitized], ['Mapping gobernado', incident.mapping_status === 'UNMAPPED' ? 'Código GLS pendiente de gobernar' : translated(incident.mapping_status), true], ['Confianza mapping', incident.mapping_confidence ?? 'NO DISPONIBLE'], ['Intento', incident.delivery_attempt_number], ['Capacidad Dropea', incident.capability_status, true], ['Opciones permitidas', (incident.allowed_resolution_options || []).join(', ') || 'NO INFORMADAS']]),
        section('Evidencia del cliente', [['Conversación', incident.conversation_status === 'FOUND' ? 'Conversación localizada' : incident.conversation_status === 'NONE' ? 'Sin conversación asociada' : 'Asociación no verificable', true], ['Motivo del enlace', incident.conversation_reason], ['Método de identidad', incident.conversation_identity_method], ['Estado operativo', translated(incident.operational_response_status), true], ['Intención', incident.operational_response_status === 'VALID_RESPONSE' ? incident.customer_intent : 'SIN SEÑAL VERIFICADA'], ['Mensajes usados', incident.messages_used ?? 0], ['Última actividad cliente', date(incident.latest_customer_activity_at)], ['Última actividad Suleia', date(incident.latest_suleia_activity_at)], ['Contradicción', incident.contradiction ? 'SÍ' : 'NO', true]]),
        section('Decisión y propuesta', [['Situación operativa', translated(incident.operational_decision_status), true], ['Acción recomendada', translated(incident.operational_recommendation), true], ['Justificación', incident.reason_summary], ['Riesgo', incident.effective_risk || incident.risk || 'NO EVALUABLE', true], ['QA', incident.effective_qa_status, true], ['Bloqueos observados', translatedBlockers(incident.effective_blocking_reasons).join(', ') || 'NINGUNO'], ['Acción externa', 'NO EJECUTADA', true], ['Acciones ejecutadas', incident.actions_executed || 0], ['Escrituras externas', incident.production_writes || 0]], 'decision-card'),
        section('Plazos y conexiones', [['Estado del plazo', translated(incident.effective_timer_status), true], ['Esperando cliente', incident.waiting_customer ? 'SÍ' : 'NO'], ['Inicio', date(incident.timer_started_at)], ['Vence', date(incident.timer_due_at)], ['Retraso', duration(incident.overdue_seconds)], ['Estado de datos', translated(incident.operational_freshness_status), true], ['Dropea', incident.dropea_sync_current ? 'CONECTADO' : 'SINCRONIZACIÓN ATRASADA', true], ['Última lectura Dropea', date(incident.last_successful_sync_at)], ['Chatby', incident.chatby_sync_current ? 'CONECTADO' : 'SINCRONIZACIÓN ATRASADA', true], ['Última lectura Chatby', date(incident.chatby_last_successful_sync_at)]]),
        timeline(data.timeline)
      );
    }
  } catch (error) { if (error.name !== 'AbortError' && request === state.detailRequest) $('detail-content').append(node('div', 'notice', error.message)); }
}
function closeDetail() { state.detailRequest += 1; state.detailController?.abort(); $('drawer-backdrop').hidden = true; $('detail-drawer').classList.remove('open'); $('detail-drawer').setAttribute('aria-hidden', 'true'); }

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
async function refresh() {
  if (state.refreshing) return; state.refreshing = true; $('refresh-button').disabled = true; $('refresh-button').textContent = 'Actualizando…';
  try {
    if (state.view === 'finance') await loadFinance();
    else if (state.view === 'incidents') await loadQueue();
    else {
      const [summary] = await Promise.all([api('/api/operations/summary'), loadQueue()]);
      state.summary = summary; renderSummary();
    }
  } catch (error) { showNotice(error.message); }
  finally { state.refreshing = false; $('refresh-button').disabled = false; $('refresh-button').textContent = 'Actualizar'; }
}
function setView(view) {
  state.view = view; state.offset = 0; state.filters = view === 'incidents' ? { scope: 'ACTIVE' } : view === 'orders' ? { lifecycle: 'PENDING' } : {}; closeDetail();
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
  const titles = { orders: 'Pedidos operativos', incidents: 'Incidencias', finance: 'Control de gasto' }; $('view-title').textContent = titles[view];
  const finance = view === 'finance'; $('summary').hidden = finance; $('finance-view').hidden = !finance; $('queue-card').hidden = finance;
  if (finance) { loadFinance(); return; }
  $('queue-title').textContent = view === 'orders' ? 'Pendientes de Dropshipper · Render + Dropea + Chatby' : 'Incidencias activas · Dropea + Chatby'; renderHead(); renderFilters(); renderSummary(); loadQueue();
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
$('logout-button').addEventListener('click', () => signOut(true)); $('refresh-button').addEventListener('click', refresh); $('finance-period').addEventListener('change', loadFinance); $('page-size').addEventListener('change', (event) => { state.limit = Number(event.target.value); state.offset = 0; loadQueue(); }); $('prev-page').addEventListener('click', () => { state.offset = Math.max(0, state.offset - state.limit); loadQueue(); }); $('next-page').addEventListener('click', () => { state.offset += state.limit; loadQueue(); }); document.querySelectorAll('.nav-item').forEach((item) => item.addEventListener('click', () => setView(item.dataset.view))); $('close-drawer').addEventListener('click', closeDetail); $('drawer-backdrop').addEventListener('click', closeDetail); document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeDetail(); });
init().catch(async (error) => { $('login').hidden = false; $('app').hidden = true; try { if (state.config) await prepareLogin(); } catch {} showLoginError(error.message); });
