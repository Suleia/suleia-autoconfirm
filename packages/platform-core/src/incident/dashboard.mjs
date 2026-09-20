import { buildRecoveryOverview, recoveryProjection } from './recovery-center.mjs';

export const DASHBOARD_VERSION = 'INCIDENT_DASHBOARD_V2';
export const DASHBOARD_METRICS = [
  ['PENDING','Pendientes actuales','package'], ['HUMAN_REVIEW','Revisión humana','search'],
  ['WAITING_CUSTOMER','Esperando cliente','message'], ['SIMULATION_READY','Simulación preparada','check'],
  ['STALE','Datos atrasados','warning'], ['RECOVERABLE','Recuperables','retry']
];
const validTemplate = value => /^[a-z][a-z0-9_]{2,159}$/.test(value || '') ? value : null;
const time = value => value ? new Date(value).getTime() : NaN;

// Presentation only: never changes provider state, policies or executable decisions.
export function dashboardProjection(raw, { now = new Date() } = {}) {
  const aliases = { REFUSED:'REFUSED_BY_RECIPIENT', REJECTED_BY_RECIPIENT:'REFUSED_BY_RECIPIENT' };
  const type = aliases[raw.raw_type] || aliases[raw.interpreted_type] || raw.interpreted_type || raw.raw_type || 'UNKNOWN';
  const item = recoveryProjection({...raw, interpreted_type:type,
    incident_notification_template:validTemplate(raw.incident_notification_template)}, {now});
  const r = item.recovery, e = r.evidence, s = item.absent_shadow || {};
  const pending = item.status === 'PENDING' && item.is_active === true;
  const source = item.dashboard_source_context || {};
  const followup = pending && (type === 'PICKUP_AT_AGENCY'
    || type === 'RECIPIENT_ABSENT' && source.is_first_absent === true);
  const stale = item.dropea_sync_current !== true || item.chatby_sync_current !== true
    || ['STALE','UNKNOWN','NOT_VERIFIABLE'].includes(item.effective_freshness_status)
    || item.operational_freshness_status === 'STALE';
  const blocks = [...new Set(item.effective_blocking_reasons || s.blocking_reasons || [])];
  const current = pending && !stale && item.notification_decision_current === true
    && Boolean(item.current_decision_id && item.policy_id && item.policy_version
      && item.policy_snapshot_hash && item.input_snapshot_hash)
    && (item.decision_record_status === 'PERSISTED' || item.snapshot_status === 'PERSISTED')
    && (!s.input_snapshot_hash || s.input_snapshot_hash === item.input_snapshot_hash);
  const ready = current && blocks.length === 0
    && (item.effective_decision_status === 'SIMULATION_READY' || s.simulation_status === 'SIMULATION_READY');
  const waiting = pending && !stale && !e.valid_response && e.no_action_verified
    && r.timer.state === 'ACTIVE' && r.flags.WAITING_CUSTOMER === true;
  const human = pending && (stale || !current || blocks.length > 0 || item.autopilot.human_review);
  let action = item.tailored_recommendation?.title || 'Revisar incidencia';
  let actionDetail = item.tailored_recommendation?.summary || '';
  const waitCode = /WAIT.*TIMER|WAIT_EXISTING|WAIT_DISCOUNT/.test(item.tailored_recommendation?.code || '');
  if (waitCode && r.timer.state !== 'ACTIVE') {
    action = r.timer.state === 'EXPIRED' ? 'Reevaluar el plazo vencido' : 'Verificar el plazo de respuesta';
    actionDetail = r.timer.state === 'EXPIRED' ? 'Releer la conversación antes de decidir' : 'No existe un temporizador activo verificable';
    blocks.push(r.timer.state === 'EXPIRED' ? 'TIMER_EXPIRED' : 'TIMER_NOT_MATERIALIZED');
  }
  if (!pending) { action = 'Consultar historial'; actionDetail = 'Fuera de la cola actual; sin siguiente acción vigente'; }
  else if (stale) { action = 'Actualizar evidencia'; actionDetail = 'Revalidar fuentes antes de usar la recomendación'; }
  const urgent = pending && r.timer.state === 'EXPIRED';
  const near = pending && r.timer.state === 'ACTIVE' && r.timer.remaining_seconds <= 10800;
  const priority = urgent ? 1 : near ? 2 : e.valid_response && pending ? 3 : human ? 4 : waiting ? 5 : 6;
  const reasons = {1:'Plazo real vencido',2:'Plazo real inferior a tres horas',3:'Respuesta válida pendiente de revisión',4:'Validación humana o de fuentes necesaria',5:'Espera con temporizador activo',6:'Sin urgencia temporal verificada'};
  const flags = {PENDING:pending && !followup,OPEN:pending,FOLLOWUP:followup,HUMAN_REVIEW:human,WAITING_CUSTOMER:waiting,SIMULATION_READY:ready,STALE:stale,RECOVERABLE:pending && !stale && r.flags.RECOVERABLE_NOW};
  return {...item,customer_name:(item.customer_name || '').replace(/\s+-\s*$/,'').trim(),
    dashboard:{version:DASHBOARD_VERSION,flags,action,action_detail:actionDetail,priority,priority_reason:reasons[priority],
      decision_current:current,blocking_reasons:[...new Set(blocks)],template_name:validTemplate(e.template),
      attempt:type==='RECIPIENT_ABSENT' ? source.is_first_absent===true?'FIRST_ABSENCE':source.absence_count>=2?'SECOND_ABSENCE':s.absence_attempt || 'ABSENCE_ATTEMPT_UNKNOWN':null,
      flow:waiting?'WAITING_CUSTOMER':e.valid_response?'CUSTOMER_RESPONDED':ready?'SIMULATION_READY':human?'HUMAN_REVIEW':'REVIEW',
      freshness:stale?'STALE':'FRESH',executable:false}};
}

