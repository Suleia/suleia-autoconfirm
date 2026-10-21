import {compactMeta,compactOrders} from './compact-reports.mjs';
const reasons={MAX_BUDGET:'supera el presupuesto máximo',MAX_CHANGE_PERCENT:'supera el porcentaje de cambio permitido',MIN_BUDGET:'inferior al mínimo permitido',CAMPAIGN_INACTIVE:'campaña inactiva',NO_ELIGIBLE_AD:'sin anuncio activo elegible',CAMPAIGN_DAILY_BUDGET_REQUIRED:'el presupuesto no es diario a nivel campaña',AUTOMATION_CONFLICT:'posible conflicto con regla automática',SAMPLE_POLICY_NOT_CONFIGURED:'mínimos de muestra pendientes de configurar',INSUFFICIENT_SAMPLE:'muestra insuficiente',ROAS_FILTER_NOT_MET:'no cumple el filtro de ROAS',ROAS_MISSING:'ROAS ausente',ROAS_AMBIGUOUS:'ROAS ambiguo',ROAS_ZERO_SPEND:'gasto cero',METRIC_CHANGED:'las métricas han cambiado; prepara una propuesta nueva',REVALIDATION_FAILED:'la revalidación ha rechazado el cambio',EXPIRED:'confirmación caducada',PROVIDER_RESULT_UNKNOWN:'resultado incierto; requiere reconciliación sin reenvío',UNRESOLVED_OPERATION:'hay una operación sin reconciliar',CIRCUIT_OPEN:'ejecutor temporalmente bloqueado por errores'};
import {createHmac} from 'node:crypto';
Object.assign(reasons,{STALE_DATA:'datos históricos desactualizados',INCOMPLETE_EVIDENCE:'historial incompleto',LEARNING_EVIDENCE_NOT_ENABLED:'protección de aprendizaje pendiente de activar',LEARNING_POLICY_CHANGED:'la política de protección ha cambiado',CURRENT_DAY_HISTORY_UNAVAILABLE:'historial de hoy sin verificar',INSUFFICIENT_MULTIDAY_SAMPLE:'muestra multidiaria insuficiente',VERIFIED_ECONOMICS_MISSING:'margen cobrado sin verificar',RECENT_SIGNIFICANT_CHANGE:'modificación reciente: mantener en observación',VOLATILITY_OR_INCOMPLETE_HISTORY:'resultados variables o historia incompleta',EXTERNAL_BUDGET_NOT_RECONCILED:'cambio externo pendiente de conciliar',DAILY_CHANGE_LIMIT:'límite diario de cambios alcanzado',LEARNING_ACTIVE:'aprendizaje activo'});
const money=c=>Number.isFinite(c)?`${(c/100).toFixed(2)} €`:'no disponible';
export function signAdsBridge(secret,timestamp,body){return createHmac('sha256',createHmac('sha256',secret).update('suleia:ads-bridge:v3').digest()).update(`${timestamp}.${body}`).digest('hex');}
export function formatAdsResult(data,options={}) {
  if(data.orders)return compactOrders(data.orders,data.view);
  if(data.analysis?.version===3)return compactMeta(data,options);
  if(data.morning){const b=data.morning;return {text:[`Informe matinal · ${b.range.since} → ${b.range.until}`,`Gasto ${money(b.spend===null?null:b.spend*100)} · Compras ${b.purchases??'N/D'} · CPA ${money(b.cpa===null?null:b.cpa*100)} · ROAS ${b.roas??'N/D'}`,`Mejoran: ${b.improving.join(', ')||'sin evidencia suficiente'}`,`Empeoran: ${b.deteriorating.join(', ')||'sin evidencia suficiente'}`,...b.priorities.map((p,i)=>`${i+1}. ${p.title} · ${p.campaign}\n${p.evidence}\nRiesgo: ${p.risk}`),...b.learningRisks.slice(0,5).map(p=>`${p.campaign}: ${p.reasons.join(', ')}`),'Solo preparado bajo demanda. Notificaciones recurrentes apagadas; LIVE desactivado.'].join('\n\n')};}
  const p=data.proposal;
  if(p){
    if(p.question)return {text:p.question};
    const text=[`Propuesta ${p.id} · ${p.state} · ${p.mode}`,`Solicitud: ${p.request}`,`Caduca: ${new Date(p.expiresAt).toISOString()}`,`Periodo: ${p.intent.period||'presupuesto actual'} · Europe/Madrid`,
      ...p.items.map(i=>`${i.name} · ID ${i.campaignId}\n${money(i.before)} → ${money(i.after)}/día\nROAS ${i.metric?.roas??'no disponible'} · Gasto ${money(i.metric?.spend===null?null:i.metric?.spend*100)} · Compras ${i.metric?.purchases??'no disponibles'}\n${i.result?`${i.result.state}: ${(i.result.reasons||[]).map(r=>reasons[r]||r).join('; ')}`:i.reasons.length?`Bloqueada: ${i.reasons.map(r=>reasons[r]||r).join('; ')}`:'Elegible para simulación confirmada'}`),
      'SIMULATION/SHADOW no modifican Meta. Un resultado incierto nunca se reenvía automáticamente.'].join('\n\n');
    return {text,...(p.state==='PENDING'?{markup:{inline_keyboard:[[{text:'CONFIRMAR',callback_data:`confirm:${p.id}`},{text:'CANCELAR',callback_data:`cancel:${p.id}`}]]}}:{})};
  }
  if(data.analysis?.version===3){const a=data.analysis,scope=data.focus==='improve'?a.improveAds:data.focus==='top'?a.topAds:a.facts.filter(f=>f.source==='META_INSIGHTS').sort((x,y)=>(y.spend||0)-(x.spend||0));
    return {text:[`Ads Intelligence · ${a.range.since} → ${a.range.until} · ${a.level} · Europe/Madrid${a.range.partial?' · en curso, sin comparación con días completos':''}`,`Actualizado ${a.observedAt} · ${a.quality.attribution}`,`Gasto ${money(a.totals.spend===null?null:a.totals.spend*100)} · Compras ${a.totals.purchases??'no disponibles'} · ROAS ${a.totals.roas===null?'no disponible':a.totals.roas.toFixed(2)}`,
    ...scope.slice(0,6).map(f=>`${f.name} · ROAS ${f.roas===null?'no disponible':f.roas.toFixed(2)} · ${f.purchases??'N/D'} compras · ${f.status}\n${f.diagnoses.filter(d=>d.severity!=='INFO').map(d=>`${d.probableCause}. ${d.recommendedAction}`).join('\n')||'Sin señal concluyente de deterioro con la muestra disponible.'}`),
    ...(data.focus==='funnel'?[a.funnel.stages.map(s=>`${s.label}: ${s.value??'N/D'}${s.rate===null?'':` (${s.rate.toFixed(1)} % aprox.)`}`).join(' → '),a.funnel.note]:[]),
    ...a.actions.slice(0,3).map(x=>`${x.title} · ${x.name}\n${x.evidenceText}\n${x.action} · Confianza ${x.confidence}`),
    ...(data.focus==='opportunities'?a.opportunities.slice(0,3).map(o=>`${o.name}: ${o.favorable}. ${o.action}. Riesgo: ${o.risk}`):[]),
    'ROAS Meta ≠ beneficio. Pedidos y costes: NO_ATRIBUIDOS. No se modifica ningún presupuesto.'].join('\n\n')};
  }
  if(data.analysis){const a=data.analysis;return {text:[`Meta Ads · ${a.range.since} → ${a.range.until} · Europe/Madrid${a.range.partial?' · periodo en curso':''}`,`Fuente Meta · ${a.contract} · consulta ${a.observedAt}`,
    ...a.facts.map(f=>`${f.name} · ID ${f.entityId}\nGasto ${money(f.spend===null?null:f.spend*100)} · Compras ${f.purchases??'no disponibles'} · ROAS ${f.roas??'no disponible'}\nCTR enlace ${f.linkCtr??'no disponible'} · CPC enlace ${money(f.linkCpc===null?null:f.linkCpc*100)}\n${f.diagnoses.map(d=>`${d.code} · ${d.confidence}: ${d.probableCause}. ${d.recommendedAction}`).join('\n')||'Sin señal concluyente con la muestra y referencia disponibles.'}`),
    'ROAS atribuido no equivale a beneficio neto ni a pedidos entregados.'].join('\n\n')};}
  if(data.inventory)return {text:data.inventory.campaigns.map(c=>`${c.name} · ID ${c.id}\n${c.effective_status} · ${money(Number(c.daily_budget))}/día`).join('\n\n')||'Sin campañas.'};
  if(data.history)return {text:data.history.map(p=>`${p.id} · ${p.state} · ${p.mode}`).join('\n')||'Sin propuestas.'};
  return {text:data.text||'Consulta sin resultados.'};
}
export function createAdsGateway(config,fetchImpl=fetch){
  const url=new URL(config.adsApiUrl);
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('ADS_API_URL_INVALID');
  async function request(body,options={}){
    const serialized=JSON.stringify(body),timestamp=String(Date.now());
    const headers=config.adsApiToken?{Authorization:`Bearer ${config.adsApiToken}`}:{'X-Suleia-Ads-Timestamp':timestamp,'X-Suleia-Ads-Signature':signAdsBridge(config.botToken,timestamp,serialized)};
    const r=await fetchImpl(url,{method:'POST',redirect:'error',headers:{...headers,'Content-Type':'application/json'},body:serialized,signal:AbortSignal.timeout(12000)});
    if(!r.ok)throw Error(`ADS_SERVICE_${r.status}`);
    const result=await r.json();if(!result.ok)throw Error('ADS_SERVICE_FAILED');
    return formatAdsResult(result.data,options);
  }
  return {async read(body,actor,options={}) {
    if(!['analyze','orders-summary'].includes(body.action))throw Error('READ_ACTION_INVALID');
    return request({...body,actor},options);
  },async handle(text,actor,updateId){
    if(config.commandCenterEnabled){
      if(/^\/(start|help|ayuda)$/.test(text))return {text:'Suleia Command Center 2.0\nPuedes consultar: «¿Cómo va Suleia hoy?», «Analiza NIDA», «¿Y ayer?», «Consulta pedido ES…», «¿Qué incidencias necesitan atención?», «Beneficio de 2026-10», «Salud de servicios», «Mis decisiones».\nEl contexto de campaña caduca a los 15 minutos y pertenece a tu cuenta. Los cambios necesitan una propuesta completa y tu confirmación. No se ejecutan cambios reales en Meta.\nSin modelo externo; si una frase es ambigua te pediré que la concretes. Trendtrack y avisos programados pendientes de activación.\n/campanas · /estado · /historial'};
      const executive=/^\/resumen (hoy|ayer)$/.exec(text);if(executive)text=`¿Cómo va Suleia ${executive[1]}?`;
    }
    const budget=/^\/presupuesto (\d+) (\d+(?:[.,]\d{1,2})?)$/.exec(text);
    if(budget)text=`Pon el presupuesto de ${budget[1]} a ${budget[2]} €`;
    const report=/^\/(?:resumen|analizar) (hoy|ayer|3d|7d|30d)$/.exec(text);
    if(report)text=`Analiza las campañas ${['hoy','ayer'].includes(report[1])?report[1]:`de los últimos ${report[1].replace('d','')} días`}`;
    const command=/^\/(confirmar|cancelar|reconciliar) ([a-f0-9]{16})$/.exec(text);
    let body={action:'request',text,actor,requestKey:`telegram:${updateId}`};
    if(command)body={action:{confirmar:'confirm',cancelar:'cancel',reconciliar:'reconcile'}[command[1]],id:command[2],actor};
    else if(['/campanas','/historial','/estado'].includes(text))body={action:{'/campanas':'inventory','/historial':'history','/estado':'status'}[text],actor};
    else if(/^\/(start|help|ayuda)$/.test(text))return {text:'Suleia Ads Intelligence · simulación y propuestas con confirmación.\nEjemplo: «Sube 10 € el presupuesto de todas las campañas activas que tengan un ROAS superior a 5 hoy».\nAnaliza las campañas de los últimos 7 días.\n/campanas · /historial · /estado · /reconciliar CÓDIGO'};
    return request(body);
  }};
}
