const state = { view: 'orders', offset: 0, limit: 25, total: 0, filters: {}, config: null, token: null, summary: null, finance: null, financeMonths: [], queueRequest: 0, queueController: null, detailRequest: 0, detailController: null, refreshing: false };
const operationsBase = location.pathname.startsWith('/operations') ? '/operations' : '';
const $ = (id) => document.getElementById(id);
const text = (value, fallback = '—') => value === undefined || value === null || value === '' ? fallback : String(value);
const short = (value) => { const v = text(value); return v.length > 22 ? `${v.slice(0, 10)}…${v.slice(-7)}` : v; };
const orderReferenceLabel = (value) => { const v = text(value); return v.startsWith('#') ? v : `#${v}`; };
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
async function api(path, { signal, method = 'GET', body } = {}) { const response = await fetch(`${operationsBase}${path}`, { method, headers: { Authorization: `Bearer ${state.token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal }); if (response.status === 401 || response.status === 403) { signOut(false); throw new Error('Tu sesión ha caducado.'); } if (response.status === 429) throw new Error('Demasiadas actualizaciones seguidas. Espera unos segundos.'); if (!response.ok) throw new Error('La operación no está disponible temporalmente.'); return (await response.json()).data; }
function signOut(remote = true) { sessionStorage.removeItem('suleia_access_token'); sessionStorage.removeItem('suleia_token_expires_at'); state.token = null; $('app').hidden = true; $('login').hidden = false; if (remote && state.config) { const url = new URL(`${state.config.oauth.issuer}/protocol/openid-connect/logout`); url.searchParams.set('client_id', state.config.oauth.client_id); url.searchParams.set('post_logout_redirect_uri', redirectUri()); location.assign(url.toString()); } }

function badge(value) { const v = text(value); const lower = v.toLowerCase(); let tone = 'gray'; if (/ready|pass|exact|verified|delivered|finish|resolved|responded|permitida/.test(lower)) tone = 'green'; else if (/wait|pending|medium|review|active|incidence/.test(lower)) tone = 'amber'; else if (/high|critical|blocked|error|stale|conflict|reject|return|cancel/.test(lower)) tone = 'red'; else if (/human|simulation/.test(lower)) tone = 'purple'; else if (/info|shipping|transit/.test(lower)) tone = 'blue'; return node('span', `badge ${tone}`, v); }
function summaryCard(label, value, detail, tone = '', onClick = null, active = false) { const card = node(onClick ? 'button' : 'article', `summary-card ${tone} ${onClick ? 'filterable' : ''} ${active ? 'selected' : ''}`.trim()); if (onClick) { card.type = 'button'; card.addEventListener('click', onClick); card.setAttribute('aria-pressed', String(active)); } card.append(node('span', '', label), node('strong', '', text(value, '0')), node('small', '', detail)); return card; }
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
  CUSTOMER_STILL_WANTS_ORDER: 'Quiere recibir el pedido', DELIVERY_RETRY: 'Solicita nueva entrega',
  PICKUP_AT_AGENCY: 'Solicita recogida en agencia', FINAL_REJECTION: 'Rechazo definitivo',
  RETURN_REQUEST: 'Solicita devolución', CHANGE_ADDRESS: 'Cambio de dirección',
  PROVIDE_MISSING_DATA: 'Aporta los datos solicitados',
  DISCOUNT_ACCEPTED: 'Descuento de 5 € aceptado', DISCOUNT_REJECTED: 'Descuento rechazado',
  PROMOTION_CHANGE: 'Cambio de promoción', NO_RESPONSE: 'Sin respuesta', UNCLEAR: 'Respuesta no concluyente',
  NOT_VERIFIABLE: 'No verificable', NO_CONVERSATION: 'Sin conversación asociada',
  REVIEW_CHATBY_LINK: 'Revisar enlace con Chatby', REVIEW_CUSTOMER_RESPONSE: 'Revisar respuesta del cliente',
  WAITING_CUSTOMER: 'Esperando al cliente', HUMAN_REVIEW: 'Revisión humana',
  REVIEW_ADDRESS_CHANGE: 'Revisar dirección', REVIEW_DELIVERY_AVAILABILITY: 'Revisar disponibilidad',
  REVIEW_REJECTION: 'Revisar rechazo', REVIEW_INCIDENT: 'Revisar incidencia',
  READY_FOR_ADDRESS_AUTOMATION: 'Lista para resolución automática',
  AUTO_RESOLVED: 'Resuelta automáticamente',
  AUTO_APPLIED_PENDING_VERIFICATION: 'Solución enviada · verificación pendiente',
  MANUAL_REVIEW_NO_RESPONSE: 'Revisión manual · sin respuesta',
  MANUAL_REVIEW_NO_EXACT_CONVERSATION: 'Revisión manual · conversación no vinculada',
  MANUAL_REVIEW_CHATBY_UNVERIFIED: 'Revisión manual · Chatby no verificable',
  MANUAL_REVIEW_INCOMPLETE_ADDRESS: 'Revisión manual · dirección incompleta',
  MANUAL_REVIEW_AMBIGUOUS_ADDRESS: 'Revisión manual · dirección ambigua',
  MANUAL_REVIEW_MISSING_PHONE: 'Revisión manual · teléfono no disponible',
  MANUAL_REVIEW: 'Revisión manual', CLOSED_OUTSIDE_PENDING_QUEUE: 'Cerrada fuera de la cola pendiente'
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
    const categoryCard = (label, value, detail, tone, category) => summaryCard(label, value, detail, tone, () => {
      state.filters.category = state.filters.category === category ? '' : category;
      state.offset = 0; renderFilters(); renderSummary(); loadQueue();
    }, state.filters.category === category);
    root.append(
      categoryCard('Con respuesta', data?.with_customer_response, 'Abrir únicamente los pedidos respondidos', 'green', 'RESPONDED'),
      categoryCard('Sin respuesta', data?.no_response, 'Conversación del pedido sin mensajes del cliente', 'purple', 'NO_RESPONSE'),
      summaryCard('Pedido previo', data?.prior_order, 'Posible duplicidad a revisar', 'red'),
      summaryCard('Pedidos pendientes en Dropea', data?.pending, 'Coincide con la cola Pend. Dropshipper de Dropea'),
      summaryCard('Confirmar ahora', data?.confirm_now, 'Señal clara; se respetan todas las reglas', 'green'),
      summaryCard('Dirección', data?.address_change, 'No confirmar hasta revisar', 'amber'),
      summaryCard('Incidencias', data?.with_active_issue ?? data?.incidence, 'Seguimiento antes de actuar', 'amber'),
      summaryCard('Bloqueados', Number(data?.reject_signal || 0) + Number(data?.review_signal || 0), 'Rechazo, ambigüedad o falta de evidencia', 'red')
    );
  } else {
    const activeScope = (data?.scope || 'ACTIVE') === 'ACTIVE';
    const updated = `Actualizado ${date(data?.last_sync_at)}`;
    root.append(
      summaryCard(activeScope ? 'Pendientes reales en Dropea' : 'Seleccionadas', data?.pending, `${activeScope ? 'Cola actual de resolución' : `Alcance: ${translated(data?.scope)}`} · ${updated}`),
      summaryCard('Cliente actuó', data?.responded, `Respuesta válida ligada a la incidencia · ${updated}`, 'green'),
      summaryCard('Sin conversación exacta', data?.without_conversation, `No se presupone que el cliente no respondió · ${updated}`, 'purple'),
      summaryCard('Dirección', data?.address_issues, `Requieren datos de entrega válidos · ${updated}`, 'amber'),
      summaryCard('Atención prioritaria', data?.high_risk, `Riesgo alto o crítico · ${updated}`, 'red')
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
    ['type', 'Qué ocurre', ['RECIPIENT_ABSENT', 'ADDRESS_INCORRECT', 'REFUSED_BY_RECIPIENT', 'GENERAL_INCIDENCE', 'UNKNOWN']],
    ['response', 'Evidencia cliente', ['VALID_RESPONSE', 'NO_VALID_RESPONSE', 'NO_CONVERSATION', 'NOT_VERIFIABLE']],
    ['risk', 'Prioridad', ['HIGH', 'CRITICAL']]
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
    root.append(node('span', 'queue-scope-label', 'Solo pedidos pendientes en Dropea'));
    for (const [value, label] of [['', 'Todos'], ['RESPONDED', 'Con respuesta'], ['CONFIRM', 'Confirmar'], ['ADDRESS', 'Dirección'], ['INCIDENTS', 'Incidencias'], ['REJECT', 'No confirmar'], ['REVIEW', 'Revisión'], ['NO_RESPONSE', 'Sin respuesta'], ['NOT_VERIFIABLE', 'No verificable']]) {
      const button = node('button', `filter-chip ${(state.filters.category || '') === value ? 'active' : ''}`.trim(), label);
      button.type = 'button'; button.addEventListener('click', () => changed('category', value)); root.append(button);
    }
    const input = node('input', 'filter-select order-search'); input.type = 'search'; input.placeholder = 'Buscar ID Dropea';
    input.setAttribute('aria-label', 'Buscar pedido por ID Dropea'); input.value = state.filters.q || '';
    input.addEventListener('change', () => changed('q', input.value.trim()));
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter') changed('q', input.value.trim()); });
    root.append(input);
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
    for (const [key, label, type] of [['q', 'Buscar pedido o incidencia', 'search']]) {
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
function orderSignalSummary(item) {
  const intent = item.latest_customer_intent || 'NO_RESPONSE';
  const status = item.customer_response_status || (Number(item.customer_messages || 0) > 0 ? 'RESPONDED' : 'NO_RESPONSE');
  const summaries = {
    CONFIRM: 'El cliente confirmó el pedido.',
    REJECT: 'El cliente rechazó o pidió cancelar el pedido.',
    ADDRESS_CHANGE: 'El cliente pidió cambiar la dirección o los datos de envío.',
    PROMOTION_CHANGE: 'El cliente solicitó modificar la promoción o el pedido.',
    UNCLEAR: 'El cliente respondió, pero no permite decidir con seguridad.',
    NOT_VERIFIABLE: 'La señal no puede verificarse con seguridad.',
    UNKNOWN: 'Hay una respuesta sin clasificación fiable.'
  };
  const box = node('div', `stacked signal-card signal-${String(intent).toLowerCase().replace(/[^a-z_]/g, '')}`);
  if (status === 'NOT_VERIFIABLE') {
    box.append(node('strong', '', 'No verificable'), node('small', '', 'No hay una asociación fiable entre Chatby y este pedido.'));
    return box;
  }
  if (status === 'NO_RESPONSE') {
    box.append(node('strong', '', 'Sin respuesta'), node('small', '', 'Conversación asociada · 0 mensajes entrantes'), node('small', 'signal-evidence', 'No se atribuye ninguna acción antigua a este pedido.'));
    return box;
  }
  const count = Number(item.customer_messages || 0);
  const when = item.customer_latest_reply_at ? ` · ${date(item.customer_latest_reply_at)}` : '';
  box.append(
    node('strong', '', translated(intent)),
    node('small', '', item.customer_response_summary || summaries[intent] || summaries.UNKNOWN),
    node('small', 'signal-evidence', `${count} mensaje(s) del cliente${when} · asociación exacta al pedido`)
  );
  return box;
}
function rowOrder(item) {
  const tr = node('tr'); tr.tabIndex = 0;
  const [recommended, reason] = orderRecommendation(item);
  const recommendation = node('div', 'decision-summary'); recommendation.append(stacked(recommended, reason), protectionBadges(item));
  const customer = item.customer_name || (item.safe_customer_reference ? `Cliente ···${item.safe_customer_reference}` : 'Cliente protegido');
  const orderReference = item.external_order_reference || item.dropea_order_id;
  const orderMeta = item.external_order_reference
    ? `Dropea #${short(item.dropea_order_id)} · ${date(item.created_at_utc)}`
    : `${date(item.created_at_utc)} · ID Dropea`;
  const quality = node('div', 'stacked'); quality.append(badge(item.data_quality_status || item.freshness), node('small', '', `Actualizado ${date(item.source_updated_at)}`));
  tr.append(
    cell(stacked(orderReferenceLabel(short(orderReference)), orderMeta), 'order-cell'),
    cell(stacked(productText(item.product_display_names), `${item.product_summary?.total_units ?? '—'} unidad(es) · Dropea + Chatby`)),
    cell(recommendation),
    cell(actionStatus(item)),
    cell(orderSignalSummary(item), 'signal-cell'),
    cell(stacked(customer, `${money(item.total_amount, item.currency)} · ${item.safe_customer_reference ? `Tel. ···${item.safe_customer_reference}` : 'Contacto protegido'}`), 'customer-cell'),
    cell(quality)
  );
  tr.addEventListener('click', () => openDetail(item.canonical_order_id)); tr.addEventListener('keydown', (event) => { if (event.key === 'Enter') openDetail(item.canonical_order_id); }); return tr;
}
function rowIncident(item) {
  const tr = node('tr'); tr.tabIndex = 0;
  const customer = item.customer_evidence || {};
  const recommendation = item.tailored_recommendation || {};
  const identity = stacked(item.customer_name || 'Cliente no disponible', item.customer_phone || 'Teléfono no disponible', 'incident-identity');
  const evidence = node('div', 'stacked incident-evidence');
  evidence.append(node('strong', '', text(customer.title)), node('small', '', text(customer.summary)));
  if (customer.latest_message) evidence.append(node('q', 'message-quote', customer.latest_message));
  const resolution = recommendation.resolution_option ? `Opción Dropea: ${recommendation.resolution_option}` : 'Pendiente de validación humana';
  tr.append(
    cell(stacked(`Incidencia #${short(item.dropea_issue_id)}`, `Pedido Dropea #${short(item.dropea_order_id)} · ${date(item.created_at)}`)),
    cell(identity, 'customer-cell'),
    cell(stacked(translated(item.interpreted_type), item.initial_carrier_description_sanitized || 'Sin descripción adicional de Dropea')),
    cell(evidence, 'signal-cell'),
    cell(stacked(recommendation.title, `${recommendation.summary} · ${resolution}`), 'decision-card'),
    cell(stacked(translated(item.handling_status), `${item.source_truth === 'PENDING_IN_DROPEA' ? 'Pendiente en Dropea' : 'Fuera de la cola pendiente'} · ${item.operational_freshness_status === 'FRESH' ? 'datos vigentes' : 'revisar actualización'}`))
  );
  tr.addEventListener('click', () => openDetail(item.canonical_issue_id)); tr.addEventListener('keydown', (event) => { if (event.key === 'Enter') openDetail(item.canonical_issue_id); }); return tr;
}
function renderHead() { const labels = state.view === 'orders' ? ['Pedido / fecha', 'Producto', 'Acción recomendada', 'Acción real', 'Respuesta del cliente', 'Cliente / importe', 'Calidad'] : ['Incidencia / pedido', 'Cliente / teléfono', 'Qué ocurre', 'Evidencia de Chatby', 'Solución concreta', 'Estado real']; const tr = node('tr'); labels.forEach((label) => tr.append(node('th', '', label))); $('table-head').replaceChildren(tr); }

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
    if (!items.length && view === 'incidents') $('empty-state').textContent = state.filters.scope === 'ACTIVE' ? 'Dropea no tiene incidencias pendientes de resolver.' : 'No hay incidencias para los filtros seleccionados.';
    $('result-count').textContent = view === 'orders'
      ? `${data.total} pedido(s) pendiente(s) en Dropea`
      : `${data.total} incidencia(s) pendiente(s) de resolver`;
    $('queue-source').textContent = view === 'orders'
      ? `Fuente: Dropea · Chatby por pedido · refresco automático cada ${state.config.refresh_interval_seconds} s`
      : `Fuente: incidencias pendientes de Dropea · refresco automático cada ${state.config.refresh_interval_seconds} s`;
    if (data.last_sync_at) $('last-sync').textContent = date(data.last_sync_at);
    $('page-status').textContent = data.total ? `${state.offset + 1}–${Math.min(state.offset + state.limit, data.total)} de ${data.total}` : '0 de 0';
    $('prev-page').disabled = state.offset === 0; $('next-page').disabled = state.offset + state.limit >= data.total;
  } catch (error) { if (error.name !== 'AbortError' && request === state.queueRequest) showNotice(error.message); }
  finally { if (request === state.queueRequest) $('queue-card').setAttribute('aria-busy', 'false'); }
}
function field(label, value, asBadge = false) { const el = node('div', 'field'); el.append(node('span', '', label), asBadge ? badge(value) : node('strong', '', text(value))); return el; }
function section(title, fields, className = '') { const box = node('section', `detail-section ${className}`.trim()); box.append(node('h3', '', title)); const grid = node('div', 'field-grid'); fields.forEach((item) => grid.append(field(...item))); box.append(grid); return box; }
function timeline(items) { const box = node('details', 'detail-section technical-details'); const summary = node('summary', '', `Trazabilidad técnica · ${(items || []).length} evento(s)`); box.append(summary); const list = node('div', 'timeline'); for (const item of items || []) { const row = node('div', 'timeline-item'); row.append(node('strong', '', text(item.event_type)), node('span', '', `${date(item.occurred_at)} · ${text(item.source)} · ${text(item.freshness)}`)); list.append(row); } if (!(items || []).length) list.append(node('span', '', 'Sin eventos disponibles')); box.append(list); return box; }
function relatedIncidents(items) { const box = node('section', 'detail-section'); box.append(node('h3', '', 'Incidencias relacionadas')); if (!(items || []).length) { box.append(node('p', 'muted', 'Este pedido no tiene incidencias registradas.')); return box; } const list = node('div', 'related-list'); for (const item of items) list.append(stacked(`${text(item.normalized_type)} · ${text(item.status)}`, `${text(item.carrier)} · ${date(item.updated_at)}`)); box.append(list); return box; }
function recommendationPanel(incident, feedback = []) {
  const recommendation = incident.tailored_recommendation || {};
  const box = node('section', 'detail-section decision-card');
  box.append(node('h3', '', 'Solución propuesta para esta incidencia'), stacked(recommendation.title, recommendation.summary));
  if (recommendation.resolution_option) box.append(badge(`Dropea · ${recommendation.resolution_option}`));
  if (recommendation.customer_instruction) {
    const instruction = recommendation.customer_instruction;
    const windows = { MORNING: 'Mañana', AFTERNOON: 'Tarde', MORNING_OR_AFTERNOON: 'Mañana o tarde' };
    box.append(section('Instrucción confirmada por el cliente', [
      ['Día de entrega', instruction.requested_day === 'NEXT_DAY' ? 'DÍA SIGUIENTE' : 'NO ESPECIFICADO', true],
      ['Franja', windows[instruction.requested_window] || 'NO ESPECIFICADA'],
      ['Llamar antes de entregar', instruction.call_before_delivery ? 'SÍ' : 'NO', true],
      ['Teléfono operativo', instruction.callback_phone_available ? incident.customer_phone || 'DISPONIBLE EN EL PEDIDO' : 'NO DISPONIBLE']
    ], 'customer-instruction'));
  }
  if (recommendation.prepared_dropea_solution?.address) {
    const prepared = recommendation.prepared_dropea_solution;
    const address = prepared.address;
    box.append(section('Dirección aportada en Chatby', [
      ['Texto exacto del cliente', address.literal || 'NO DISPONIBLE'],
      ['Vía y número', [address.fields?.street_line, address.fields?.street_number].filter(Boolean).join(' · ') || 'INCOMPLETO'],
      ['Código postal', address.fields?.postal_code || 'INCOMPLETO'],
      ['Localidad', address.fields?.locality || 'INCOMPLETO'],
      ['Datos adicionales', address.fields?.unit || 'NO INDICADOS'],
      ['Validación', address.complete ? 'COMPLETA' : `FALTAN: ${(address.missing_fields || []).join(', ')}`, true],
      ['Acción en Dropea', prepared.execution_status === 'READY_FOR_GOVERNED_AUTOMATION'
        ? 'LISTA PARA EL AGENTE AUTOMÁTICO'
        : prepared.execution_status === 'NOT_EXECUTED' ? 'PREPARADA, NO EJECUTADA' : 'BLOQUEADA HASTA COMPLETAR', true]
    ], 'customer-instruction'));
  }
  box.append(node('h4', 'recommendation-heading', 'Acción que propongo'));
  const steps = node('ol', 'recommendation-steps');
  for (const step of recommendation.steps || []) steps.append(node('li', '', step));
  box.append(steps);
  if (recommendation.reasoning) box.append(stacked('Por qué propongo esta acción', recommendation.reasoning));
  if (recommendation.guardrail) box.append(stacked('Cuándo no debe aplicarse', recommendation.guardrail));
  box.append(node('p', 'muted', recommendation.code === 'PROVIDE_CORRECTED_ADDRESS_TO_DROPEA'
    ? 'Propuesta basada en Dropea y la conversación exacta del pedido. La ejecución corresponde al agente gobernado; el panel no escribe en Dropea.'
    : 'Propuesta basada en Dropea y la conversación exacta del pedido. El panel no ejecuta acciones externas.'));
  const controls = node('div', 'feedback-controls');
  const status = node('small', 'feedback-status', feedback.length ? `Feedback registrado: ${feedback.length}` : 'Tu feedback se guarda como memoria operativa y no ejecuta acciones.');
  for (const [label, feedbackType, reasonCode] of [['Útil', 'APPROVE', 'ACCURATE'], ['Tipo incorrecto', 'CORRECT', 'WRONG_TYPE'], ['Falta Chatby', 'CORRECT', 'MISSING_CHATBY'], ['Acción incorrecta', 'REJECT', 'WRONG_ACTION']]) {
    const button = node('button', 'feedback-button', label); button.type = 'button';
    button.addEventListener('click', async (event) => {
      event.stopPropagation(); controls.querySelectorAll('button').forEach((item) => { item.disabled = true; }); status.textContent = 'Guardando feedback…';
      try { await api(`/api/operations/incidents/${encodeURIComponent(incident.canonical_issue_id)}/feedback`, { method: 'POST', body: { feedback_type: feedbackType, reason_code: reasonCode, recommendation_code: recommendation.code } }); status.textContent = 'Feedback registrado para las siguientes revisiones.'; }
      catch (error) { status.textContent = error.message; controls.querySelectorAll('button').forEach((item) => { item.disabled = false; }); }
    }); controls.append(button);
  }
  box.append(controls, status); return box;
}
function customerMessageHistory(items = []) {
  const box = node('section', 'detail-section'); box.append(node('h3', '', 'Conversación de la incidencia en Chatby'));
  if (!items.length) { box.append(node('p', 'muted', 'No hay mensajes disponibles para esta conversación.')); return box; }
  const list = node('div', 'customer-message-list');
  for (const item of items) {
    const speaker = item.direction === 'OUTBOUND' ? 'Suleia' : 'Cliente';
    const card = node('article', `customer-message ${item.direction === 'OUTBOUND' ? 'operator-message' : 'customer-reply'} ${item.relation_to_issue === 'AFTER_INCIDENT' ? 'current' : 'previous'}`);
    card.append(node('strong', 'message-speaker', speaker), node('q', 'message-quote', item.text), node('small', '', `${date(item.occurred_at)} · ${item.relation_to_issue === 'AFTER_INCIDENT' ? 'posterior a la incidencia' : 'anterior a la incidencia'} · ${translated(item.intent)}`));
    list.append(card);
  }
  box.append(list); return box;
}
async function openDetail(id) {
  const view = state.view; const request = ++state.detailRequest;
  state.detailController?.abort(); state.detailController = new AbortController();
  $('drawer-backdrop').hidden = false; $('detail-drawer').classList.add('open'); $('detail-drawer').setAttribute('aria-hidden', 'false'); $('detail-title').textContent = 'Cargando…'; $('detail-content').replaceChildren();
  try {
    const data = await api(`/api/operations/${view}/${encodeURIComponent(id)}`, { signal: state.detailController.signal });
    if (request !== state.detailRequest || view !== state.view) return;
    const root = $('detail-content');
    if (view === 'orders') {
      const order = data.order; $('detail-title').textContent = `Pedido ${short(order.external_order_reference || order.dropea_order_id)}`;
      root.append(
        section('Pedido y cliente', [['Referencia', order.external_order_reference || 'NO DISPONIBLE'], ['ID Dropea', order.dropea_order_id], ['Cliente', order.customer_name || 'Cliente protegido'], ['Estado Dropea V2', order.lifecycle_status || order.status, true], ['Subestado', order.sub_status], ['Producto', productText(order.product_display_names)], ['Unidades', order.product_summary?.total_units], ['Importe', money(order.total_amount, order.currency)], ['Pago', order.payment_method], ['Transportista', order.carrier], ['Datos', order.data_quality_status || order.freshness, true]]),
        section('PROTECCIONES OPERATIVAS', [['Teléfono', order.phone_last4 ? `***${order.phone_last4}` : '—'], ['Duplicado', order.duplicate_status || 'NO', true], ['Pedido TEST', order.test_order ? 'SÍ' : 'NO', true], ['Confirmación automática', order.automatic_confirmation_allowed ? 'PERMITIDA' : 'BLOQUEADA', true], ['Chatby cleanup', order.chatby_cleanup_status || 'NO EVALUADO', true], ['Bloqueos Chatby', (order.chatby_cleanup_blockers || []).join(', ') || 'NINGUNO'], ['Return block', order.return_block_status || 'NO EVALUADO', true], ['Motivo', order.return_block_reason || '—']]),
        section('Decisión operativa observada', [['Recomendación', order.simulated_decision || 'SIN EVALUAR', true], ['Acción simulada', order.simulated_action_type || 'NINGUNA', true], ['Política', order.policy_version], ['Riesgo', order.risk, true], ['Bloqueos', (order.blocking_reasons || []).join(', ') || 'NINGUNO'], ['Revisión humana', order.human_review ? 'REQUERIDA' : 'NO', true], ['Acciones reales', order.actions_executed || 0], ['Escrituras externas', order.production_writes || 0]], 'decision-card'),
        section('Respuesta del cliente para este pedido', [['Estado', translated(order.customer_response_status || 'NOT_VERIFIABLE'), true], ['Qué contestó', order.customer_response_summary || (order.customer_response_status === 'NO_RESPONSE' ? 'No hay mensajes entrantes del cliente para este pedido.' : translated(order.latest_customer_intent || 'UNKNOWN'))], ['Intención detectada', translated(order.latest_customer_intent || 'UNKNOWN'), true], ['Mensajes del cliente', order.customer_messages ?? 0], ['Asociación', order.customer_signal_association === 'EXACT_DROPEA_ORDER_ID' ? 'ID Dropea exacto del pedido' : 'NO VERIFICABLE', true], ['Última respuesta', date(order.customer_latest_reply_at)], ['Señal revisada', date(order.customer_signal_updated_at)], ['Fuente', order.customer_signal_source || 'NO DISPONIBLE'], ['Confianza', order.customer_response_status === 'NO_RESPONSE' ? 'No aplica: no hay respuesta' : order.customer_signal_confidence === null || order.customer_signal_confidence === undefined ? 'NO DISPONIBLE' : `${Math.round(Number(order.customer_signal_confidence) * 100)} %`], ['Contradicción', order.contradiction ? 'SÍ' : 'NO', true]]),
        section('Ciclo de vida', [['Creado', date(order.created_at_utc)], ['Confirmado', date(order.confirmed_at_utc)], ['Procesando', date(order.processing_at_utc)], ['Entregado', date(order.delivered_at_utc)], ['Cancelado', date(order.cancelled_at_utc)], ['Devuelto', date(order.returned_at_utc)], ['Fuente', order.source_system], ['Actualizado', date(order.source_updated_at)]]),
        section('Control económico', [['Valor del pedido', money(order.total_amount, order.currency)], ['Costes reales', 'PENDIENTE DE FUENTE', true], ['Beneficio', 'NO CALCULABLE', true], ['Exactitud', 'SOLO VALOR DEL PEDIDO', true], ['Escrituras en Dropea', '0']]),
        relatedIncidents(data.incidents), timeline(data.timeline)
      );
    } else {
      const incident = data.incident; $('detail-title').textContent = `Incidencia ${short(incident.dropea_issue_id)}`;
      root.append(
        section('Cliente y pedido', [['Cliente', incident.customer_name || 'NO DISPONIBLE'], ['Teléfono', incident.customer_phone || 'NO DISPONIBLE'], ['Pedido', incident.external_order_reference || `Dropea #${incident.dropea_order_id}`], ['Incidencia', `#${incident.dropea_issue_id}`]]),
        section('Situación real', [['Estado', incident.source_truth === 'PENDING_IN_DROPEA' ? 'PENDIENTE EN DROPEA' : 'FUERA DE LA COLA PENDIENTE', true], ['Problema', translated(incident.interpreted_type)], ['Qué informa Dropea', incident.initial_carrier_description_sanitized || 'NO INFORMADO'], ['Transportista', incident.carrier], ['Creada', date(incident.created_at)], ['Actualizada', date(incident.updated_at)]]),
        section('Acción del cliente', [['Resultado', incident.customer_evidence?.title, true], ['Conclusión', incident.customer_evidence?.summary], ['Último mensaje', incident.customer_evidence?.latest_message || 'No hay mensaje entrante disponible'], ['Fecha del mensaje', date(incident.customer_evidence?.at)], ['Relación temporal', incident.customer_evidence?.relation === 'AFTER_INCIDENT' ? 'POSTERIOR A LA INCIDENCIA' : incident.customer_evidence?.relation === 'BEFORE_INCIDENT' ? 'ANTERIOR A LA INCIDENCIA' : 'SIN MENSAJE', true], ['Asociación', incident.conversation_status === 'FOUND' ? 'CONVERSACIÓN EXACTA DEL PEDIDO' : 'NO VERIFICADA', true]]),
        customerMessageHistory(data.customer_messages),
        recommendationPanel(incident, data.feedback),
        section('Control y seguridad', [['Gestión', translated(incident.handling_status), true], ['Opción propuesta en Dropea', incident.tailored_recommendation?.resolution_option || 'PENDIENTE DE VALIDACIÓN'], ['Opciones permitidas', (incident.allowed_resolution_options || []).join(', ') || 'NO INFORMADAS'], ['Datos', translated(incident.operational_freshness_status), true], ['Última lectura Dropea', date(incident.last_successful_sync_at)], ['Última lectura Chatby', date(incident.chatby_last_successful_sync_at)], ['Estado de acción externa', translated(incident.external_action_status || 'NOT_EXECUTED'), true]]),
        timeline(data.timeline)
      );
    }
  } catch (error) { if (error.name !== 'AbortError' && request === state.detailRequest) $('detail-content').append(node('div', 'notice', error.message)); }
}
function closeDetail() { state.detailRequest += 1; state.detailController?.abort(); $('drawer-backdrop').hidden = true; $('detail-drawer').classList.remove('open'); $('detail-drawer').setAttribute('aria-hidden', 'true'); }

function financeMetric(label, value, detail, tone = '') { const card = node('article', `finance-metric ${tone}`.trim()); card.append(node('span', '', label), node('strong', '', value), node('small', '', detail)); return card; }
function financePercent(value) { return value === null || value === undefined ? 'No disponible' : `${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format(Number(value) * 100)} %`; }
function monthLabel(value) { if (!/^\d{4}-\d{2}$/.test(String(value))) return value; const [year, month] = value.split('-').map(Number); return new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric', timeZone: 'Europe/Madrid' }).format(new Date(Date.UTC(year, month - 1, 2))); }
function financeQuality(value) { return badge(value === 'COMPLETE' ? 'COMPLETO' : value === 'FUTURE' ? 'DÍA FUTURO' : 'INCOMPLETO'); }
function financeLines(lines, className = '') { const root = node('div', `finance-lines ${className}`.trim()); lines.forEach(([label, value, strong = false]) => { const line = node('div'); line.append(node('span', '', label), node(strong ? 'strong' : 'b', '', value)); root.append(line); }); return root; }
function financeKpi(label, value, detail = '') { const item = node('div', 'daily-kpi'); item.append(node('span', '', label), node('strong', '', value)); if (detail) item.append(node('small', '', detail)); return item; }
function financeProfitTrend(rows, currency) {
  const visible = (rows || []).filter((row) => row.quality !== 'FUTURE');
  const known = visible.filter((row) => row.net_profit !== null && row.net_profit !== undefined);
  const maximum = Math.max(1, ...known.map((row) => Math.abs(Number(row.net_profit))));
  const positives = known.filter((row) => Number(row.net_profit) >= 0).length;
  const negatives = known.length - positives;
  const pending = visible.length - known.length;
  const root = node('section', 'profit-trend');
  const summary = node('div', 'profit-trend-summary');
  summary.append(
    financeKpi('Días con beneficio', text(positives, '0')),
    financeKpi('Días con pérdida', text(negatives, '0')),
    financeKpi('Pendientes de cierre', text(pending, '0'))
  );
  const chart = node('div', 'profit-trend-chart');
  chart.setAttribute('role', 'img');
  chart.setAttribute('aria-label', 'Evolución del beneficio neto diario del mes; verde positivo, rojo negativo y gris pendiente');
  const baseline = node('span', 'profit-zero-line'); chart.append(baseline);
  const bars = node('div', 'profit-bars');
  visible.forEach((row, index) => {
    const value = row.net_profit === null || row.net_profit === undefined ? null : Number(row.net_profit);
    const tone = value === null ? 'pending' : value >= 0 ? 'positive' : 'negative';
    const slot = node('div', `profit-bar-slot ${tone}`);
    const visual = node('span', 'profit-bar');
    visual.style.height = value === null ? '5px' : `${Math.max(5, Math.round(Math.abs(value) / maximum * 46))}%`;
    slot.title = `${date(row.day, true)} · ${value === null ? 'Pendiente de cierre' : money(value, currency)} · ${text(row.returned, '0')} rechazado(s)/devuelto(s)`;
    const label = node('span', `profit-day-label ${(index % 2) ? 'alternate' : ''}`, String(Number(row.day.slice(-2))));
    slot.append(visual, label); bars.append(slot);
  });
  chart.append(bars);
  const legend = node('div', 'profit-trend-legend');
  [['positive', 'Beneficio'], ['negative', 'Pérdida'], ['pending', 'Pendiente']].forEach(([tone, label]) => { const item = node('span'); item.append(node('i', tone), document.createTextNode(label)); legend.append(item); });
  root.append(summary, chart, legend);
  return root;
}
function financeDailyCard(row, currency) {
  const tone = row.net_profit === null ? 'unknown' : Number(row.net_profit) >= 0 ? 'profit-positive' : 'profit-negative';
  const card = node('article', `daily-profit-card ${tone}`);
  const header = node('header', 'daily-card-header');
  const title = node('div'); title.append(node('span', 'daily-date-label', date(row.day, true)), node('small', '', 'Resultado realizado del día'));
  header.append(title, financeQuality(row.quality));
  const headline = node('div', 'daily-profit-headline');
  headline.append(node('div', '', 'Beneficio neto'), node('strong', '', money(row.net_profit, currency)), node('span', '', `Margen ${financePercent(row.margin)} · ROI ${financePercent(row.roi)}`));
  const business = node('div', 'daily-business-grid');
  business.append(
    financeKpi('Facturación', money(row.real_revenue, currency), `${text(row.delivered, '0')} pedidos entregados`),
    financeKpi('Gastos', money(row.total_expenses, currency), 'Todos los costes imputados'),
    financeKpi('Publicidad', money(row.costs?.advertising, currency), `CPA ${money(row.real_cpa, currency)}`)
  );
  const activity = node('div', 'daily-activity-strip');
  [['Creados', row.orders_created], ['Confirmados', row.orders_sent], ['Entregados', row.delivered], ['Unidades entregadas', row.delivered_units], ['Pedidos devueltos', row.returned], ['Unidades devueltas', row.returned_units]].forEach(([label, value]) => activity.append(financeKpi(label, text(value, '0'))));
  const logistics = [row.costs?.outbound_shipping, row.costs?.cod, row.costs?.outbound_fulfillment, row.costs?.returns];
  const logisticsTotal = logistics.some((value) => value === null || value === undefined) ? null : logistics.reduce((sum, value) => sum + Number(value), 0);
  const details = node('details', 'daily-cost-details');
  const summary = node('summary', '', 'Ver desglose de costes');
  details.append(summary, financeLines([
    ['Producto', money(row.costs?.product, currency)], ['Logística total', money(logisticsTotal, currency)],
    ['Devoluciones incluidas', money(row.costs?.returns, currency)], ['Publicidad', money(row.costs?.advertising, currency)],
    ['Gastos fijos', money(row.costs?.fixed, currency)], ['Total', money(row.total_expenses, currency), true]
  ], 'daily-cost-lines'));
  card.append(header, headline, business, activity, details);
  return card;
}
function financePeriodSummary(row, currency) {
  const root = node('section', `period-summary-card ${row.net_profit === null ? 'unknown' : Number(row.net_profit) >= 0 ? 'profit-positive' : 'profit-negative'}`);
  const lead = node('div', 'period-summary-lead'); lead.append(node('span', '', row.closed_through ? 'BENEFICIO NETO CERRADO' : 'RESULTADO PENDIENTE DE CIERRE'), node('strong', '', money(row.net_profit, currency)), node('small', '', `Margen ${financePercent(row.margin)} · ROI ${financePercent(row.roi)}`));
  if (row.closed_through) lead.append(node('small', 'accounting-close-label', `Cierre contable verificado hasta ${date(row.closed_through, true)}`));
  const metrics = node('div', 'period-summary-metrics');
  metrics.append(financeKpi('Facturación', money(row.real_revenue, currency)), financeKpi('Gastos', money(row.total_expenses, currency)), financeKpi('Entregados', text(row.delivered, '0'), `${text(row.delivered_units, '0')} unidades`), financeKpi('Devueltos', text(row.returned, '0'), `${text(row.returned_units, '0')} unidades`));
  root.append(lead, metrics); return root;
}
function financeCostCard(label, value, detail, currency, tone = '') { const card = node('article', `cost-card ${value === null ? 'unknown-cost' : ''} ${tone}`.trim()); card.append(node('span', '', label), node('strong', '', value === null ? 'Pendiente' : money(value, currency)), node('small', '', detail)); return card; }
function productFinanceCard(item, currency) { const card = node('article', 'product-finance-card'); const head = node('header'); head.append(node('div', '', item.name), financeQuality(item.revenue_attribution_complete && item.product_cost_complete && item.attributable_operational_profit !== null ? 'COMPLETE' : 'INCOMPLETE')); const metrics = node('div', 'product-finance-metrics'); [['Entregadas', item.delivered_units], ['En tránsito', item.in_air_units], ['Devueltas', item.returned_units], ['Facturación real', money(item.revenue_real, currency)], ['Coste producto', money(item.product_cost, currency)], ['Beneficio atribuible', money(item.attributable_operational_profit, currency)]].forEach(([label, value], index) => metrics.append(financeMetric(label, value, index === 5 ? 'Sin publicidad ni gastos fijos' : '', index === 5 ? 'primary compact' : 'compact'))); card.append(head, metrics); return card; }
function logisticsCard(item, currency) { const card = node('article', 'logistics-card'); card.append(node('header', '', item.carrier), financeLines([['Confirmados', item.orders_sent], ['Entregados', item.delivered], ['Devueltos', item.returned], ['Coste total', money(item.total_cost, currency), true], ['Coste por envío', money(item.cost_per_order, currency)]]), financeQuality(item.quality)); return card; }
function updateFinanceMonthNavigation() { const select = $('finance-month'); const months = state.financeMonths; const index = months.indexOf(select.value); $('finance-prev-month').disabled = index < 0 || index >= months.length - 1; $('finance-next-month').disabled = index <= 0; $('finance-month-count').textContent = `${months.length} mes(es) disponibles · ${select.value === months[0] ? 'mes más reciente' : 'histórico'}`; }
function moveFinanceMonth(direction) { const select = $('finance-month'); const index = state.financeMonths.indexOf(select.value); const target = direction === 'older' ? index + 1 : index - 1; if (target < 0 || target >= state.financeMonths.length) return; select.value = state.financeMonths[target]; updateFinanceMonthNavigation(); loadFinance(); }
function closeFixedExpenseForm() { $('finance-fixed-form').hidden = true; $('finance-fixed-form').reset(); $('finance-fixed-id').value = ''; $('finance-fixed-feedback').textContent = ''; }
function openFixedExpenseForm(item = null) {
  const form = $('finance-fixed-form'); form.hidden = false; form.reset();
  const month = state.finance?.month || new Date().toISOString().slice(0, 7);
  $('finance-fixed-id').value = item?.expense_id || '';
  $('finance-fixed-label').value = item?.label || '';
  $('finance-fixed-category').value = [...$('finance-fixed-category').options].some((option) => option.value === item?.category) ? item.category : 'OTROS';
  $('finance-fixed-type').value = item?.expense_type || 'RECURRING';
  $('finance-fixed-amount').value = item?.amount || '';
  $('finance-fixed-start').value = item?.start_date || `${month}-01`;
  $('finance-fixed-end').value = item?.end_date || '';
  $('finance-fixed-occurred').value = item?.occurred_on || `${month}-01`;
  $('finance-fixed-status').value = item?.status || 'ACTIVE';
  const oneOff = $('finance-fixed-type').value === 'ONE_OFF'; $('finance-fixed-occurred-label').hidden = !oneOff; $('finance-fixed-occurred').required = oneOff;
  $('finance-fixed-feedback').textContent = item ? 'Editando un gasto existente. Todos los cambios quedan auditados.' : 'El gasto se incorporará al cálculo tras guardarlo.';
  $('finance-fixed-label').focus();
}
function renderFixedExpenses(data, currency) {
  const items = data.fixed_expenses || []; const root = $('finance-fixed-expenses');
  if (!items.length) { root.replaceChildren(stacked('No hay gastos fijos configurados', 'El beneficio permanecerá incompleto hasta añadirlos o verificar la fuente.')); return; }
  root.replaceChildren(...items.map((item) => { const card = node('article', `fixed-expense-card ${item.status === 'INACTIVE' ? 'inactive' : ''}`); const title = node('div'); title.append(node('strong', '', item.label), node('small', '', `${item.expense_type === 'RECURRING' ? 'Mensual recurrente' : `Puntual · ${date(item.occurred_on, true)}`} · ${item.status === 'ACTIVE' ? 'Activo' : 'Inactivo'}`)); const amountBox = node('div', 'fixed-expense-amount'); amountBox.append(node('strong', '', money(item.amount, currency)), node('small', '', item.category === 'PLATFORM_FIXED_EXPENSES' ? 'Plataforma / operación' : item.category)); const edit = node('button', 'secondary-button', 'Editar'); edit.type = 'button'; edit.addEventListener('click', () => openFixedExpenseForm(item)); card.append(title, amountBox, edit); return card; }));
}
async function saveFixedExpense(event) {
  event.preventDefault(); const id = $('finance-fixed-id').value; const oneOff = $('finance-fixed-type').value === 'ONE_OFF';
  const body = { store_id: state.finance?.store_id || null, label: $('finance-fixed-label').value, category: $('finance-fixed-category').value,
    expense_type: $('finance-fixed-type').value, amount: Number($('finance-fixed-amount').value), start_date: $('finance-fixed-start').value,
    end_date: $('finance-fixed-end').value || null, occurred_on: oneOff ? $('finance-fixed-occurred').value : null, status: $('finance-fixed-status').value };
  const submit = $('finance-fixed-form').querySelector('button[type="submit"]'); submit.disabled = true; $('finance-fixed-feedback').textContent = 'Guardando y recalculando…';
  try { await api(`/api/operations/finance/fixed-expenses${id ? `/${encodeURIComponent(id)}` : ''}`, { method: id ? 'PATCH' : 'POST', body }); closeFixedExpenseForm(); await loadFinance(); showNotice('Gasto fijo guardado. El beneficio se ha recalculado con trazabilidad.'); }
  catch (error) { $('finance-fixed-feedback').textContent = error.message; }
  finally { submit.disabled = false; }
}
function renderFinance() {
  const data = state.finance; if (!data) return;
  const totals = data.totals || {}; const observed = data.observed_snapshot || {}; const currency = data.currency || 'EUR';
  $('last-sync').textContent = date(data.generated_at);
  const closedThrough = data.accounting_closed_through ? date(data.accounting_closed_through, true) : null;
  $('finance-exactness').textContent = data.exactness === 'COMPLETE' ? 'Fuentes completas' : closedThrough ? `Cierre verificado hasta ${closedThrough} · ${text(data.pending_accounting_days, '0')} día provisional` : `${(data.missing_sources || []).length} fuente(s) pendiente(s)`;
  $('finance-hero').replaceChildren(
    financeMetric('Beneficio neto cerrado', money(totals.net_profit, currency), totals.net_profit === null ? 'No se calcula mientras falte una fuente cerrada' : `Hasta ${closedThrough || 'el cierre del periodo'} · ya descuenta producto, logística, Meta y gastos fijos`, totals.net_profit === null ? 'unknown' : Number(totals.net_profit) >= 0 ? 'primary' : 'negative'),
    financeMetric('Facturación entregada', money(totals.real_revenue, currency), `${text(totals.delivered, '0')} entregas realizadas en el mes`, 'positive'),
    financeMetric('Gastos totales', money(totals.total_expenses, currency), 'Producto + logística + publicidad + gastos fijos', totals.total_expenses === null ? 'unknown' : 'warning'),
    financeMetric('ROI', financePercent(totals.roi), 'Beneficio neto ÷ gastos totales', totals.roi === null ? 'unknown' : Number(totals.roi) >= 0 ? 'positive' : 'negative'),
    financeMetric('CPA real', money(totals.real_cpa, currency), 'Publicidad ÷ pedidos entregados', totals.real_cpa === null ? 'unknown' : ''),
    financeMetric('Facturación estimada', money(totals.estimated_revenue, currency), `${text(totals.orders_sent, '0')} pedidos enviados`, 'warning'),
    financeMetric('Publicidad', money(totals.costs?.advertising, currency), `${text(data.quality?.advertising_days_complete, '0')} días verificados`, ''),
    financeMetric('Mes analizado', monthLabel(data.month), data.provisional ? `Mes abierto · ${closedThrough ? `cerrado hasta ${closedThrough}` : 'pendiente de cierre'}` : 'Mes histórico', '')
  );
  const cohort = totals.cohort || {};
  const funnel = [
    ['Pedidos creados', cohort.orders_created ?? totals.orders_created], ['Confirmados', cohort.orders_sent ?? totals.orders_sent], ['Entregados', cohort.delivered ?? totals.delivered],
    ['En el aire', totals.in_air], ['Pedidos devueltos', observed.returned ?? totals.returned], ['Unidades devueltas', observed.returned_units ?? totals.returned_units], ['Incidencias', totals.incidences]
  ];
  $('finance-funnel').replaceChildren(...funnel.map(([label, value]) => summaryCard(label, value, label === 'En el aire' ? 'Fotografía actual' : percentage(value, cohort.orders_created ?? totals.orders_created))));
  const fixedLabel = data.provisional && totals.fixed_expenses_committed !== totals.costs?.fixed ? `Gastos fijos imputados (${money(totals.fixed_expenses_committed, currency)} comprometidos)` : 'Gastos fijos';
  const returnDetail = Number(observed.returned ?? totals.returned) !== Number(totals.returned)
    ? `${text(totals.returned, '0')} pedidos en el cierre · ${text(observed.returned, '0')} observados (${money(observed.return_cost, currency)} de coste logístico observado)`
    : `${text(totals.returned, '0')} pedidos · ${text(totals.returned_units, '0')} unidades · ${money(totals.return_cost_per_order, currency)} por pedido`;
  const costs = [
    ['Producto entregado', totals.costs?.product, `${text(totals.delivered_units, '0')} unidades entregadas`, ''],
    ['Envíos de ida', totals.costs?.outbound_shipping, `${text(totals.orders_sent, '0')} pedidos confirmados`, ''],
    ['Contra reembolso', totals.costs?.cod, `${text(totals.delivered, '0')} pedidos entregados`, ''],
    ['Fulfillment de ida', totals.costs?.outbound_fulfillment, 'Preparación de pedidos enviados', ''],
    ['Rechazados / devueltos', totals.costs?.returns, returnDetail, 'returns'],
    ['Publicidad Meta', totals.costs?.advertising, `${text(data.quality?.advertising_days_complete, '0')} días verificados`, 'advertising'],
    [fixedLabel, totals.costs?.fixed, 'Costes mensuales prorrateados', '']
  ];
  $('finance-costs').replaceChildren(...costs.map(([label, value, detail, tone]) => financeCostCard(label, value, detail, currency, tone)));
  $('finance-quality').replaceChildren(
    stacked('Perspectiva', 'Beneficio realizado por fecha real de confirmación, entrega y devolución'),
    stacked('Estado del modelo', data.audit?.model_status === 'PASS' ? 'AUDITADO · todas las fórmulas cuadran' : 'PARCIAL · existe alguna fuente pendiente'),
    stacked('Fórmula del beneficio', 'Facturación real − producto − envío − COD − fulfillment − devoluciones − publicidad − gastos fijos'),
    stacked('Publicidad', `${text(data.quality?.advertising_days_complete, '0')} de ${text(data.quality?.required_days, '0')} días transcurridos completos`),
    stacked('Cierre contable', closedThrough ? `${closedThrough}${data.pending_accounting_days ? ` · ${data.pending_accounting_days} día provisional visible sin inventar gasto` : ''}` : 'PENDIENTE'),
    stacked('Fuentes pendientes', (data.missing_sources || []).slice(0, 8).join(' · ') || 'Ninguna'),
    stacked('Estado del mes', data.provisional ? 'ABIERTO' : 'HISTÓRICO'),
    ...((data.limitations || []).map((item) => stacked('Límite conocido', item)))
  );
  $('finance-audit').replaceChildren(...(data.audit?.checks || []).map((check) => { const row = node('div', `audit-check ${String(check.status).toLowerCase()}`); row.append(badge(check.status === 'PASS' ? 'OK' : check.status), node('span', '', check.key.replaceAll('_', ' ').toLowerCase())); return row; }));
  $('finance-trend').replaceChildren(financeProfitTrend(data.daily || [], currency));
  $('finance-daily').replaceChildren(...(data.daily || []).filter((item) => item.quality !== 'FUTURE').slice().reverse().map((item) => financeDailyCard(item, currency)));
  const totalRow = { orders_created: totals.orders_created, orders_sent: totals.orders_sent, delivered: totals.delivered, delivered_units: totals.delivered_units,
    returned: totals.returned, returned_units: totals.returned_units,
    estimated_revenue: totals.estimated_revenue, real_revenue: totals.real_revenue, costs: totals.costs, total_expenses: totals.total_expenses,
    net_profit: totals.net_profit, margin: totals.margin, roi: totals.roi, real_cpa: totals.real_cpa, closed_through: data.accounting_closed_through };
  $('finance-total').replaceChildren(financePeriodSummary(totalRow, currency));
  $('finance-products').replaceChildren(...(data.products || []).map((item) => productFinanceCard(item, currency)));
  $('finance-logistics').replaceChildren(...(data.logistics || []).map((item) => logisticsCard(item, currency)));
  renderFixedExpenses(data, currency);
  const advertisingRows = (data.advertising_by_platform || []).length
    ? data.advertising_by_platform.map((item) => { const row = node('div', 'cost-row'); row.append(node('strong', '', item.platform), badge(money(item.spend, currency))); return row; })
    : [stacked('Sin fuente publicitaria completa', 'El beneficio operativo sigue disponible; el beneficio neto y el ROI esperan la sincronización diaria de Meta.')];
  $('finance-advertising').replaceChildren(...advertisingRows);
}
async function loadFinance() { showNotice(''); const selected = $('finance-month').value; try { state.finance = await api(`/api/operations/finance${selected ? `?month=${encodeURIComponent(selected)}` : ''}`); const select = $('finance-month'); const months = state.finance.available_months?.length ? state.finance.available_months : [state.finance.month]; state.financeMonths = months; const currentOptions = [...select.options].map((option) => option.value); if (currentOptions.join('|') !== months.join('|')) { select.replaceChildren(...months.map((month) => { const option = node('option', '', monthLabel(month)); option.value = month; return option; })); } select.value = state.finance.month; updateFinanceMonthNavigation(); renderFinance(); } catch (error) { showNotice(error.message); } }
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
  state.view = view; state.offset = 0; state.filters = view === 'incidents' ? { scope: 'ACTIVE' } : {}; closeDetail();
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
  const titles = { orders: 'Pedidos operativos', incidents: 'Incidencias', finance: 'Control de gasto' }; $('view-title').textContent = titles[view];
  const finance = view === 'finance'; $('summary').hidden = finance; $('finance-view').hidden = !finance; $('queue-card').hidden = finance;
  if (finance) { loadFinance(); return; }
  $('queue-title').textContent = view === 'orders' ? 'Pedidos pendientes en Dropea · señal Chatby por pedido' : 'Incidencias pendientes de resolver en Dropea · contexto Chatby'; renderHead(); renderFilters(); renderSummary(); loadQueue();
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
$('logout-button').addEventListener('click', () => signOut(true)); $('refresh-button').addEventListener('click', refresh); $('finance-month').addEventListener('change', () => { updateFinanceMonthNavigation(); loadFinance(); }); $('finance-prev-month').addEventListener('click', () => moveFinanceMonth('older')); $('finance-next-month').addEventListener('click', () => moveFinanceMonth('newer')); $('page-size').addEventListener('change', (event) => { state.limit = Number(event.target.value); state.offset = 0; loadQueue(); }); $('prev-page').addEventListener('click', () => { state.offset = Math.max(0, state.offset - state.limit); loadQueue(); }); $('next-page').addEventListener('click', () => { state.offset += state.limit; loadQueue(); }); document.querySelectorAll('.nav-item').forEach((item) => item.addEventListener('click', () => setView(item.dataset.view))); $('close-drawer').addEventListener('click', closeDetail); $('drawer-backdrop').addEventListener('click', closeDetail); document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeDetail(); });
$('finance-add-fixed').addEventListener('click', () => openFixedExpenseForm());
$('finance-fixed-cancel').addEventListener('click', closeFixedExpenseForm);
$('finance-fixed-form').addEventListener('submit', saveFixedExpense);
$('finance-fixed-type').addEventListener('change', () => { const oneOff = $('finance-fixed-type').value === 'ONE_OFF'; $('finance-fixed-occurred-label').hidden = !oneOff; $('finance-fixed-occurred').required = oneOff; });
init().catch(async (error) => { $('login').hidden = false; $('app').hidden = true; try { if (state.config) await prepareLogin(); } catch {} showLoginError(error.message); });