export function dashboardSelector(item, filters = {}) {
  const d=item.dashboard, r=item.recovery;
  if (filters.active && item.is_active!==(filters.active==='true')) return false;
  if (filters.discount_response && item.discount_recovery_response_status!==filters.discount_response) return false;
  if (filters.recovery && !r.flags[filters.recovery]) return false;
  if (filters.metric && !d.flags[filters.metric]) return false;
  if (filters.type && item.interpreted_type!==filters.type) return false;
  if (filters.response && r.evidence.display_status!==filters.response) return false;
  if (filters.automation && !d.flags[filters.automation]) return false;
  if (filters.attempt && d.attempt!==filters.attempt) return false;
  if (filters.flow && d.flow!==filters.flow) return false;
  if (filters.risk && (/^[1-6]$/.test(filters.risk)?String(d.priority)!==String(filters.risk):item.effective_risk!==filters.risk)) return false;
  if (filters.template && d.template_name!==filters.template) return false;
  if (filters.timer && r.timer.state!==filters.timer) return false;
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(item.created_at));
  if (filters.month && date.slice(0,7)!==filters.month || filters.from && date<filters.from || filters.to && date>filters.to) return false;
  const q=String(filters.q || '').trim().toLocaleLowerCase('es');
  if(q && ![item.canonical_issue_id,item.dropea_issue_id,item.canonical_order_id,item.dropea_order_id,item.external_order_reference,item.customer_name]
    .some(value=>String(value || '').toLocaleLowerCase('es').includes(q))) return false;
  return true;
}

export function buildIncidentDashboard(items, options = {}) {
  const {filters={}, now=new Date(), limit=10, offset=0}=options;
  const scope=['HISTORICAL','FOLLOWUP','ALL'].includes(filters.scope)?filters.scope:'ACTIVE';
  const projected=items.map(item=>dashboardProjection(item,{now}));
  const population=projected.filter(item=>scope==='ALL'?true:scope==='ACTIVE'?item.dashboard.flags.PENDING:scope==='FOLLOWUP'?item.dashboard.flags.FOLLOWUP:!item.dashboard.flags.OPEN);
  const selected=population.filter(item=>dashboardSelector(item,filters));
  selected.sort((a,b)=>a.dashboard.priority-b.dashboard.priority
    || (time(a.recovery.timer.deadline)||Infinity)-(time(b.recovery.timer.deadline)||Infinity)
    || String(a.canonical_issue_id).localeCompare(String(b.canonical_issue_id)));
  const old=buildRecoveryOverview(selected,{...options,filters:{scope:'ALL'},limit:1,offset:0});
  const group=(key,values)=>values.map(([value,label])=>({value,label,count:selected.filter(i=>dashboardSelector(i,{[key]:value})).length}));
  return {...old,items:selected.slice(offset,offset+limit),total:selected.length,limit,offset,
    summary:{...old.summary,scope,universe_count:selected.length,population_count:population.length,filtered_count:selected.length,
      dashboard:{version:DASHBOARD_VERSION,source:'DROPEA_PUBLIC_API_V2',source_definition:'status=PENDING · is_active=true',
        scope_counts:{ACTIVE:projected.filter(i=>i.dashboard.flags.PENDING).length,FOLLOWUP:projected.filter(i=>i.dashboard.flags.FOLLOWUP).length,HISTORICAL:projected.filter(i=>!i.dashboard.flags.OPEN).length},
        queue_definition:'Pendientes de resolver: abiertas excepto recogida en agencia y primera ausencia observada. Estas permanecen abiertas en Seguimiento.',
        kpis:DASHBOARD_METRICS.map(([key,label,icon])=>({key,label,icon,count:selected.filter(i=>i.dashboard.flags[key]).length})),
        chips:{type:group('type',[['RECIPIENT_ABSENT','Ausente'],['REFUSED_BY_RECIPIENT','Rechazo'],['ADDRESS_INCORRECT','Dirección'],['PENDING_DATA','Faltan datos'],['PICKUP_AT_AGENCY','Agencia'],['UNKNOWN','Otros']]),
          attempt:group('attempt',[['FIRST_ABSENCE','Primera ausencia'],['SECOND_ABSENCE','Segunda ausencia'],['ABSENCE_ATTEMPT_UNKNOWN','Intento no verificable']]),
          flow:group('flow',[['WAITING_CUSTOMER','Esperando cliente'],['CUSTOMER_RESPONDED','Cliente respondió'],['HUMAN_REVIEW','Revisión humana'],['SIMULATION_READY','Simulación preparada']])},
        stale:selected.filter(i=>i.dashboard.flags.STALE).length,
        templates:[...new Set(population.map(i=>i.dashboard.template_name).filter(Boolean))]},
      last_sync_at:options.connectorHealth?.filter(c=>c.connector?.startsWith('DROPEA')).map(c=>c.last_success_at).filter(Boolean).sort().at(-1) || old.summary.last_sync_at}};
}
