const state = { view: 'orders', offset: 0, limit: 25, total: 0, filters: {}, config: null, token: null, summary: null, finance: null, financeMonths: [], financeChartMode: 'profit', financeDailyBasis: 'settlement', financeSelectedDay: null, financeHistoryWindow: 6, financeCache: new Map(), financeLoadedAt: 0, financeRequest: 0, financeController: null, queueRequest: 0, queueController: null, detailRequest: 0, detailController: null, refreshing: false };
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
  ACTIVE: 'Pendientes actuales en Dropea', HISTORICAL: 'Histórico (no pendientes)', ALL: 'Todas (incluye histórico)',
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
  AUTOMATIC: 'Gestión automática', RECOVERABLE_NOW: 'Recuperable ahora', RECOVERED: 'Recuperada',
  ERROR: 'Error', READY_FOR_DECISION: 'Lista para decidir', ACTION_PENDING: 'Acción simulada preparada',
  ACTION_VERIFYING: 'Verificación pendiente', RETURN_ELIGIBLE: 'Elegible para devolución', RETURNED: 'Devuelta',
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
    for(const kpi of data?.dashboard?.kpis || data?.autopilot?.kpis || []) {
      const card=summaryCard(kpi.label,kpi.count,'Abrir las incidencias de este contador',kpi.key==='RETURNED' || kpi.key==='RETURN_RISK'?'red':kpi.key==='RECOVERABLE_NOW' || kpi.key==='RECOVERED'?'green':'',()=>{
        const key=data?.dashboard?'metric':'autopilot';state.filters[key]=state.filters[key]===kpi.key?'':kpi.key;
        state.offset=0;renderSummary();loadQueue();
      },(data?.dashboard?state.filters.metric:state.filters.autopilot)===kpi.key);
      card.append(recoveryIcon(kpi.icon));root.append(card);
    }
    renderRecoveryCenter(data);
  }
  const last = data?.last_sync_at || state.summary?.protections?.last_reconciled_at;
  $('last-sync').textContent = date(last);
  if (data?.stale > 0) showNotice('Hay datos desactualizados. Las decisiones afectadas permanecen bloqueadas.');
}

