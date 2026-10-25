const clean=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[¿?¡!]/g,'').trim();
const money=c=>Number.isFinite(c)?(c/100).toLocaleString('es-ES',{style:'currency',currency:'EUR'}):'N/D';
export const AUTOPILOT_REASONS=Object.freeze({
  INCREMENTAL_PURCHASE_PROVENANCE_UNVERIFIED:'no se han acreditado tres compras nuevas por hora de conversión después de la última subida; el delta agregado no basta',FOUR_INCREASES_USED:'cuatro subidas ya utilizadas hoy',DAY_BASELINE_UNVERIFIED:'falta el presupuesto base verificado de las 08:00; no se reconstruye retrospectivamente',NIGHT_ALREADY_CLAIMED:'el recorte de esta noche ya tiene una reserva persistente; no se repite',INTRADAY_RECOVERY_PROTECTED:'recuperación intradiaria: reducción suspendida',INTRADAY_TREND_UNVERIFIED:'faltan dos observaciones comparables para descartar recuperación',INCOMPLETE_OPERATIONAL_EVIDENCE:'faltan metadatos, aprendizaje, reglas o actividad operativa verificables',AUTOPILOT_AUTHORIZATION_EXPIRED:'la autorización de la política ha caducado',
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
  if(/cerca de (?:los )?(?:70|100)/.test(t))return {kind:'near'};
  if(/cuant[oa]s? (?:cambios|modificaciones).*verificad|cambios reales.*hoy/.test(t))return {kind:'count'};
  if(/campanas.*(?:han )?mejorado.*hoy/.test(t))return {kind:'improved'};
  if(/recorte nocturno|reduccion nocturna|22:30/.test(t))return {kind:'night'};
  if(/campanas.*roas.*(?:superior|mayor|>).*3[,.]8/.test(t))return {kind:'roas'};
  if(/que (?:podemos )?mejorar.*(?:autopilot|presupuesto)|mejoras del autopilot/.test(t))return {kind:'improvements'};
  if(/que campanas han subido.*(?:presupuesto|hoy)|incrementos.*hoy/.test(t))return {kind:'increases'};
  if(/cuanto presupuesto.*reducido|reducciones.*hoy/.test(t))return {kind:'reductions'};
  let m=/por que no (?:(?:has|ha) )?(?:aumentado|subido) (.+?)(?: hoy)?$/.exec(t);
  if(m)return {kind:'why',selector:m[1]};
  m=/(?:muestrame )?(?:el )?historial de (?:modificaciones|presupuestos) (?:de )?(.+)$/.exec(t);
  if(m)return {kind:'history',selector:m[1]};
  return null;
}
export function formatAutopilot(report,query={kind:'status'}) {
  let selected=report.campaigns;
  if(query.selector){selected=selected.filter(c=>c.campaignId===query.selector||clean(c.name).includes(query.selector));if(selected.length!==1)return `Hay ${selected.length} campañas coincidentes. Indica un único ID exacto; no se ha preparado ningún cambio.`;}
  const v6=report.version==='SULEIA_META_AUTOPILOT_V6',cap=report.policy?.maxBudgetCents||(v6?10000:7000);
  if(query.kind==='near')selected=selected.filter(c=>c.before>=cap-1000);
  if(query.kind==='roas')selected=selected.filter(c=>c.metric?.metaRoas>3.8&&['VALID','ZERO'].includes(c.metric.metaRoasStatus));
  if(query.kind==='improved')selected=selected.filter(c=>c.trend?.verified&&c.metric?.metaRoas>c.trend.previousRoas);
  const ids=new Set(selected.map(c=>c.campaignId));
  const timeline=report.timeline.filter(t=>ids.has(t.campaignId)),verified=timeline.filter(t=>t.state==='VERIFIED');
  const activation={CANARY_PENDING:'Primer cambio elegible pendiente de verificación en Meta.',CANARY_VERIFIED:'Primer cambio real verificado; ejecución automática habilitada.',REVIEW_REQUIRED:'Ejecución bloqueada: hay una operación que requiere revisión.'}[report.liveActivation?.stage];
  const alerts=(report.alerts||[]).map(a=>a.code==='CRITICAL_UNVERIFIED_CAP'?`ALERTA: el techo nocturno no quedó verificado (${a.slot}).`:a.code==='INTERRUPTED_REVIEW_REQUIRED'?`ALERTA: revisión interrumpida (${a.slot}); necesita comprobación.`:`ALERTA: ${a.code} (${a.slot}).`);
  const header=`Meta Autopilot ${v6?'V6':'V5.1'} · ${report.mode}${report.enabled?'':' · desactivado'}\n${report.date} · Europe/Madrid · máximo ${money(cap)}/campaña\n${v6?'08:00 observar; 10/12/16/18 posible +10 €; 12/16/18 reducción hasta 25 % de la base diaria; 22:30 un solo −30 %, independiente del ROAS. Sin restauración matinal.':'Regla ordinaria: ±10 €; incremento con ROAS >3,8 y al menos tres compras.'}\n${activation?activation+'\n':''}${alerts.length?alerts.join('\n')+'\n':''}Observado ${report.observedAt} · próxima revisión ${report.nextReviewAt}`;
  if(query.kind==='count')return `${header}\n\n${verified.length} cambios propios VERIFIED hoy. Simulaciones, propuestas y resultados inciertos no se cuentan.`;
  if(query.kind==='night'){
    const night=report.slots.find(s=>s.body?.slot?.kind==='NIGHT'&&s.body?.version===report.version);
    return `${header}\n\n${night?`Noche ${night.slot_key}: ${night.body.executionState}; ${night.body.externalWrites??'incierto'} cambios verificados. ${night.body.diagnostic?.code||''}`:'El recorte nocturno de hoy aún no tiene una ejecución de esta política. No se aplica retrospectivamente.'}\nCada campaña conserva su objetivo reservado aunque cambie la versión. El mínimo puede reducir el porcentaje efectivo.`;
  }
  if(query.kind==='improvements')return `${header}\n\n${[...new Set(selected.flatMap(c=>c.reasons))].map(r=>AUTOPILOT_REASONS[r]||r).join('\n')||'Sin bloqueos en las candidatas actuales.'}\nLas mejoras propuestas no eliminan controles ni ejecutan cambios.`;
  if(query.kind==='increases'||query.kind==='reductions'){
    const rows=verified.filter(t=>query.kind==='increases'?t.after>t.before:t.after<t.before);
    const sum=rows.reduce((s,r)=>s+Math.abs(r.after-r.before),0);
    return `${header}\n\n${query.kind==='increases'?'Aumentos':'Reducciones'} reales verificados: ${money(sum)}/día de presupuesto configurado. No es gasto consumido.\n${rows.map(r=>`${r.name}: ${money(r.before)} → ${money(r.after)}`).join('\n')||'No hay modificaciones propias verificadas hoy.'}\nLos planes SHADOW no cuentan como cambios realizados.`;
  }
  if(query.kind==='history')return `${header}\n\n${timeline.map(t=>`${new Date(t.at).toLocaleTimeString('es-ES',{timeZone:'Europe/Madrid'})} · ${money(t.before)} → ${money(t.after)} · ${t.state} · ${t.mode} · ${t.origin}`).join('\n')||'Sin historial propio para esta campaña en el periodo consultado.'}\nLos cambios externos solo se atribuyen cuando hay evidencia; un plan SHADOW no altera Meta.`;
  return `${header}\n\n${selected.map(c=>`${c.name} · ID ${c.campaignId}\nActual ${money(c.before)} · ROAS ${c.metric?.metaRoas??'N/D'} · compras ${c.metric?.purchases??'N/D'}${v6?` · nuevas acreditadas ${c.newPurchases??'N/D'} · ${c.classification}`:''}\n${c.action==='HOLD'?'Mantener':`Previsto ${money(c.after)}`} · ${v6?'objetivo nocturno':'techo nocturno'} ${money(c.nightTargetCents)}\n${c.reasons.length?'Bloqueos: '+c.reasons.map(r=>AUTOPILOT_REASONS[r]||r).join('; '):'Candidata; siguen vigentes las protecciones del ejecutor.'}`).join('\n\n')||'Sin campañas en este grupo.'}\n\n${v6?'Solo VERIFIED significa aplicado y leído en Meta. El ranking 70/20/10 no sustituye la evidencia ni los límites.':'SHADOW no modifica Meta. La reducción por ROAS bajo solo corresponde a las 12:00 y 19:00; por la noche rigen los techos de 20/25 €.'}`;
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
