const clean=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[¿?¡!]/g,'').trim();
const money=c=>Number.isFinite(c)?(c/100).toLocaleString('es-ES',{style:'currency',currency:'EUR'}):'N/D';
export const AUTOPILOT_REASONS=Object.freeze({
  CANARY_VERIFICATION_PENDING:'primer cambio real pendiente de verificar; las demás acciones esperan',LIVE_REVIEW_REQUIRED:'hay una operación fallida o incierta; se necesita revisión antes de continuar',ROAS_REDUCTIONS_NOT_AUTHORIZED:'reducciones por ROAS desactivadas',
  FUTURE_DAY_METRICS_REQUIRED:'la próxima revisión pertenece a otro día; sus métricas aún no existen',INCREMENTAL_SCOPE_CHANGED:'el tipo de compras o contrato ha cambiado desde la subida anterior',
  GLOBAL_SPEND_LIMIT_NOT_APPROVED:'límite diario de gasto global pendiente de aprobación',ACCOUNT_SPEND_UNVERIFIED:'gasto global del día sin verificar',ACCOUNT_SPEND_LIMIT_REACHED:'gasto global observado en el límite autorizado',GLOBAL_EXPOSURE_UNVERIFIED:'inventario de exposición incompleto',
  OPERATING_MINIMUM_NOT_APPROVED:'mínimo operativo pendiente de aprobación',META_MINIMUM_NOT_VERIFIED:'mínimos de Meta sin verificar',META_MINIMUM_CONFLICT:'el objetivo queda bajo el mínimo de Meta',
  GLOBAL_EXPOSURE_POLICY_NOT_APPROVED:'techo global de exposición pendiente de aprobación',GLOBAL_EXPOSURE_LIMIT:'supera la exposición global autorizada',
  INCREMENTAL_POLICY_NOT_APPROVED:'umbral de compras nuevas pendiente de aprobación',CONVERSIONS_ALREADY_USED:'las compras ya justificaron una subida anterior',ATTRIBUTION_REVISION:'la atribución ha cambiado respecto a la evidencia consumida',
  LEGACY_SAMPLE_MINIMUM:'se conserva el mínimo anterior de cinco compras',MIN_THREE_PURCHASES:'menos de tres compras válidas',REDUCTION_SAMPLE_POLICY_NOT_APPROVED:'falta aprobar la muestra y madurez para reducir',REDUCTION_SAMPLE_INSUFFICIENT:'muestra insuficiente para reducir',
  MAX_CHANGE_PERCENT:'el límite anterior del 10 % bloquea este cambio',CAMPAIGN_COOLDOWN:'se conserva la espera anterior de 24 horas',AGGREGATE_DAILY_LIMIT:'supera el aumento agregado diario autorizado',
  MANUAL_HOLD_UNTIL_NIGHT:'orden manual prioritaria hasta las 22:30',NIGHT_INCREASE_BLOCKED:'no se permiten aumentos nocturnos',NIGHT_CAP:'supera el techo nocturno',
  AUTOPILOT_STALE_OR_WRONG_DAY:'faltan datos actuales del día de Madrid',ROAS_MISSING:'ROAS ausente',ROAS_AMBIGUOUS:'ROAS ambiguo',ROAS_SCOPE_MISMATCH:'ROAS y compras corresponden a eventos distintos',
  MAX_BUDGET:'ya está en el máximo o lo supera',MIN_BUDGET:'inferior al mínimo operativo',INSUFFICIENT_SAMPLE:'muestra insuficiente',ROAS_ZERO_SPEND:'gasto cero',
  AUTOMATION_CONFLICT:'existe una regla automática que puede entrar en conflicto',LEARNING_ACTIVE:'aprendizaje activo',LEARNING_EVIDENCE_NOT_ENABLED:'protección de aprendizaje sin activar',
  LEARNING_EVIDENCE_PREPARING_OR_UNAVAILABLE:'protecciones históricas aún no disponibles',CAMPAIGN_AGE_UNKNOWN_OR_YOUNG:'campaña reciente o edad sin verificar',RECENT_SIGNIFICANT_CHANGE:'cambio reciente aún en observación',INSUFFICIENT_MULTIDAY_SAMPLE:'muestra histórica insuficiente',ROAS_MISSING_OR_AMBIGUOUS:'ROAS histórico ausente o ambiguo',DAILY_CHANGE_LIMIT:'cambios externos del día pendientes de revisión',EXTERNAL_BUDGET_NOT_RECONCILED:'presupuesto externo pendiente de conciliar',VOLATILITY_OR_INCOMPLETE_HISTORY:'historia incompleta o volátil',
  NIGHT_UNKNOWN_ROAS_CONSERVATIVE_CAP:'techo conservador de 20 € por ROAS no fiable; no significa ROAS bajo',AUTOPILOT_HOLD:'mantener según la regla horaria'
});
export function parseAutopilotQuery(input) {
  const t=clean(input);
  if(/^(sube|aumenta|baja|reduce|pon|fija|establece)\b/.test(t))return null;
  if(/que presupuestos tenemos|presupuestos actuales|budget autopilot|estado del autopilot|^autopilot$/.test(t))return {kind:'status'};
  if(/cerca de (?:los )?70/.test(t))return {kind:'near'};
  if(/que campanas han subido.*presupuesto|incrementos.*hoy/.test(t))return {kind:'increases'};
  if(/cuanto presupuesto.*reducido|reducciones.*hoy/.test(t))return {kind:'reductions'};
  let m=/por que no (?:has )?(?:aumentado|subido) (.+?)(?: hoy)?$/.exec(t);
  if(m)return {kind:'why',selector:m[1]};
  m=/(?:muestrame )?(?:el )?historial de (?:modificaciones|presupuestos) (?:de )?(.+)$/.exec(t);
  if(m)return {kind:'history',selector:m[1]};
  return null;
}
export function formatAutopilot(report,query={kind:'status'}) {
  let selected=report.campaigns;
  if(query.selector){selected=selected.filter(c=>c.campaignId===query.selector||clean(c.name).includes(query.selector));if(selected.length!==1)return `Hay ${selected.length} campañas coincidentes. Indica un único ID exacto; no se ha preparado ningún cambio.`;}
  if(query.kind==='near')selected=selected.filter(c=>c.before>=6000);
  const ids=new Set(selected.map(c=>c.campaignId));
  const timeline=report.timeline.filter(t=>ids.has(t.campaignId)),verified=timeline.filter(t=>t.state==='VERIFIED');
  const activation={CANARY_PENDING:'Primer cambio elegible pendiente de verificación en Meta.',CANARY_VERIFIED:'Primer cambio real verificado; ejecución automática habilitada.',REVIEW_REQUIRED:'Ejecución bloqueada: hay una operación que requiere revisión.'}[report.liveActivation?.stage];
  const alerts=(report.alerts||[]).map(a=>a.code==='CRITICAL_UNVERIFIED_CAP'?`ALERTA: el techo nocturno no quedó verificado (${a.slot}).`:a.code==='INTERRUPTED_REVIEW_REQUIRED'?`ALERTA: revisión interrumpida (${a.slot}); necesita comprobación.`:`ALERTA: ${a.code} (${a.slot}).`);
  const header=`Budget Autopilot V5.1 · ${report.mode}${report.enabled?'':' · desactivado'}\n${report.date} · Europe/Madrid · máximo 70 €/campaña\nRegla ordinaria: ±10 €; incremento con ROAS >3,8 y al menos tres compras.\n${activation?activation+'\n':''}${alerts.length?alerts.join('\n')+'\n':''}Observado ${report.observedAt} · próxima revisión ${report.nextReviewAt}`;
  if(query.kind==='increases'||query.kind==='reductions'){
    const rows=verified.filter(t=>query.kind==='increases'?t.after>t.before:t.after<t.before);
    const sum=rows.reduce((s,r)=>s+Math.abs(r.after-r.before),0);
    return `${header}\n\n${query.kind==='increases'?'Aumentos':'Reducciones'} reales verificados: ${money(sum)}/día de presupuesto configurado. No es gasto consumido.\n${rows.map(r=>`${r.name}: ${money(r.before)} → ${money(r.after)}`).join('\n')||'No hay modificaciones propias verificadas hoy.'}\nLos planes SHADOW no cuentan como cambios realizados.`;
  }
  if(query.kind==='history')return `${header}\n\n${timeline.map(t=>`${new Date(t.at).toLocaleTimeString('es-ES',{timeZone:'Europe/Madrid'})} · ${money(t.before)} → ${money(t.after)} · ${t.state} · ${t.mode} · ${t.origin}`).join('\n')||'Sin historial propio para esta campaña en el periodo consultado.'}\nLos cambios externos solo se atribuyen cuando hay evidencia; un plan SHADOW no altera Meta.`;
  return `${header}\n\n${selected.map(c=>`${c.name} · ID ${c.campaignId}\nActual ${money(c.before)} · ROAS ${c.metric?.metaRoas??'N/D'} · compras ${c.metric?.purchases??'N/D'}\n${c.action==='HOLD'?'Mantener':`Previsto ${money(c.after)}`} · techo nocturno ${money(c.nightTargetCents)}\n${c.reasons.length?'Bloqueos: '+c.reasons.map(r=>AUTOPILOT_REASONS[r]||r).join('; '):'Candidata; siguen vigentes las protecciones del ejecutor.'}`).join('\n\n')||'Sin campañas en este grupo.'}\n\nSHADOW no modifica Meta. La reducción por ROAS bajo solo corresponde a las 12:00 y 19:00; por la noche rigen los techos de 20/25 €.`;
}
export function formatAutopilotCycle(report,cycle) {
  const body=cycle.body||{},decisions=body.decisions||[],outcomes=new Map((body.outcomes||[]).map(o=>[o.campaignId,o]));
  const lines=[`Budget Autopilot · ${cycle.slot_key} · ${report.mode}`,`Revisión ${cycle.state} · ${decisions.length} campañas · Europe/Madrid`];
  for(const d of decisions){const outcome=outcomes.get(d.campaignId),blocked=[...(outcome?.reasons||d.reasons||[])];lines.push(`${d.name}: ROAS ${d.metric?.metaRoas??'N/D'} · ${money(d.before)} → ${money(d.after)} · ${outcome?.state||d.state}${blocked.length?'\n'+blocked.map(r=>AUTOPILOT_REASONS[r]||r).join('; '):''}`);}
  if(body.code)lines.push('ERROR: '+body.code);
  if(body.finalCheck)lines.push('Comprobación nocturna: '+body.finalCheck.state);
  lines.push(`Próxima revisión: ${report.nextReviewAt}`,report.mode==='LIVE'?'VERIFIED exige lectura posterior de Meta. Los resultados inciertos requieren reconciliación y no se reenvían.':'SHADOW: los importes propuestos no se han aplicado en Meta.');
  return lines.join('\n\n').slice(0,3900);
}