const filterDefinitions = {
  orders: [],
  incidents: [
    ['scope', 'Alcance', ['ACTIVE', 'HISTORICAL', 'ALL']],
    ['type', 'Qué ocurre', ['RECIPIENT_ABSENT', 'ADDRESS_INCORRECT', 'PENDING_DATA', 'REFUSED_BY_RECIPIENT', 'GENERAL_INCIDENCE', 'UNKNOWN']],
    ['response', 'Evidencia cliente', ['VALID_RESPONSE', 'NO_VALID_RESPONSE', 'NO_CONVERSATION', 'NOT_VERIFIABLE']],
    ['discount_response', 'Descuento 5 €', ['DISCOUNT_ACCEPTED', 'DISCOUNT_REJECTED', 'NO_RESPONSE', 'OTHER_RESPONSE', 'NOT_SENT', 'NOT_VERIFIABLE']],
    ['risk', 'Riesgo original', ['HIGH', 'CRITICAL']],
    ['recovery_status', 'Estado recuperación', ['CONTACT_PENDING','WAITING_CUSTOMER','WAITING_SULEIA','RECOVERABLE_NOW','RETURN_RISK','RECOVERED','DELIVERED_AFTER_INCIDENT','RETURN_REQUESTED','RETURNED','EVIDENCE_UNCERTAIN','UNRESOLVED']],
    ['autopilot', 'Estado Autopilot', ['ACTIVE','AUTOMATIC','READY_FOR_DECISION','WAITING_CUSTOMER','RECOVERABLE_NOW','ACTION_PENDING','ACTION_VERIFYING','RETURN_ELIGIBLE','RECOVERED','RETURNED','HUMAN_REVIEW','ERROR']],
    ['timer', 'Temporizador', ['ACTIVE','EXPIRED','INACTIVE','UNAVAILABLE']],
    ['priority', 'Prioridad recuperación', ['1','2','4','5','6']],
    ['client_acted', 'Cliente actuó', ['true','false']],
    ['recoverable', 'Recuperable', ['true','false']]
  ]
};
function renderFilters() {
  const root = $('filters'); root.replaceChildren();
  if(state.view==='incidents' && state.summary?.incidents?.dashboard){renderIncidentFilters(root);return;}
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
    for (const [label,scope] of [['Pendientes actuales','ACTIVE'],['Consultar histórico','HISTORICAL'],['Todas (incluye histórico)','ALL']]) {
      const button=node('button','recovery-reset',label);button.type='button';
      button.addEventListener('click',()=>{state.filters=scope==='ACTIVE'?{scope}:{scope,month:state.filters.month || ''};state.offset=0;renderFilters();loadQueue();});root.append(button);
    }
    const month=node('select','filter-select');month.setAttribute('aria-label','Mes de creación de incidencia');
    month.append(new Option('Todos los meses',''));
    for(const value of state.summary?.incidents?.available_months || [])month.append(new Option(value,value));
    month.value=state.filters.month || '';month.addEventListener('change',()=>changed('month',month.value));root.append(month);
    for(const [key,label] of [['from','Desde · fecha de incidencia'],['to','Hasta · fecha de incidencia']]){
      const input=node('input','filter-select');input.type='date';input.setAttribute('aria-label',label);input.title=label;
      input.value=state.filters[key] || '';input.addEventListener('change',()=>changed(key,input.value));root.append(input);
    }
    const template=node('select','filter-select');template.setAttribute('aria-label','Plantilla relacionada');
    template.append(new Option('Todas las plantillas',''));
    for(const value of state.summary?.incidents?.by_template || [])template.append(new Option(value.key,value.key));
    template.value=state.filters.template || '';template.addEventListener('change',()=>changed('template',template.value));root.append(template);
    const riskWindow=node('input','filter-select');riskWindow.type='number';riskWindow.min='0.25';riskWindow.max='72';riskWindow.step='0.25';
    riskWindow.value=state.filters.near_return_hours || '3';riskWindow.setAttribute('aria-label','Cerca de devolución: umbral visual en horas');
    riskWindow.title='Umbral visual configurable; no modifica la política ni el deadline de devolución';
    riskWindow.addEventListener('change',()=>changed('near_return_hours',riskWindow.value));root.append(riskWindow);
    for (const [value, label] of [['AUSENTE','AUSENTE'],['FIRST_ABSENCE','Primera ausencia'],['SECOND_ABSENCE','Segunda ausencia'],
      ['ABSENCE_ATTEMPT_UNKNOWN','Intento no verificable'],['STALE','Datos atrasados'],
      ['WAITING_CUSTOMER','Esperando cliente'],['CUSTOMER_RESPONDED','Cliente respondió'],['RESCHEDULE_REQUESTED','Nueva entrega'],
      ['PICKUP_REQUESTED','Recogida agencia'],['LOGISTICS_VALIDATION_REQUIRED','Validar logística'],['HUMAN_REVIEW_REQUIRED','Revisión humana'],['SIMULATION_READY','Simulación preparada']]) {
      const count = state.summary?.incidents?.absent_filters?.[value];
      const button = node('button', `filter-chip absent-filter ${state.filters.absent === value ? 'active' : ''}`.trim(), count===undefined?label:`${label} · ${count}`);
      button.title='Número de incidencias en la selección actual; incluye los filtros activos';
      button.type = 'button'; button.addEventListener('click', () => changed('absent', state.filters.absent === value ? '' : value)); root.append(button);
    }
    for (const [key, label, type] of [['q', 'Buscar pedido o incidencia', 'search']]) {
      const input = node('input', 'filter-select'); input.type = type; input.placeholder = label;
      input.setAttribute('aria-label', label); input.value = state.filters[key] || '';
      input.addEventListener('change', () => changed(key, input.value));
      if (type === 'search') input.addEventListener('keydown', (event) => { if (event.key === 'Enter') changed(key, input.value); });
      root.append(input);
    }
  }
}
function renderIncidentFilters(root) {
  if(typeof IncidentPanel!=='undefined'){IncidentPanel.filters(root);return;}
  const data=state.summary.incidents, dashboard=data.dashboard;
  const change=(key,value)=>{state.filters[key]=state.filters[key]===value?'':value;state.offset=0;loadQueue();};
  const toolbar=node('div','incident-filter-toolbar'),tabs=node('div','incident-scope-tabs');
  for(const [value,label] of [['ACTIVE','Pendientes de resolver'],['FOLLOWUP','Seguimiento'],['HISTORICAL','Consultar histórico']]){
    const b=node('button',`filter-chip ${state.filters.scope===value?'active':''}`,`${label} · ${dashboard.scope_counts[value]}`);b.type='button';b.setAttribute('aria-pressed',String(state.filters.scope===value));
    b.addEventListener('click',()=>{state.filters={scope:value};state.offset=0;loadQueue();});tabs.append(b);
  }
  const controls=node('div','incident-filter-actions'),clear=node('button','secondary-button','Limpiar filtros'),apply=node('button','primary-button','Aplicar filtros');
  clear.type=apply.type='button';clear.addEventListener('click',()=>{state.filters={scope:state.filters.scope || 'ACTIVE'};state.offset=0;loadQueue();});
  apply.addEventListener('click',()=>{state.offset=0;loadQueue();});controls.append(clear,apply);toolbar.append(tabs,controls);root.append(toolbar);
  const fields=node('div','incident-filter-grid');
  const definitions=[['scope','Alcance',[['ACTIVE','Pendientes de resolver'],['FOLLOWUP','Seguimiento'],['HISTORICAL','Histórico']]],
    ['type','Tipo de incidencia',dashboard.chips.type.map(i=>[i.value,i.label])],
    ['response','Estado cliente',[['VALID_ACTION','Respuesta válida'],['INCONCLUSIVE_INTERACTION','Respuesta no concluyente'],['NO_ACTION','Sin respuesta verificada'],['NOT_VERIFIABLE','No verificable']]],
    ['automation','Automatización',[['HUMAN_REVIEW','Revisión humana'],['SIMULATION_READY','Simulación preparada'],['WAITING_CUSTOMER','Esperando cliente']]],
    ['month','Tiempo',(data.available_months || []).map(v=>[v,v])],
    ['risk','Prioridad',[1,2,3,4,5,6].map(v=>[String(v),`P${v}`])],
    ['template','Plantilla',dashboard.templates.map(v=>[v,v])]];
  for(const [key,label,options] of definitions){const field=node('label','incident-filter-field',label),select=node('select','filter-select');
    select.setAttribute('aria-label',label);if(key!=='scope')select.append(new Option('Todos',''));
    for(const [value,title] of options)select.append(new Option(title,value));select.value=state.filters[key] || (key==='scope'?'ACTIVE':'');
    select.addEventListener('change',()=>{state.filters[key]=select.value;});field.append(select);fields.append(field);
  }
  root.append(fields);
  const groups=node('div','incident-chip-groups');
  for(const [key,label] of [['type','Tipo de incidencia'],['attempt','Intentos de entrega'],['flow','Estado del flujo']]){
    const group=node('div','incident-chip-group');group.append(node('small','',label));const chips=node('div','incident-chips');
    for(const value of dashboard.chips[key]){const b=node('button',`filter-chip ${state.filters[key]===value.value?'active':''}`,`${value.label} · ${value.count}`);b.type='button';b.setAttribute('aria-pressed',String(state.filters[key]===value.value));b.addEventListener('click',()=>change(key,value.value));chips.append(b);}group.append(chips);groups.append(group);
  }root.append(groups);
  const search=node('input','filter-select incident-search');search.type='search';search.placeholder='Buscar pedido, incidencia o cliente…';search.setAttribute('aria-label',search.placeholder);search.value=state.filters.q || '';
  search.addEventListener('change',()=>{state.filters.q=search.value.trim();state.offset=0;loadQueue();});root.append(search);
  if(state.filters.scope==='HISTORICAL')for(const [key,label] of [['from','Desde'],['to','Hasta']]){const field=node('label','incident-date-field',label),input=node('input','filter-select');input.type='date';input.value=state.filters[key] || '';input.addEventListener('change',()=>{state.filters[key]=input.value;});field.append(input);root.append(field);}
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
function discountStatusCard(item) {
  const discount = item.discount_recovery || {};
  if (!discount.applies) return stacked('No aplica', 'La incidencia no es de rechazo de mercancía', 'discount-state not-applicable');
  const status = discount.status || 'NOT_AVAILABLE';
  const card = node('div', `stacked discount-state ${discount.tone || 'review'}`);
  const icon = status === 'DISCOUNT_ACCEPTED' ? '✓' : status === 'DISCOUNT_REJECTED' ? '×'
    : status === 'NO_RESPONSE' ? '◷' : status === 'OTHER_RESPONSE' ? '!' : '–';
  card.append(node('strong', 'discount-state-title', `${icon} ${text(discount.title)}`), node('small', '', text(discount.summary)));
  if (discount.sent_at) card.append(node('small', 'discount-evidence', `Enviado ${date(discount.sent_at)}`));
  if (discount.responded_at) card.append(node('small', 'discount-evidence', `Respondió ${date(discount.responded_at)}`));
  return card;
}
const recoveryLabels={PENDING:'Pendiente real',CONTACT_PENDING:'Contacto pendiente',CUSTOMER_ACTED:'Cliente actuó',RECOVERABLE_NOW:'Recuperable ahora',WAITING_CUSTOMER:'Esperando cliente',WAITING_SULEIA:'Esperando acción Suleia',RETURN_RISK:'Cerca de devolución',RECOVERED:'Recuperado',DELIVERED_AFTER_INCIDENT:'Entregado tras incidencia',RETURN_REQUESTED:'Devolución solicitada',RETURNED:'Devuelto',EVIDENCE_UNCERTAIN:'Evidencia no concluyente',UNRESOLVED:'Sin recuperación verificada',WAITING_RESPONSE:'Esperando respuesta',NOT_OFFERED:'No ofrecido',ACCEPTED:'Aceptado',REJECTED:'Rechazado',INCONCLUSIVE_RESPONSE:'Respuesta no concluyente'};
function recoveryIcon(kind) {
  const paths={package:['m3 7 9-4 9 4v10l-9 4-9-4Z','m3 7 9 4 9-4M12 11v10'],message:['M3 4h18v13H8l-5 4Z','M7 8h10M7 12h7'],retry:['M4 10a8 8 0 1 1 1 8','m4 4 0 6 6 0'],clock:['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18','M12 7v5l4 2'],task:['M8 3h8v3H8ZM6 5H4v17h16V5h-2','m8 13 3 3 5-6'],warning:['m12 3 10 18H2Z','M12 9v5M12 17h.01'],check:['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18','m7 12 3 3 7-7'],truck:['M2 5h12v12H2ZM14 9h4l4 4v4h-8','M7 17v3M18 17v3'],return:['m7 4-4 4 4 4','M3 8h12a6 6 0 0 1 0 12h-4'],search:['M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14','m15 15 6 6']};
  const svg=svgEl('svg',{viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':1.8,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',class:'recovery-icon'});
  (paths[kind] || paths.search).forEach(d=>svg.append(svgEl('path',{d})));return svg;
}
function recoveryDuration(seconds) {
  if(seconds===null || seconds===undefined)return 'N/D — falta deadline real';
  const minutes=Math.max(0,Math.floor(Number(seconds)/60));return `${Math.floor(minutes/60)} h ${minutes%60} min`;
}
function incidentDate(value) {
  const parsed=value?new Date(value):null;
  return parsed && Number.isFinite(parsed.getTime())?new Intl.DateTimeFormat('es-ES',{timeZone:'Europe/Madrid',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(parsed):'—';
}
function recoveryTimer(item) {
  const timer=item.recovery?.timer || {};
  return stacked(timer.state==='ACTIVE'?recoveryDuration(timer.remaining_seconds):timer.state==='EXPIRED'?'Plazo vencido':timer.state==='INACTIVE'?'Temporizador inactivo':'Plazo no verificable',timer.deadline?incidentDate(timer.deadline):'Sin plazo confirmado', 'recovery-timer');
}
function renderRecoveryCenter(data) {
  $('recovery-center').hidden=state.view!=='incidents';if(state.view!=='incidents')return;
  const m=data?.metrics || {};
  $('recovery-caption').textContent=data?.dashboard?`${data.dashboard.stale?'Datos atrasados · ':''}Fuente: API de Dropea · ${data.universe_count} incidencias en este alcance · ${date(data.last_sync_at)}`:`${data?.universe_count ?? 0} incidencias · ${state.filters.month || 'todos los meses'} · ${translated(state.filters.scope || 'ALL')} · actualizado ${date(data?.last_sync_at)}`;
  const autopilot=data?.autopilot || {},attention=$('autopilot-attention');attention.replaceChildren();
  for(const [key,label] of [['RECOVERABLE_NOW','Recuperables ahora'],['HUMAN_REVIEW','Revisión humana'],['ERROR','Errores']]){
    const button=node('button',`autopilot-attention-card ${key==='ERROR'?'danger':''}`.trim());button.type='button';
    button.append(node('span','',label),node('strong','',String(autopilot.attention?.[key] ?? 0)));
    button.addEventListener('click',()=>{state.filters.autopilot=key;state.offset=0;renderFilters();loadQueue();});attention.append(button);
  }
  const health=$('autopilot-health');health.replaceChildren();
  for(const connector of autopilot.connectors || []){
    const row=node('div','autopilot-health-row');row.append(node('strong','',connector.connector || 'Fuente'),badge(translated(connector.freshness_status || connector.data_health || 'UNKNOWN')),node('small','',connector.age_seconds===null || connector.age_seconds===undefined?'Sin lectura válida':`hace ${duration(connector.age_seconds)}`));health.append(row);
  }
  const counters=node('div','autopilot-health-counters');counters.append(
    node('span','',`Timers activos ${autopilot.timers?.active ?? 0}`),node('span','',`Vencidos ${autopilot.timers?.expired ?? 0}`),
    node('span','',`Acciones simuladas ${autopilot.actions?.simulated ?? 0}`),node('span','',`Escrituras reales ${autopilot.actions?.production_writes ?? 0}`));health.append(counters);
  const stages=[['Incidencias',m.orders,null],['Contactados',m.contact_missing_event?null:m.contacted,'CONTACTED'],['Respondieron',m.response_missing_event?null:m.replied,'CUSTOMER_ACTED'],['Recuperados',m.recovery_missing_event?null:m.recovered,'RECOVERED'],['Nueva entrega',m.redelivery_missing_event?null:m.redelivery,'REDELIVERY'],['Entregados',m.delivered,'DELIVERED_AFTER_INCIDENT']];
  const funnel=$('recovery-funnel');funnel.replaceChildren();
  for(let index=0;index<stages.length;index++){
    const [label,value,key]=stages[index],card=node(key?'button':'div','recovery-stage');
    card.append(node('small','',label),node('strong','',value===null || value===undefined?'N/D':String(value)),node('small','',value===null?'Falta hito verificado':`${percentage(value,m.orders)} del total · ${index?percentage(value,stages[index-1][1]):'base de pedidos únicos'}`));
    if(key){card.type='button';card.addEventListener('click',()=>{state.filters.recovery=key;state.offset=0;loadQueue();});}funnel.append(card);
  }
  const metrics=$('recovery-business-metrics');metrics.replaceChildren();
  for(const [label,value] of [['Tasa de respuesta',m.response_rate],['Tasa de recuperación',m.recovery_rate],['Entrega post-incidencia',m.delivery_rate],['Tasa de devolución',m.return_rate]]){
    const field=node('div','recovery-business-metric');field.append(node('small','',label),node('strong','',value===null || value===undefined?'N/D':`${Number(value).toFixed(1)} %`));metrics.append(field);
  }
  for(const [label,value,coverage] of [['Tiempo medio de respuesta',m.mean_response_seconds,m.response_duration_coverage],['Tiempo medio de recuperación',m.mean_recovery_seconds,m.recovery_duration_coverage]]){
    const field=node('div','recovery-business-metric');field.append(node('small','',label),node('strong','',value===null || value===undefined?'N/D — falta timestamp del hito':recoveryDuration(value)),node('small','',`${coverage || 0} intervalos con fecha verificada`));metrics.append(field);
  }
  const performance=(id,title,rows)=>{
    const root=$(id);root.replaceChildren(node('h3','',title));const table=node('table','recovery-performance-table');
    const head=node('tr');for(const label of ['Grupo','Pedidos con incidencia','Respuesta','Recuperación','Entrega','Devolución'])head.append(node('th','',label));table.append(head);
    for(const row of rows || []){const tr=node('tr');tr.append(cell(translated(row.key)),cell(row.orders));for(const value of [row.response_rate,row.recovery_rate,row.delivery_rate,row.return_rate])tr.append(cell(value===null?'N/D':`${Number(value).toFixed(1)} %`));table.append(tr);}root.append(table);
  };
  performance('recovery-by-type','Rendimiento por tipo de incidencia',data?.by_type);
  performance('recovery-by-template','Rendimiento por plantilla observada',data?.by_template);
  $('recovery-method').textContent=`${data?.denominator_definition || ''} ${m.uncertain_incidents || 0} incidencias con evidencia no concluyente. Cobertura de respuesta: ${m.response_evidence_coverage || 0}/${m.response_evidence_total || 0} pedidos contactados. El embudo cuenta pedidos únicos; la tabla y KPIs, incidencias. Las plantillas agrupan el contacto inicial realmente observado, sin atribuir causalidad. Cerca de devolución: umbral visual ${recoveryDuration(data?.near_threshold_seconds)}; no modifica políticas.`;
}
function recoveryEvidenceDetail(item) {
  const e=item.recovery?.evidence || {};
  return section('Evidencia Chatby de ESTA incidencia', [['Conversación',e.conversation==='EXACT'?'Encontrada y exacta':e.conversation || 'No verificable'],['Actividad',recoveryEvidenceLabel(e)],['Mensaje o acción real',e.message || e.action_label || (e.no_action_verified?'Ninguna acción realizada':'No se pudo verificar una interacción posterior al aviso')],['Tipo',e.message_type==='BUTTON'?'Botón / acción del cliente':e.message_type==='TEXT'?'Mensaje del cliente':'—'],['Fecha/hora',date(e.response_at)],['Notificación observada',date(e.notification_at)],['Última lectura de esta conversación',date(e.read_at)],['Plantilla/origen',e.template || 'N/D — falta plantilla observada'],['Validez',e.validity || 'NOT_VERIFIABLE',true],['Motivo técnico',e.reason]]);
}
function recoveryEvidenceLabel(e) {
  return e.customer_acted ? 'Cliente actuó'
    : e.customer_interacted?'Cliente respondió · intención no concluyente'
    : e.no_action_verified?'Ninguna acción realizada':e.reason==='INCIDENT_NOTIFICATION_NOT_OBSERVED'?'Sin aviso verificable de esta incidencia':'Chatby no verificable';
}
function autopilotDetail(item) {
  const a=item.autopilot || {};
  return section('Suleia Incident Autopilot', [['Estado',translated(a.state),true],['Modo',a.mode || 'SIMULATION / SHADOW',true],
    ['Qué hará después',translated(a.next_action) || 'Reevaluar con fuentes vigentes'],['Por qué',a.reason || 'Sin decisión disponible'],
    ['Espera a',translated(a.waiting_for) || 'Nada'],['Fecha límite',date(a.due_at)],['Revisión humana',a.human_review?'Sí':'No',true],
    ['Error',a.error || 'Ninguno'],['Policy',`${a.policy_name || 'SULEIA_INCIDENT_AUTOPILOT'} · ${a.policy_version || 'N/D'}`],
    ['Acciones reales nuevas','0'],['Escrituras externas nuevas','0']], 'autopilot-detail');
}
function recoveryDetail(item) {
  const r=item.recovery || {};
  return section('Recuperación del pedido', [['Estado interno Suleia',recoveryLabels[r.status] || r.status,true],['Estado original Dropea',item.recovery_order_state || item.order_status],['Solución actual',item.tailored_recommendation?.title],['Opción Dropea',item.tailored_recommendation?.resolution_option || 'Pendiente de validación'],['Prioridad',r.priority],['Recovery Score',`${r.score ?? 0}/100 · informativo, nunca ejecuta acciones`],['Por qué', (r.score_reasons || []).map(v=>`${v.points>0?'+':''}${v.points}: ${v.reason}`).join(' · ') || 'Sin oportunidad verificada'],['Deadline real',date(r.timer?.deadline)],['Tiempo restante',recoveryDuration(r.timer?.remaining_seconds)],['Policy',r.timer?.policy_reason],['Última actualización',date(r.derived_at)]]);
}
function recoveryTimelinePanel(events) {
  const section=node('section','detail-section recovery-chronology');section.append(node('h3','','Timeline cronológica del pedido'));
  const list=node('ol','timeline');for(const event of events || []){
    const row=node('li','timeline-item');row.append(node('time','',date(event.occurred_at)),node('strong','',event.source || 'Fuente no informada'),node('span','',event.label || event.event_type));
    if(event.validity)row.append(node('small','',event.validity==='AFTER_NOTIFICATION'?'Posterior a la notificación · verificar intención':'Histórico / no demuestra respuesta a esta incidencia'));
    if(String(event.event_type).includes('SIMULAT'))row.append(node('small','','Propuesta en simulación, no acción ejecutada'));list.append(row);
  }section.append(list);if(!(events || []).length)section.append(node('p','muted','N/D — faltan eventos observados'));return section;
}
function rowIncident(item) {
  if(typeof IncidentPanel!=='undefined' && item.dashboard)return IncidentPanel.row(item);
  const tr=node('tr');tr.tabIndex=0;
  const r=item.recovery || {},e=r.evidence || {},a=item.autopilot || {};
  const evidence=stacked(recoveryEvidenceLabel(e),(e.customer_acted || e.customer_interacted)?`${e.message_type==='BUTTON'?'Botón / acción':'Mensaje'} · ${date(e.response_at)}`:e.no_action_verified?`Lectura verificada · ${date(e.read_at)}`:'Sin cobertura verificada de aviso a lectura','incident-evidence');
  if(e.message)evidence.append(node('q','message-quote',e.message));
  else if(e.action_label)evidence.append(node('small','',`Acción verificada: ${e.action_label} · texto literal no disponible`));
  const recommendation=item.tailored_recommendation || {};
  tr.append(
    cell(stacked(item.external_order_reference || `Dropea #${short(item.dropea_order_id)}`,item.recovery_order_state || item.lifecycle_status || item.order_status || 'Estado no disponible')),
    cell(stacked(translated(item.interpreted_type),`#${item.dropea_issue_id} · ${incidentDate(item.created_at)}`)),
    cell(stacked(item.customer_name || 'Cliente no disponible',''),'signal-cell'),
    cell(evidence,'evidence-cell'),
    cell(stacked(item.dashboard?.action || recommendation.title || 'Reevaluar',item.dashboard?.action_detail || recommendation.summary),'decision-card'),
    cell(recoveryTimer(item)),
    cell(stacked(item.dashboard?(item.dashboard.flags.WAITING_CUSTOMER?'Esperando cliente':item.dashboard.flags.SIMULATION_READY?'Simulación preparada':item.dashboard.flags.HUMAN_REVIEW?'Revisión humana':recoveryLabels[r.status] || 'Pendiente de revisión'):recoveryLabels[r.status] || r.status || 'N/D',e.message
      ? `${e.message_type==='BUTTON'?'Botón / acción':'Mensaje'} · ${e.message}`
      : e.action_label || (e.no_action_verified?'Ninguna acción realizada':'Evidencia no concluyente'))),
    cell(stacked(`P${item.dashboard?.priority || r.priority || 6}`,item.dashboard?.priority_reason || (a.human_review?'Revisión humana':a.error?'Error':`${r.score ?? 0}/100`)),`priority-cell priority-${item.dashboard?.priority || r.priority || 6}`)
  );
  if(item.dashboard)tr.children[7].title=item.dashboard.priority_reason;
  tr.addEventListener('click',()=>openDetail(item.canonical_issue_id));
  tr.addEventListener('keydown',event=>{if(event.key==='Enter')openDetail(item.canonical_issue_id);});return tr;
}
function renderHead() {
  if(state.view==='incidents' && typeof IncidentPanel!=='undefined'){IncidentPanel.head();return;}
  const labels=state.view==='orders'?['Pedido / fecha','Producto','Acción recomendada','Acción real','Respuesta del cliente','Cliente / importe','Calidad']
    :['Pedido','Incidencia','Cliente','Evidencia cliente','Siguiente acción','Timer','Resultado','Prioridad'];
  const tr=node('tr');labels.forEach(label=>tr.append(node('th','',label)));$('table-head').replaceChildren(tr);
}

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
    if (view === 'incidents') { state.summary = { ...(state.summary || {}), incidents: data.summary }; renderSummary(); renderFilters(); }
    if (data.total > 0 && state.offset >= data.total) {
      state.offset = Math.floor((data.total - 1) / state.limit) * state.limit;
      loadQueue(); return;
    }
    if (data.total === 0) state.offset = 0;
    state.total = data.total; if (view === 'orders') renderSummary(); const items = data.items || []; const body = $('table-body');
    body.replaceChildren(...items.map(view === 'orders' ? rowOrder : rowIncident)); $('empty-state').hidden = items.length > 0;
    if (!items.length && view === 'incidents') $('empty-state').textContent = 'No hay incidencias para los filtros seleccionados.';
    $('result-count').textContent = view === 'orders'
      ? `${data.total} pedido(s) pendiente(s) en Dropea`
      : `${data.total} resultados · ${data.summary?.scope==='ACTIVE'?'pendientes de resolver':data.summary?.scope==='FOLLOWUP'?'seguimiento: siguen abiertas':'histórico'} · ordenados por ${{order:'pedido',incident:'incidencia',customer:'cliente',timer:'plazo',priority:'prioridad'}[state.filters.sort] || 'urgencia'}`;
    $('queue-source').textContent = view === 'orders'
      ? `Fuente: Dropea · Chatby por pedido · refresco automático cada ${state.config.refresh_interval_seconds} s`
      : `Fuente: Dropea, Chatby y policy vigente · refresco automático cada ${state.config.refresh_interval_seconds} s`;
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
    const current = item.relation_to_notification === 'AFTER_NOTIFICATION';
    const card = node('article', `customer-message ${item.direction === 'OUTBOUND' ? 'operator-message' : 'customer-reply'} ${current ? 'current' : 'previous'}`);
    card.append(node('strong', 'message-speaker', speaker), node('q', 'message-quote', item.text), node('small', '', `${date(item.occurred_at)} · ${current ? 'respuesta posterior a la notificación' : 'histórico / contexto · no es evidencia de respuesta a esta incidencia'} · ${translated(item.intent)}`));
    list.append(card);
  }
  box.append(list); return box;
}
function absentShadowCard(item, expanded = false) {
  const s = item.absent_shadow;
  const card = node('div', 'absent-shadow-card');
  if (!s) return card;
  const labels = { WOULD_SEND_ABSENT_TEMPLATE: 'Preparar contacto AUSENTE', WOULD_REQUEST_CUSTOM_SLOT: 'Pedir fecha y franja',
    WOULD_VALIDATE_LOGISTICS: 'Validar disponibilidad GLS', WOULD_REQUEST_NEW_DELIVERY: 'Proponer nueva entrega',
    WOULD_REQUEST_PICKUP_AT_AGENCY: 'Proponer recogida en agencia', WOULD_RETURN_TO_ORIGIN: 'Proponer devolución',
    WOULD_CREATE_OR_REQUIRE_48H_TIMER:'Falta plazo de respuesta de 48 h', WOULD_REQUEST_ADDRESS_CHANGE: 'Revisar cambio de dirección', HUMAN_REVIEW_REQUIRED: 'Revisión humana necesaria', HOLD_WAITING_CUSTOMER: 'Esperar selección de franja' };
  card.append(node('small', 'absent-shadow-label', 'SIGUIENTE ACCIÓN · SIMULACIÓN'),
    node('strong', '', labels[s.next_action] || s.next_action),
    node('small', '', s.absence_attempt === 'FIRST_ABSENCE' ? 'Primera ausencia' : s.absence_attempt === 'SECOND_ABSENCE' ? 'Segunda ausencia' : 'Intento no verificable'),
    node('small', '', s.reason_text), node('small', '', 'No ejecutado · no se envía ni modifica el pedido'));
  const details = node('details', 'absent-shadow-details'); details.open = expanded;
  details.append(node('summary', '', 'Ver evidencia, logística y plazo'));
  details.append(section('Control AUSENTE', [
    ['Estado', s.current_step], ['Respuesta', s.customer_response_status], ['Intent', s.customer_intent],
    ['Causa interpretada',s.interpreted_type || 'RECIPIENT_ABSENT'],['Ruta',s.routing_policy || s.policy_version],
    ['Evidencia temporal',s.response_anchor_kind==='SHADOW_ISSUE_CREATED_ONLY'?'Solo simulación desde la incidencia; no prueba notificación':'Desde notificación observada'],
    ['Respuesta cliente',item.latest_customer_message || 'No hay respuesta verificable disponible'],
    ['Botón', s.button_pressed || 'No detectado'], ['Fecha solicitada', s.requested_date || 'No indicada'],
    ['Franja', s.requested_time_window || 'No indicada'], ['Desde / hasta', `${s.time_from || '—'} / ${s.time_to || '—'}`],
    ['Todo el día', s.all_day ? 'Sí' : 'No'], ['Recogida solicitada', s.pickup_requested ? 'Sí' : 'No'],
    ['Historial relevante', s.history_relevant ? 'Sí · señal logística, no sanción' : 'No verificado o no relevante'],
    ['Viabilidad', s.logistics_feasibility], ['Confianza', `${Math.round(s.decision_confidence * 100)} %`],
    ['Prioridad logística', s.logistics_preference || 'Sin preferencia'], ['Fallo tras franja del cliente', s.delivery_failed_after_customer_slot ? 'Sí · requiere validación logística' : 'No verificado'],
    ['Timer existente', s.existing_timer?.timer_type || 'No disponible'], ['Fecha límite', date(s.due_at)],
    ['Tiempo restante',s.due_at?`${Math.max(0,Math.floor((new Date(s.due_at)-Date.now())/3600000))} h ${Math.max(0,Math.floor((new Date(s.due_at)-Date.now())/60000)%60)} min`:'Sin timer válido'],
    ['Estado general de datos',item.effective_freshness_status || s.effective_freshness_status],
    ['Capacidad declarada Dropea',s.logistics_capabilities?.dropea_resolution_capability || 'UNKNOWN'],
    ['Capacidad verificada transportista',s.logistics_capabilities?.carrier_capability || 'UNKNOWN'],
    ['Dropea / Chatby / GLS', Object.values(s.data_freshness || {}).join(' / ')],
    ['Estado simulación', s.simulation_status], ['Policy', s.policy_version],
    ['ID del registro',s.policy_id || 'NO PERSISTIDO'],['Hash de policy',s.policy_snapshot_hash || 'NO DISPONIBLE'],
    ['Hash de entrada',s.input_snapshot_hash || 'NO DISPONIBLE'],['Decisión vigente',s.decision_id || 'NO DISPONIBLE']
  ]));
  card.append(details); return card;
}
function discountRecoveryDetail(incident) {
  const discount = incident.discount_recovery || {};
  if (!discount.applies) return document.createDocumentFragment();
  const box = node('section', `detail-section discount-detail ${discount.tone || 'review'}`);
  const heading = node('div', 'discount-detail-heading');
  heading.append(node('h3', '', 'Recuperación con descuento de 5 €'), discountStatusCard(incident));
  box.append(heading);
  const priceVerified = discount.cross_source_verified === true;
  const fields = [
    ['Resultado', discount.title || 'NO DISPONIBLE', true],
    ['Plantilla inicial', discount.initial_template_sent_at ? `ENVÍO REGISTRADO · ${date(discount.initial_template_sent_at)}` : 'NO VERIFICADA'],
    ['Plantilla descuento', discount.sent_at ? `ENVÍO VERIFICADO · ${date(discount.sent_at)}` : 'NO VERIFICADA'],
    ['Respuesta posterior', discount.responded_at ? date(discount.responded_at) : 'SIN RESPUESTA'],
    ['Precio original', priceVerified ? money(discount.original_amount) : 'NO VERIFICADO'],
    ['Descuento', priceVerified && discount.discount_amount !== null ? money(discount.discount_amount) : 'NO VERIFICADO'],
    ['Precio final', priceVerified ? money(discount.final_amount) : 'NO VERIFICADO'],
    ['Cruce de fuentes', priceVerified ? 'VERIFICADO' : 'NO VERIFICADO', true],
    ['Última comprobación', date(discount.source_updated_at)]
  ];
  const grid = node('div', 'field-grid');
  fields.forEach((item) => grid.append(field(...item)));
  box.append(grid, node('p', 'muted discount-proof-note', 'Sólo se muestra “aceptado” o “no aceptado” cuando la plantilla fue entregada y la respuesta del cliente es posterior y está vinculada al mismo pedido.'));
  return box;
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
        autopilotDetail(incident),
        section('Evaluación actual del panel', [['Siguiente acción',incident.dashboard?.action],['Motivo',incident.dashboard?.action_detail],['Decisión vigente',incident.dashboard?.decision_current?'Sí':'No verificable'],['Prioridad',incident.dashboard?.priority_reason],['Bloqueos',incident.dashboard?.blocking_reasons?.join(' · ') || 'Sin bloqueos registrados'],['Modo','SHADOW_READ_ONLY · acciones externas deshabilitadas']]),
        recoveryDetail(incident),
        recoveryEvidenceDetail(incident),
        recoveryTimelinePanel(data.recovery_timeline),
        discountRecoveryDetail(incident),
        absentShadowCard(incident, true),
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
function moveFinanceMonth(direction) { const select = $('finance-month'); const index = state.financeMonths.indexOf(select.value); const target = direction === 'older' ? index + 1 : index - 1; if (target < 0 || target >= state.financeMonths.length) return; select.value = state.financeMonths[target]; updateFinanceMonthNavigation(); loadResultsFinance(); }
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
    financeMetric('Facturación realizada', money(totals.real_revenue, currency), `${text(totals.delivered, '0')} pedidos de la cohorte ya entregados`, 'positive'),
    financeMetric('Gastos totales', money(totals.total_expenses, currency), 'Producto + logística + publicidad + gastos fijos', totals.total_expenses === null ? 'unknown' : 'warning'),
    financeMetric('ROI', financePercent(totals.roi), 'Beneficio neto ÷ gastos totales', totals.roi === null ? 'unknown' : Number(totals.roi) >= 0 ? 'positive' : 'negative'),
    financeMetric('CPA real', money(totals.real_cpa, currency), 'Publicidad ÷ pedidos entregados', totals.real_cpa === null ? 'unknown' : ''),
    financeMetric('Facturación estimada', money(totals.estimated_revenue, currency), `${text(totals.orders_sent, '0')} pedidos enviados`, 'warning'),
    financeMetric('Publicidad', money(totals.costs?.advertising, currency), `${text(data.quality?.advertising_days_complete, '0')} días verificados`, ''),
    financeMetric('Mes analizado', monthLabel(data.month), data.provisional ? `Mes abierto · ${closedThrough ? `cerrado hasta ${closedThrough}` : 'pendiente de cierre'}` : 'Mes histórico', '')
  );
  const cohort = totals.cohort || {};
  const funnel = [
    ['Pedidos en Dropea', cohort.orders_created ?? totals.orders_created], ['Enviados', cohort.orders_sent ?? totals.orders_sent], ['Entregados', cohort.delivered ?? totals.delivered],
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
    stacked('Perspectiva', 'Cohorte por fecha de creación; cada pedido conserva su estado actual verificado'),
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

// Results dashboard. Its source is the reconciled finance read model: Dropea
// per-order settlement, Meta spend and the monthly expense ledger.
const percentNumber = (value) => value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : `${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format(Number(value))} %`;
const number = (value) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 }).format(Number(value || 0));
const clamp = (value, low = 0, high = 100) => Math.max(low, Math.min(high, Number(value) || 0));
function comparisonText(field, mode = 'percent') {
  const delta = state.finance?.comparison?.deltas?.[field];
  const raw = mode === 'percent' ? delta?.percent : delta?.absolute;
  if (raw === null || raw === undefined) return 'Sin comparación disponible';
  const value = Number(raw); const suffix = mode === 'points' ? ' pp' : mode === 'multiplier' ? 'x' : '%';
  return `${value >= 0 ? '↗' : '↘'} ${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format(Math.abs(value))}${suffix} respecto al periodo anterior`;
}
function miniSparkline(values, tone) {
  const series = (values || []).filter(value=>value!==null&&value!==undefined).map(Number).filter(Number.isFinite); const svg = svgEl('svg', { viewBox: '0 0 120 28', class: `metric-sparkline ${tone || ''}`, 'aria-hidden': 'true' });
  if (!series.length) return svg;
  const low = Math.min(...series); const high = Math.max(...series); const spread = Math.max(1, high - low);
  const points = series.map((value, index) => `${series.length === 1 ? 60 : index * 116 / (series.length - 1) + 2},${25 - (value - low) * 20 / spread}`).join(' ');
  svg.append(svgEl('polyline', { points, fill: 'none' })); return svg;
}
function resultMetric(label, value, detail, tone, icon, series) {
  const card = node('article', `result-metric ${tone || ''}`.trim());
  const iconBox=node('span','result-metric-icon'); iconBox.append(financeIcon(icon));
  card.append(iconBox, node('span', 'result-metric-label', label), node('strong', '', value), miniSparkline(series, tone), node('small', '', detail));
  return card;
}
function financeIcon(kind) {
  const paths={ profit:['M4 18V12M10 18V8M16 18V4','m3 8 6-4 5 2 6-4'], revenue:['M6 3h12v18l-3-2-3 2-3-2-3 2Z','M9 7h6M9 11h6M9 15h3'],
    costs:['M3 5h18v14H3Z','M3 9h18M15 14h3'], roi:['M12 3a9 9 0 1 0 9 9','m16 3 5 0 0 5','M21 3 12 12'],
    roas:['m3 10 13-5v14L3 14Z','M16 8h3a3 3 0 0 1 0 6h-3M6 15l1 6h4l-1-5'], margin:['M6 18 18 6','M7 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8','M17 13a4 4 0 1 0 0 8 4 4 0 0 0 0-8'],
    delivery:['M12 3a9 9 0 1 0 9 9','m7 12 3 3 7-8'], delivered:['m3 7 9-4 9 4v10l-9 4-9-4Z','m3 7 9 4 9-4M12 11v10','m8 15 2 2 4-4'],
    returns:['m7 4-4 4 4 4','M3 8h12a6 6 0 0 1 0 12h-4'], transit:['M2 5h12v12H2ZM14 9h4l4 4v4h-8','M7 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4M18 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4'],
    confirmation:['M8 3h8v3H8ZM6 5H4v17h16V5h-2','m8 13 3 3 5-6'], history:['M3 3v18h18','m6 15 5-6 4 3 5-8'] };
  const svg=svgEl('svg',{viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':1.7,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'});
  (paths[kind] || paths.profit).forEach(d=>svg.append(svgEl('path',{d}))); return svg;
}
function svgEl(tag, attributes = {}) { const element = document.createElementNS('http://www.w3.org/2000/svg', tag); Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value))); return element; }
function niceMoneyScale(values, tickCount = 4) {
  const numeric = values.map(Number).filter(Number.isFinite); const rawMin = Math.min(0, ...numeric); const rawMax = Math.max(0, ...numeric);
  const span = Math.max(1, rawMax - rawMin); const rough = span / tickCount; const magnitude = 10 ** Math.floor(Math.log10(rough)); const normalized = rough / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  const minimum = Math.floor(rawMin / step) * step; const maximum = Math.ceil(rawMax / step) * step || step;
  return { minimum, maximum, step, ticks: Array.from({ length: Math.round((maximum - minimum) / step) + 1 }, (_, index) => minimum + index * step) };
}
function appendSvgTitle(element, content) { const title = document.createElementNS('http://www.w3.org/2000/svg', 'title'); title.textContent = content; element.append(title); return element; }
function selectedDailyView(data) {
  // The owner-selected purchase cohort is the same basis as the monthly KPI.
  // Settlement diagnostics remain available in the API, never merged here.
  return {...data,dailyBasis:'cohort'};
}
function dailyDetail(row,currency) {
  const root=node('section','daily-detail'); root.setAttribute('aria-live','polite');
  const pending=row.netProfit===null || row.netProfit===undefined; const positive=Number(row.netProfit)>=0;
  const lead=node('div',`daily-detail-lead ${pending?'pending':positive?'positive':'negative'}`);
  lead.append(stacked(date(row.day,true),`Pedidos comprados este día · ${row.closeLabel || 'estado actual en Dropea'}`),stacked(pending?'Resultado no disponible':positive?'Ganancia diaria':'Pérdida diaria',money(row.netProfit,currency))); root.append(lead);
  const stats=node('div','daily-detail-stats'); [['Facturación',money(row.realRevenue,currency)],['Costes totales',money(row.totalCosts,currency)],['Entregados',row.delivered===null?'—':number(row.delivered)],['Devueltos',row.returned===null?'—':number(row.returned)]].forEach(([label,value])=>stats.append(stacked(label,value))); root.append(stats);
  const costs=node('dl','daily-detail-costs'); [['Producto','productCost'],['Envío','outboundShippingCost'],['Fulfillment','outboundFulfillmentCost'],['COD','codCost'],['Devolución','returnCost'],['Ajustes / IVA Dropea','dropeaAdjustmentsCost'],['Meta del día','metaSpend'],['Fijos','fixedCosts'],['Puntuales','oneOffCosts'],['Otros','otherCosts']].forEach(([label,key])=>{const item=node('div'); item.append(node('dt','',label),node('dd','',money(row[key],currency))); costs.append(item);}); root.append(costs);
  return root;
}
function dailyResultsChart(days, currency) {
  const rows = (days || []).filter((row) => row.day);
  const root = node('div', 'daily-results-chart');
  if (!rows.length) { root.append(stacked('Todavía no hay días conciliados', 'Los datos aparecerán cuando se complete la primera sincronización.')); return root; }
  const mode = state.financeChartMode; const width = Math.max(820,rows.length*36+76); const height = 320; const left = 52; const right = 24; const top = 30; const bottom = 46;
  const primaryValues = (mode === 'pnl' ? rows.flatMap((row) => [row.realRevenue, row.totalCosts, row.netProfit]) : rows.map((row) => row.netProfit)).filter(value=>value!==null&&value!==undefined);
  const scale = niceMoneyScale(primaryValues); const range = Math.max(1, scale.maximum - scale.minimum); const plotWidth = width - left - right; const plotHeight = height - top - bottom;
  const x = (index) => left + (index + .5) * plotWidth / rows.length; const y = (value) => top + (scale.maximum - Number(value || 0)) / range * plotHeight;
  const zeroY = y(0);
  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': mode === 'pnl' ? 'P&L diario completo' : 'Beneficio neto de cada día del mes' });
  scale.ticks.forEach((tick) => {
    const gridY = y(tick);
    svg.append(svgEl('line', { x1: left, y1: gridY, x2: width - right, y2: gridY, class: tick === 0 ? 'chart-zero-line' : 'chart-grid-line' }));
    const label = svgEl('text', { x: left - 6, y: gridY + 4, class: 'chart-axis-label', 'text-anchor': 'end' });
    label.textContent = `${Math.round(tick)} €`; svg.append(label);
  });
  const detail=node('div','daily-detail-slot'); const groups=[]; const buttons=[];
  const selectDay=row=>{state.financeSelectedDay=row.day; detail.replaceChildren(dailyDetail(row,currency)); groups.forEach(([day,group])=>group.setAttribute('class',`chart-day-group${day===row.day?' is-selected':''}`)); buttons.forEach(([day,button])=>{button.classList.toggle('is-selected',day===row.day);button.setAttribute('aria-pressed',String(day===row.day));});};
  const groupWidth = plotWidth / rows.length; const profitWidth = Math.max(5, Math.min(24, groupWidth * (mode === 'pnl' ? .22 : .68)));
  rows.forEach((row, index) => {
    const center = x(index); const profit = Number(row.netProfit || 0); const missing=row.netProfit===null||row.netProfit===undefined; const partial = row.closeStatus === 'CURRENT_PARTIAL' ? ' partial' : '';
    const group=svgEl('g',{class:'chart-day-group',tabindex:0,role:'button','aria-label':`${date(row.day,true)} · ${missing?'Sin datos completos':money(row.netProfit,currency)} · consultar detalle`});
    group.append(svgEl('rect',{x:center-groupWidth/2+1,y:top,width:Math.max(1,groupWidth-2),height:plotHeight,rx:5,class:'chart-day-hit'}));
    for (const event of ['mouseenter','focus','click']) group.addEventListener(event,()=>selectDay(row));
    group.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();selectDay(row);}else if(event.key==='ArrowRight'||event.key==='ArrowLeft'){event.preventDefault(); const next=Math.max(0,Math.min(rows.length-1,index+(event.key==='ArrowRight'?1:-1)));selectDay(rows[next]);groups[next][1].focus();}}); groups.push([row.day,group]);
    if (missing) {group.append(svgEl('rect',{x:center-5,y:zeroY-3,width:10,height:6,rx:2,class:'chart-missing-bar'}));}
    else if (mode === 'pnl') {
      const revenueY = y(row.realRevenue); const costsY = y(row.totalCosts); const widthPnl = Math.max(3, Math.min(9, groupWidth * .2));
      group.append(svgEl('rect', { x: center - widthPnl * 1.6, y: Math.min(zeroY,revenueY), width: widthPnl, height: Math.max(1, Math.abs(zeroY - revenueY)), rx: 2, class: `chart-bar revenue${partial}` }));
      group.append(svgEl('rect', { x: center - widthPnl * .45, y: Math.min(zeroY,costsY), width: widthPnl, height: Math.max(1, Math.abs(zeroY - costsY)), rx: 2, class: `chart-bar costs${partial}` }));
      const profitY = y(profit); group.append(svgEl('rect', { x: center + widthPnl * .7, y: Math.min(zeroY, profitY), width: widthPnl, height: Math.max(2, Math.abs(zeroY - profitY)), rx: 2, class: `chart-bar ${profit >= 0 ? 'profit' : 'loss'}${partial}` }));
    } else {
      const profitY = y(profit); group.append(svgEl('rect', { x: center - profitWidth / 2, y: Math.min(zeroY, profitY), width: profitWidth, height: Math.max(2, Math.abs(zeroY - profitY)), rx: 3, class: `chart-bar ${profit >= 0 ? 'profit' : 'loss'}${partial}` }));
      {const value=svgEl('text',{x:center,y:profit>=0?profitY-7:profitY+13,class:`daily-bar-value ${profit>=0?'positive':'negative'}`,'text-anchor':'middle'});value.textContent=`${profit>=0?'+':''}${Math.round(profit)}€`;group.append(value);}
    }
    svg.append(group);
    const label = svgEl('text', { x: center, y: height - 16, class: 'chart-day-label', 'text-anchor': 'middle' }); label.textContent = Number(row.day.slice(-2)); svg.append(label);
    if (row.closeStatus === 'CURRENT_PARTIAL') { const partialLabel = svgEl('text', { x: center, y: height - 5, class: 'chart-partial-label', 'text-anchor': 'middle' }); partialLabel.textContent = 'PARCIAL'; svg.append(partialLabel); }
  });
  const legend = node('div', 'chart-legend'); const series = mode === 'pnl' ? [['revenue', 'Facturación'], ['costs', 'Costes'], ['profit', 'Beneficio']] : [['profit', 'Beneficio diario'], ['loss', 'Pérdida diaria']]; series.forEach(([tone, label]) => { const item = node('span'); item.append(node('i', tone), document.createTextNode(label)); legend.append(item); });
  const summary=node('div','daily-performance-summary'); const completeRows=rows.filter(row=>row.netProfit!==null&&row.netProfit!==undefined);
  [['Días con ganancia',completeRows.filter(r=>r.netProfit>0).length,'positive'],['Días con pérdida',completeRows.filter(r=>r.netProfit<0).length,'negative'],['Sin datos completos',rows.length-completeRows.length,'pending']].forEach(([label,value,tone])=>{const box=node('div',tone);box.append(node('strong','',String(value)),node('span','',label));summary.append(box);});
  const calendar=node('div','daily-result-calendar'); calendar.setAttribute('aria-label','Resultado de todos los días por fecha de compra');
  rows.forEach(row=>{const missing=row.netProfit===null||row.netProfit===undefined;const button=node('button',`daily-result-day ${missing?'pending':Number(row.netProfit)>=0?'positive':'negative'}`);button.type='button';button.append(node('span','',`Día ${Number(row.day.slice(-2))}`),node('strong','',money(row.netProfit,currency)));button.setAttribute('aria-label',`${date(row.day,true)} · ${money(row.netProfit,currency)} · ver desglose`);button.addEventListener('click',()=>selectDay(row));buttons.push([row.day,button]);calendar.append(button);});
  selectDay(rows.find(row=>row.day===state.financeSelectedDay)||rows.at(-1));
  const viewport=node('div','daily-chart-viewport');svg.style.minWidth=`${width}px`;viewport.append(svg);
  root.append(summary,viewport,legend,node('p','chart-instruction','Cada barra y tarjeta corresponde a los pedidos comprados ese día. Selecciona cualquier día para ver sus ingresos y todos sus costes.'),calendar,detail); return root;
}
function donutChart(value, centerLabel, rows, tone = 'green') {
  const root = node('div', 'donut-layout'); const donut = node('div', `result-donut ${tone}`); const palette = { green: '#17a874', blue: '#1478ed', red: '#f04f72', gray: '#a9b6c2' }; const total = rows.reduce((sum, row) => sum + Number(row[1] || 0), 0); let angle = 0; const stops = rows.map(([, count, color]) => { const start = angle; angle += total ? Number(count || 0) * 360 / total : 0; return `${palette[color] || palette.gray} ${start}deg ${angle}deg`; }); donut.style.background = `conic-gradient(${stops.join(',') || '#e8eff5 0deg 360deg'})`;
  const center = node('div', 'donut-center'); center.append(node('strong', '', percentNumber(value)), node('small', '', centerLabel)); donut.append(center);
  const legend = node('div', 'donut-legend'); rows.forEach(([label, count, color]) => { const item = node('div'); const lead = node('span'); lead.append(node('i', color), document.createTextNode(label)); item.append(lead, node('strong', '', number(count))); legend.append(item); });
  root.append(donut, legend); return root;
}
function monthlyHistoryChart(history, currency) {
  const rows = (history || []).slice(-state.financeHistoryWindow).map(row=>row.temporalModels?.pnl==='REALIZED_EVENT_DATE'?{...row,totals:Object.fromEntries(Object.keys(row.totals||{}).map(k=>[k,null])),dataAvailability:{status:'PARTIAL_SOURCE',label:'Informe por fecha de compra no disponible'}}:row); const root = node('div', 'monthly-history');
  if (!rows.length) return stacked('Sin histórico', 'Aún no hay meses anteriores disponibles.');
  const width = 380; const height = 176; const left = 28; const right = 28; const top = 25; const bottom = 30; const plotHeight = height - top - bottom; const plotWidth = width - left - right; const profits = rows.map((row) => row.totals?.exactNetProfit).filter(v=>v!==null&&v!==undefined).map(Number); const scale = niceMoneyScale(profits, 3); const range = Math.max(1, scale.maximum - scale.minimum); const y = (value) => top + (scale.maximum - Number(value || 0)) / range * plotHeight; const zeroY = y(0); const marginY = (value) => top + (100 - clamp(value, -100, 100)) / 200 * plotHeight; const groupWidth = plotWidth / rows.length; const barWidth = Math.max(10, Math.min(28, groupWidth * .48)); const x = (index) => left + (index + .5) * groupWidth;
  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'Beneficio neto mensual y margen neto porcentual' }); svg.append(svgEl('line', { x1: left, y1: zeroY, x2: width - right, y2: zeroY, class: 'chart-zero-line' }));
  rows.forEach((row, index) => {
    const center = x(index); const month = row.month || row.period?.month; const missing=row.totals?.exactNetProfit===null||row.totals?.exactNetProfit===undefined;const profitValue = missing?null:Number(row.totals.exactNetProfit); const profitY = y(profitValue); const partial = row.dataAvailability?.status === 'PARTIAL_SOURCE' || row.period?.current; const titleText = [monthLabel(month), `Facturación ${money(row.totals?.realRevenue, currency)}`, `Costes ${money(row.totals?.totalCosts, currency)}`, `Beneficio ${money(profitValue, currency)}`, `Margen ${percentNumber(row.totals?.marginPercent)}`, `Publicidad ${money(row.totals?.metaSpend, currency)}`, `ROAS ${Number(row.totals?.roas) ? `${Number(row.totals.roas).toFixed(2)}x` : '—'}`, `Entregados ${row.counts?.delivered===null||row.counts?.delivered===undefined?'—':number(row.counts.delivered)}`, `Devueltos ${row.counts?.returned===null||row.counts?.returned===undefined?'—':number(row.counts.returned)}`, row.dataAvailability?.label || row.statusLabel || 'Mes completo'].join(' · ');
    const bar = appendSvgTitle(svgEl('rect', { x: center - barWidth / 2, y: missing?zeroY-3:Math.min(zeroY, profitY), width: barWidth, height: missing?6:Math.max(2, Math.abs(zeroY - profitY)), rx: 3, class: missing?'chart-missing-bar':`chart-bar ${profitValue >= 0 ? 'profit' : 'loss'}${partial ? ' partial-month' : ''}`, tabindex: 0, role: 'button', 'aria-label': `Abrir ${monthLabel(month)}` }), titleText); bar.addEventListener('click', () => { $('finance-month').value = month; loadResultsFinance(); }); svg.append(bar);
    const valueLabel = svgEl('text', { x: center, y: missing?zeroY-8:profitValue >= 0 ? Math.max(10, profitY - 5) : Math.min(height - bottom - 2, profitY + Math.abs(zeroY - profitY) + 11), class: 'chart-value-label', 'text-anchor': 'middle' }); valueLabel.textContent = missing?'Sin datos':`${profitValue >= 0 ? '+' : ''}${Math.round(profitValue)} €`; svg.append(valueLabel);
    const label = svgEl('text', { x: center, y: height - 7, class: 'chart-day-label', 'text-anchor': 'middle' }); label.textContent = monthLabel(row.month || row.period?.month).split(' ')[0].slice(0, 3); svg.append(label);
  });
  let segment=[];const flush=()=>{if(segment.length)svg.append(svgEl('polyline',{points:segment.join(' '),class:'chart-margin-line',fill:'none'}));segment=[];};
  rows.forEach((row,index)=>{const margin=row.totals?.marginPercent;if(margin===null||margin===undefined){flush();return;}segment.push(`${x(index)},${marginY(margin)}`);svg.append(appendSvgTitle(svgEl('circle',{cx:x(index),cy:marginY(margin),r:2.7,class:'chart-margin-point'}),`${monthLabel(row.month||row.period?.month)} · Margen ${percentNumber(margin)}`));});flush();
  const legend = node('div', 'chart-legend'); [['profit', 'Beneficio'], ['loss', 'Pérdida'], ['margin', 'Margen neto %'], ['partial', 'Mes parcial']].forEach(([tone, label]) => { const item = node('span'); item.append(node('i', tone), document.createTextNode(label)); legend.append(item); }); root.append(svg, legend); return root;
}
function monthlyReturnRateChart(data) {
  const counts=data.counts || {};const sent=counts.sent;const returned=counts.returned;
  const root=node('div','selected-month-return');root.append(node('p','return-month-label',monthLabel(data.period?.month)));
  if(sent===null||sent===undefined||returned===null||returned===undefined||Number(sent)===0){root.append(stacked('Tasa no disponible','No hay pedidos enviados verificados en el mes seleccionado.'));return root;}
  root.append(donutChart(Number(returned)*100/Number(sent),'Devueltos',[
    ['Devueltos',returned,'red'],['Entregados',counts.delivered,'green'],['En tránsito',counts.inTransit,'blue'],['Incidencia / otro',counts.otherOutcome ?? Math.max(0,Number(sent)-Number(returned)-Number(counts.delivered||0)-Number(counts.inTransit||0)),'gray']
  ],'red'),node('p','return-rate-description',`${number(returned)} devueltos de ${number(sent)} enviados · pedidos comprados en este mes`));return root;
}
function costBreakdown(totals, currency) {
  const logistics = ['outboundShippingCost', 'outboundFulfillmentCost', 'codCost', 'returnCost', 'dropeaAdjustmentsCost'].reduce((sum, key) => sum + Number(totals[key] || 0), 0);
  const fixed = ['fixedCosts', 'oneOffCosts', 'otherCosts'].reduce((sum, key) => sum + Number(totals[key] || 0), 0);
  const rows = [['Producto', Number(totals.productCost || 0), 'product'], ['Logística', logistics, 'logistics'], ['Publicidad Meta', Number(totals.metaSpend || 0), 'advertising'], ['Fijos y puntuales', fixed, 'fixed']];
  const total = Number(totals.totalCosts || rows.reduce((sum, item) => sum + item[1], 0)); const root = node('div', 'cost-breakdown'); const track = node('div', 'cost-breakdown-track');
  rows.forEach(([label, value, tone]) => { const segment = node('span', tone); segment.style.width = `${total ? value * 100 / total : 0}%`; segment.title = `${label}: ${money(value, currency)}`; track.append(segment); });
  const legend = node('div', 'cost-breakdown-legend'); rows.forEach(([label, value, tone]) => { const item = node('div'); const labelBox = node('span'); labelBox.append(node('i', tone), document.createTextNode(label)); item.append(labelBox, node('strong', '', money(value, currency)), node('small', '', total ? percentNumber(value * 100 / total) : '0 %')); legend.append(item); });
  root.append(track, legend); return root;
}
function operationalSummary(counts) {
  const root = node('div', 'insight-stat-grid'); const rows = [['Pedidos creados', counts.created, 'blue'], ['Entregados', counts.delivered, 'green'], ['En tránsito', counts.inTransit, 'sky'], ['Devueltos', counts.returned, 'red']];
  rows.forEach(([label, value, tone]) => { const item = node('div', `insight-stat ${tone}`); item.append(node('span', '', label), node('strong', '', number(value))); root.append(item); }); return root;
}
function dataQualitySummary(data) {
  const controls = Object.values(data.controls || {}); const passed = controls.filter(Boolean).length; const total = controls.length; const coverage = clamp(data.coverage?.dropeaBreakdownPercent); const root = node('div', 'quality-summary'); const score = node('div', 'quality-score'); score.style.setProperty('--quality-angle', `${coverage * 3.6}deg`); score.append(node('strong', '', `${number(coverage)} %`));
  const copy = node('div', 'quality-copy'); copy.append(node('strong', '', data.quality?.status === 'OK' ? 'Datos conciliados' : 'Revisión necesaria'), node('span', '', `${passed} de ${total} controles superados`), node('small', '', `${number(data.quality?.issues?.length)} incidencia(s) de calidad · ${number(data.coverage?.dropeaBreakdownPercent)} % con desglose final de Dropea`)); root.append(score, copy); return root;
}
function dailyTable(data, currency) {
  const totals = data.totals || {}; const table = node('table', 'results-daily-table');
  const columns = [
    ['Fecha', 'day'], ['Creados', 'created'], ['Entregados', 'delivered'], ['Devueltos', 'returned'], ['Facturación', 'realRevenue'],
    ['Producto', 'productCost'], ['Envío', 'outboundShippingCost'], ['Fulfillment', 'outboundFulfillmentCost'], ['COD', 'codCost'],
    ['Devoluciones', 'returnCost'], ['Ajustes / IVA Dropea', 'dropeaAdjustmentsCost'], ['Meta Ads', 'metaSpend'],
    ['Fijos', 'fixedCosts'], ['Puntuales', 'oneOffCosts'], ['Otros', 'otherCosts'],
    ['Costes totales', 'totalCosts'], ['Beneficio neto', 'netProfit'], ['Margen', 'marginPercent'], ['ROI', 'roiPercent'], ['ROAS', 'roas']
  ];
  const head = node('thead'); const headRow = node('tr'); columns.forEach(([label]) => headRow.append(node('th', '', label))); head.append(headRow);
  const body = node('tbody');
  const cellValue = (row, key) => {
    if (key === 'day') return date(row.day, true);
    if (['created', 'delivered', 'returned'].includes(key)) return row[key]===null||row[key]===undefined?'—':number(row[key]);
    if (['marginPercent', 'roiPercent'].includes(key)) return percentNumber(row[key]);
    if (key === 'roas') return Number(row[key]) ? `${Number(row[key]).toFixed(2)}x` : '—';
    return money(row[key], currency);
  };
  (data.days || []).slice().reverse().forEach((row) => { const tr = node('tr', Number(row.netProfit || 0) < 0 ? 'loss-row' : 'profit-row'); columns.forEach(([, key]) => { const td = node('td', key === 'netProfit' ? 'daily-net-cell' : '', cellValue(row, key)); tr.append(td); }); body.append(tr); });
  const totalRow = {
    day: 'TOTAL', created: data.counts?.created,
    delivered: data.counts?.delivered,
    returned: data.counts?.returned,
    ...totals, netProfit: totals.exactNetProfit
  };
  const foot = node('tfoot'); const tr = node('tr'); columns.forEach(([, key]) => { const td = node('td', key === 'netProfit' ? 'daily-net-cell' : '', key === 'day' ? (data.dailyBasis==='settlement'?'TOTAL · LIQUIDACIONES':'TOTAL DEL MES') : cellValue(totalRow, key)); tr.append(td); }); foot.append(tr); table.append(head, body, foot);
  const wrap = node('div', 'results-table-scroll'); wrap.append(table); return wrap;
}
function closeResultExpenseForm() { $('finance-fixed-form').hidden = true; $('finance-fixed-form').reset(); $('finance-fixed-feedback').textContent = ''; }
function openResultExpenseForm() { const form = $('finance-fixed-form'); form.hidden = false; form.reset(); const month = state.finance?.period?.month || new Date().toISOString().slice(0, 7); $('finance-fixed-start').value = `${month}-01`; $('finance-fixed-feedback').textContent = 'Se incorporará al mes y al histórico diario después de guardarlo.'; $('finance-fixed-label').focus(); }
function renderResultExpenses(data, currency) {
  const items = data.expenseLedger || []; const root = $('finance-fixed-expenses');
  if (!items.length) { root.replaceChildren(stacked('Sin gastos mensuales', 'Añade un gasto recurrente o puntual para incluirlo en el resultado.')); return; }
  const table = node('table', 'expense-results-table'); const head = node('thead'); const hr = node('tr'); ['Gasto', 'Tipo', 'Categoría', 'Importe', 'Aplicado al mes', 'Desde', 'Hasta'].forEach((label) => hr.append(node('th', '', label))); head.append(hr); const body = node('tbody');
  items.forEach((item) => { const row = node('tr'); [item.name, item.type === 'one_off' ? 'Puntual' : 'Recurrente', item.category || 'Otros', money(item.amount, currency), money(item.appliedAmount, currency), date(item.startDate || item.date, true), item.endDate ? date(item.endDate, true) : 'Sin fecha fin'].forEach((value) => row.append(node('td', '', value))); body.append(row); });
  table.append(head, body); const wrap = node('div', 'results-table-scroll'); wrap.append(table); root.replaceChildren(wrap);
}
async function saveResultExpense(event) {
  event.preventDefault(); const submit = $('finance-fixed-form').querySelector('button[type="submit"]'); submit.disabled = true; $('finance-fixed-feedback').textContent = 'Guardando y recalculando…';
  const body = { name: $('finance-fixed-label').value, category: $('finance-fixed-category').value, type: $('finance-fixed-type').value, amount: $('finance-fixed-amount').value, startDate: $('finance-fixed-start').value, endDate: $('finance-fixed-end').value || null };
  try { await api('/api/operations/finance/fixed-expenses', { method: 'POST', body }); state.financeCache.clear(); closeResultExpenseForm(); await loadResultsFinance({ force: true }); showNotice('Gasto guardado y resultado mensual recalculado.'); } catch (error) { $('finance-fixed-feedback').textContent = error.message; } finally { submit.disabled = false; }
}
function renderResultsFinance() {
  const sourceData = state.finance; if (!sourceData) return;
  // Never relabel an event-date outage fallback as purchase-cohort profit.
  const wrongBasis=sourceData.temporalModels?.pnl==='REALIZED_EVENT_DATE';
  const data=wrongBasis?{...sourceData,days:[],history:[],totals:Object.fromEntries(Object.keys(sourceData.totals||{}).map(k=>[k,null])),quality:{status:'REVIEW',issues:['PURCHASE_COHORT_UNAVAILABLE']},controls:{...sourceData.controls,purchaseCohortAvailable:false},warnings:['Informe por fecha de compra no disponible. No se sustituyen sus importes por liquidaciones de otros meses.']}:sourceData;
  const totals = data.totals || {}; const counts = data.counts || {}; const currency = data.currency || 'EUR';
  $('last-sync').textContent = date(data.generatedAt); const current = data.period?.current;
  const closedThrough = data.accounting?.closedThrough; const pendingDays = number(data.accounting?.pendingDays);
  const accountingLabel = current
    ? closedThrough
      ? `Parcial · cierre contable hasta ${date(closedThrough, true)}${pendingDays ? ` · ${pendingDays} día(s) pendiente(s)` : ' · día actual parcial'}`
      : `Cohorte actualizada hasta ${date(data.accounting?.observedThrough || data.period?.until,true)} · hoy parcial`
    : `Estado actual del mes${Number(data.accounting?.unsettledOrders || 0)>0?` · ${number(data.accounting.unsettledOrders)} pedidos sin resultado final`:''}`;
  $('finance-exactness').textContent = `${accountingLabel}${data.quality?.status === 'OK'?'':` · Revisión de datos: ${number(data.quality?.issues?.length)} aviso(s)`}`;
  const days = (data.days || []).filter((row) => row.day);
  const availability = current ? `${data.dataAvailability?.label || `MTD · día ${data.period.elapsedDays}`} · ${accountingLabel}`
    : (data.dataAvailability?.label || 'Mes completo');
  const freshness = data.freshness?.sources || {}; $('finance-freshness').replaceChildren(...[['Dropea', freshness.dropea], ['Meta', freshness.meta], ['Informe', freshness.report]].map(([label, source]) => { const status = source?.status || 'UNAVAILABLE'; const item = node('span', status === 'OK' ? 'is-fresh' : status === 'STALE' ? 'is-stale' : 'is-neutral'); const timing = source?.ageMinutes === null || source?.ageMinutes === undefined ? 'sin marca de tiempo' : `hace ${number(source.ageMinutes)} min`; item.textContent = `${label} · ${timing}${status==='STALE'?' · pendiente de actualizar':''}`; return item; }));
  const fullyReconciled = !current && Number(data.accounting?.unsettledOrders || 0)===0 && data.quality?.status === 'OK' && Number(data.coverage?.dropeaBreakdownPercent) === 100 && totals.exactNetProfit !== null && totals.exactNetProfit !== undefined;
  $('finance-hero').replaceChildren(
    resultMetric(fullyReconciled ? 'Beneficio mensual conciliado' : 'Beneficio mensual provisional', money(totals.exactNetProfit, currency), `Pedidos creados en el mes · ${availability} · ${comparisonText('exactNetProfit')}`, Number(totals.exactNetProfit || 0) >= 0 ? 'profit' : 'loss', 'profit', days.map((row) => row.netProfit)),
    resultMetric('Facturación', money(totals.realRevenue, currency), comparisonText('realRevenue'), 'revenue', 'revenue', days.map((row) => row.realRevenue)),
    resultMetric('Costes totales', money(totals.totalCosts, currency), comparisonText('totalCosts'), 'costs', 'costs', days.map((row) => row.totalCosts)),
    resultMetric('ROI', percentNumber(totals.roiPercent), comparisonText('roiPercent', 'points'), 'roi', 'roi', days.map((row) => row.roiPercent)),
    resultMetric('ROAS', totals.roas === null || totals.roas === undefined ? '—' : `${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(totals.roas)}x`, comparisonText('roas', 'multiplier'), 'roas', 'roas', days.map((row) => Number(row.metaSpend || 0) > 0 ? Number(row.realRevenue || 0) / Number(row.metaSpend) : 0)),
    resultMetric('Margen neto', percentNumber(totals.marginPercent), comparisonText('marginPercent', 'points'), 'margin', 'margin', days.map((row) => row.marginPercent)),
    resultMetric('Tasa de entrega', percentNumber(counts.deliveryRatePercent), `${comparisonText('deliveryRatePercent', 'points')} · ${percentNumber(counts.deliveryRateCreatedPercent)} sobre creados`, 'margin', 'delivery', []),
    resultMetric('Entregados', number(counts.delivered), 'Pedidos creados en el mes con entrega verificada en Dropea', 'profit', 'delivered', days.map((row) => row.delivered)),
    resultMetric('Devueltos', number(counts.returned), 'Pedidos creados en el mes devueltos; coste real por pedido', 'loss', 'returns', days.map((row) => row.returned)),
    resultMetric('En tránsito', number(counts.inTransit ?? counts.inAir), 'Enviados sin entrega ni devolución; no incluye incidencias', 'revenue', 'transit', [])
  );
  const daily=selectedDailyView(data);
  $('finance-daily-model').textContent='Por fecha de compra: entregados y devueltos son el resultado actual de los pedidos comprados ese día. Ingresos solo de entregados; costes de pedidos pendientes ya reconocidos también se restan. El mes en curso es provisional. Los fijos incluyen el compromiso mensual completo, repartido entre los días observados.';
  $('finance-trend').replaceChildren(dailyResultsChart(daily.days, currency));
  $('finance-delivery-chart').replaceChildren(donutChart(counts.deliveryRatePercent, 'Entregados', [['Entregados', counts.delivered, 'green'], ['En tránsito', counts.inTransit, 'blue'], ['Devueltos', counts.returned, 'red'], ['Incidencia / otro', counts.otherOutcome, 'gray']], 'green'));
  $('finance-confirmation-chart').replaceChildren(donutChart(counts.confirmationRatePercent, 'Confirmados', [['Confirmados', counts.confirmed, 'blue'], ['No confirmados todavía', counts.pendingConfirmation, 'gray'], ['Cancelados antes de confirmar', counts.cancelledBeforeConfirmation, 'red']], 'blue'));
  $('finance-history-chart').replaceChildren(monthlyHistoryChart(data.history, currency)); $('finance-return-rates').replaceChildren(monthlyReturnRateChart(data));
  for (const [id,kind] of [['finance-daily-title','profit'],['finance-delivery-title','delivery'],['finance-confirmation-title','confirmation'],['finance-history-title','history'],['finance-return-title','returns']]) {const title=$(id);const label=title.textContent;title.replaceChildren(financeIcon(kind),document.createTextNode(label));}
  $('finance-operational-summary').replaceChildren(operationalSummary(counts)); $('finance-data-summary').replaceChildren(dataQualitySummary(data));
  $('finance-cost-total').textContent = `Costes totales ${money(totals.totalCosts, currency)}`; $('finance-costs').replaceChildren(costBreakdown(totals, currency)); $('finance-daily').replaceChildren(dailyTable(daily, currency));
  $('finance-daily-caption').textContent='Fecha de compra del pedido (Europe/Madrid). Entregados/devueltos muestran su estado actual en Dropea, no entregas ocurridas ese día. TOTAL DEL MES usa la misma cohorte, costes y beneficio que el resumen superior. Los fijos incluyen el cargo mensual completo.';
  $('finance-quality').replaceChildren(
    stacked('Modelo temporal', 'P&L y embudo por cohorte de creación · resultado final actual de Dropea'),
    stacked('Fuente de pedidos y costes', data.sources?.orders || 'Dropea Public API V2'),
    stacked('Fórmula', data.definitions?.netProfit || 'Facturación real − costes de Dropea − Meta − gastos mensuales'),
    stacked('Coste de devolución', data.definitions?.returnCost || 'Coste real del pedido; respaldo de 5,26 € por pedido devuelto'),
    stacked('IVA', data.definitions?.vat || 'IVA y recargo aplicables por pedido incluidos en los gastos finales de Dropea y en Ajustes / IVA; no se añade un porcentaje general ni se cobran dos veces. La columna también incluye otros ajustes.'),
    stacked('Cobertura Dropea final', `${number(data.coverage?.dropeaBreakdownPercent)} %`),
    ...((data.warnings || []).slice(0, 8).map((warning) => stacked('Aviso de calidad', warning)))
  );
  $('finance-audit').replaceChildren(...Object.entries(data.controls || {}).map(([key, value]) => { const row = node('div', `audit-check ${value ? 'pass' : 'fail'}`); row.append(badge(value ? 'OK' : 'REVISAR'), node('span', '', key.replaceAll('_', ' ').replace(/([A-Z])/g, ' $1').toLowerCase())); return row; }));
  renderResultExpenses(data, currency);
  if(typeof renderResultsDashboard==='function')renderResultsDashboard(data);
}
function applyResultsFinance(data, selected, loadedAt = Date.now()) {
  state.finance = data; state.financeLoadedAt = loadedAt; const select = $('finance-month'); const months = data.availableMonths?.length ? data.availableMonths : [data.period?.month || selected]; state.financeMonths = months;
  const currentOptions = [...select.options].map((option) => option.value); if (currentOptions.join('|') !== months.join('|')) select.replaceChildren(...months.map((month) => { const option = node('option', '', monthLabel(month)); option.value = month; return option; }));
  select.value = data.period?.month || selected; updateFinanceMonthNavigation(); renderResultsFinance();
}
async function loadResultsFinance({ force = false, background = false } = {}) {
  const selected = $('finance-month').value || new Date().toISOString().slice(0, 7);
  const ttl = Number(state.config?.finance_refresh_interval_seconds || 120) * 1000; const cached = state.financeCache.get(selected);
  if (!force && cached && Date.now() - cached.at < ttl) { applyResultsFinance(cached.data, selected, cached.at); return; }
  const request = ++state.financeRequest; state.financeController?.abort(); const controller = new AbortController(); state.financeController = controller;
  if (!background) showNotice('');
  try {
    const data = await api(`/api/operations/finance?month=${encodeURIComponent(selected)}`, { signal: controller.signal });
    if (request !== state.financeRequest) return; const at = Date.now(); state.financeCache.set(selected, { at, data }); applyResultsFinance(data, selected, at); showNotice('');
  } catch (error) {
    if (controller.signal.aborted || request !== state.financeRequest) return;
    if (cached) { applyResultsFinance(cached.data, selected, cached.at); showNotice('No se pudo actualizar ahora. Se mantiene el último informe cargado.'); }
    else showNotice('No se pudo cargar el informe financiero. Reintentaremos automáticamente; también puedes pulsar Actualizar.');
  } finally { if (request === state.financeRequest) state.financeController = null; }
}
async function refresh({ force = false, background = false } = {}) {
  if (state.refreshing) return; state.refreshing = true; $('refresh-button').disabled = true; $('refresh-button').textContent = 'Actualizando…';
  try {
    if (state.view === 'finance') await loadResultsFinance({ force, background });
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
  $('app').setAttribute('data-view',view);
  if(view==='incidents'){state.limit=10;$('page-size').value='10';}
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
  const titles = { orders: 'Pedidos operativos', incidents: 'Panel de incidencias', finance: 'Panel de resultados' }; $('view-title').textContent = titles[view];
  const finance = view === 'finance'; $('summary').hidden = finance; $('finance-view').hidden = !finance; $('queue-card').hidden = finance;
  $('recovery-center').hidden=view!=='incidents';
  if (finance) { loadResultsFinance(); return; }
  $('queue-title').textContent = view === 'orders' ? 'Pedidos pendientes en Dropea · señal Chatby por pedido' : 'Cola de recuperación · acción, evidencia y tiempo restante'; renderHead(); renderFilters(); renderSummary(); loadQueue();
}

async function init() {
  state.config = await fetch(`${operationsBase}/api/config`).then((response) => { if (!response.ok) throw new Error('Configuración privada no disponible.'); return response.json(); });
  const params = new URLSearchParams(location.search); state.token = activeToken();
  if (params.has('error')) { history.replaceState({}, document.title, location.pathname); throw new Error('El proveedor de acceso rechazó el inicio de sesión. Inténtalo de nuevo.'); }
  if (params.has('code')) state.token = await exchangeCode(params.get('code'), params.get('state'));
  if (!state.token) { await prepareLogin(); showLoginError(''); $('login').hidden = false; $('app').hidden = true; return; }
  $('login').hidden = true; $('app').hidden = false; renderHead(); renderFilters(); await refresh();
  setInterval(() => {
    if (document.visibilityState !== 'visible' || !activeToken()) return;
    const financeInterval = Number(state.config.finance_refresh_interval_seconds || 120) * 1000;
    if (state.view === 'finance' && Date.now() - state.financeLoadedAt < financeInterval) return;
    refresh({ background: true });
  }, state.config.refresh_interval_seconds * 1000);
}
$('logout-button').addEventListener('click', () => signOut(true)); $('refresh-button').addEventListener('click', () => refresh({ force: true })); $('finance-month').addEventListener('change', () => { updateFinanceMonthNavigation(); loadResultsFinance(); }); $('finance-prev-month').addEventListener('click', () => moveFinanceMonth('older')); $('finance-next-month').addEventListener('click', () => moveFinanceMonth('newer')); $('page-size').addEventListener('change', (event) => { state.limit = Number(event.target.value); state.offset = 0; loadQueue(); }); $('prev-page').addEventListener('click', () => { state.offset = Math.max(0, state.offset - state.limit); loadQueue(); }); $('next-page').addEventListener('click', () => { state.offset += state.limit; loadQueue(); }); document.querySelectorAll('.nav-item').forEach((item) => item.addEventListener('click', () => setView(item.dataset.view))); $('close-drawer').addEventListener('click', closeDetail); $('drawer-backdrop').addEventListener('click', closeDetail); document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeDetail(); });
$('finance-add-fixed').addEventListener('click', () => openResultExpenseForm());
$('finance-fixed-cancel').addEventListener('click', closeResultExpenseForm);
$('finance-fixed-form').addEventListener('submit', saveResultExpense);
$('finance-chart-profit').addEventListener('click', () => { state.financeChartMode = 'profit'; $('finance-chart-profit').classList.add('is-active'); $('finance-chart-pnl').classList.remove('is-active'); if (state.finance) $('finance-trend').replaceChildren(dailyResultsChart(selectedDailyView(state.finance).days, state.finance.currency || 'EUR')); });
$('finance-chart-pnl').addEventListener('click', () => { state.financeChartMode = 'pnl'; $('finance-chart-pnl').classList.add('is-active'); $('finance-chart-profit').classList.remove('is-active'); if (state.finance) $('finance-trend').replaceChildren(dailyResultsChart(selectedDailyView(state.finance).days, state.finance.currency || 'EUR')); });
$('finance-history-window').addEventListener('change', (event) => { state.financeHistoryWindow = Number(event.target.value) || 6; if (state.finance) $('finance-history-chart').replaceChildren(monthlyHistoryChart(state.finance.history, state.finance.currency || 'EUR')); });
init().catch(async (error) => { $('login').hidden = false; $('app').hidden = true; try { if (state.config) await prepareLogin(); } catch {} showLoginError(error.message); });
