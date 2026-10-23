import {compactMeta,compactOrders} from './compact-reports.mjs';
import {renderArtifact} from './artifacts.mjs';
const reasons={MAX_BUDGET:'supera el presupuesto máximo',MAX_CHANGE_PERCENT:'supera el porcentaje de cambio permitido',MIN_BUDGET:'inferior al mínimo permitido',CAMPAIGN_INACTIVE:'campaña inactiva',NO_ELIGIBLE_AD:'sin anuncio activo elegible',CAMPAIGN_DAILY_BUDGET_REQUIRED:'el presupuesto no es diario a nivel campaña',AUTOMATION_CONFLICT:'posible conflicto con regla automática',SAMPLE_POLICY_NOT_CONFIGURED:'mínimos de muestra pendientes de configurar',INSUFFICIENT_SAMPLE:'muestra insuficiente',ROAS_FILTER_NOT_MET:'no cumple el filtro de ROAS',ROAS_MISSING:'ROAS ausente',ROAS_AMBIGUOUS:'ROAS ambiguo',ROAS_ZERO_SPEND:'gasto cero',METRIC_CHANGED:'las métricas han cambiado; prepara una propuesta nueva',REVALIDATION_FAILED:'la revalidación ha rechazado el cambio',EXPIRED:'confirmación caducada',PROVIDER_RESULT_UNKNOWN:'resultado incierto; requiere reconciliación sin reenvío',UNRESOLVED_OPERATION:'hay una operación sin reconciliar',CIRCUIT_OPEN:'ejecutor temporalmente bloqueado por errores'};
import {createHmac} from 'node:crypto';
Object.assign(reasons,{STALE_DATA:'datos históricos desactualizados',INCOMPLETE_EVIDENCE:'historial incompleto',LEARNING_EVIDENCE_NOT_ENABLED:'protección de aprendizaje pendiente de activar',LEARNING_POLICY_CHANGED:'la política de protección ha cambiado',CURRENT_DAY_HISTORY_UNAVAILABLE:'historial de hoy sin verificar',INSUFFICIENT_MULTIDAY_SAMPLE:'muestra multidiaria insuficiente',VERIFIED_ECONOMICS_MISSING:'margen cobrado sin verificar',RECENT_SIGNIFICANT_CHANGE:'modificación reciente: mantener en observación',VOLATILITY_OR_INCOMPLETE_HISTORY:'resultados variables o historia incompleta',EXTERNAL_BUDGET_NOT_RECONCILED:'cambio externo pendiente de conciliar',DAILY_CHANGE_LIMIT:'límite diario de cambios alcanzado',LEARNING_ACTIVE:'aprendizaje activo'});
const money=c=>Number.isFinite(c)?`${(c/100).toFixed(2)} €`:'no disponible';
Object.assign(reasons,{CAMPAIGN_COOLDOWN:'ya hubo un cambio en las últimas 24 horas',AGGREGATE_DAILY_LIMIT:'supera el aumento agregado diario autorizado',ACCUMULATION_POLICY_NOT_CONFIGURED:'faltan límites de acumulación autorizados',LIVE_CANARY_ONLY:'campaña fuera del ámbito autorizado'});
Object.assign(reasons,{MIN_THREE_PURCHASES:'menos de tres compras válidas',META_MINIMUM_NOT_VERIFIED:'mínimo de Meta sin verificar',META_MINIMUM_CONFLICT:'objetivo inferior al mínimo de Meta',LEARNING_EVIDENCE_PREPARING_OR_UNAVAILABLE:'protecciones históricas aún no disponibles',CAMPAIGN_AGE_UNKNOWN_OR_YOUNG:'campaña demasiado reciente o edad sin verificar',CONVERSIONS_ALREADY_USED:'faltan tres compras nuevas desde la última subida',GLOBAL_EXPOSURE_LIMIT:'supera el techo global autorizado',LIVE_REVIEW_REQUIRED:'operación pendiente de revisión',CANARY_VERIFICATION_PENDING:'primer cambio real pendiente de verificar'});
export const ADS_BRIDGE_TIMEOUT_MS=45000;
const diagnosticCodes=new Set(['META_RATE_LIMITED','ADS_REPORT_PREPARING','ADS_DATABASE_UNAVAILABLE','META_SOURCE_UNAVAILABLE','EXECUTIVE_DISABLED','EXECUTIVE_CONFIGURATION_INVALID','ACTOR_UNAUTHORIZED','ACCOUNT_NOT_ELIGIBLE','ACCOUNT_BUDGET_BUSY','META_REPORT_PREPARING_OR_UNAVAILABLE','ADS_REPORT_BUSY','ADS_REPORT_TIMEOUT','AUTOPILOT_HISTORY_INCOMPLETE','AUTOPILOT_DAY_CHANGED','ADS_ALGORITHM_DISABLED','QUERY_INVALID','REQUEST_INVALID','IDEMPOTENCY_PAYLOAD_CONFLICT','LIVE_NOT_AUTHORIZED','PROPOSAL_NOT_AUTHORIZED','LIVE_CANARY_GUARD_UNAVAILABLE']);
export function formatAdsError(error){
  const raw=error?.message,code=diagnosticCodes.has(raw)||/^META_HTTP_(?:400|401|403|429|500|502|503|504)$/.test(raw||'')||/^ADS_(?:BRIDGE_TIMEOUT|BRIDGE_UNAVAILABLE|SERVICE_\d{3}|SERVICE_FAILED)$/.test(raw||'')?raw:'ADS_COMMAND_FAILED';
  const messages={META_RATE_LIMITED:'Meta ha limitado temporalmente las consultas de la cuenta (código 17). Espera antes de volver a consultar; los cambios dependientes de datos actuales permanecen bloqueados.',ADS_REPORT_PREPARING:'La lectura paginada de Meta sigue en curso. Se conserva la consulta; vuelve a consultar en unos minutos. No repitas órdenes de presupuesto.',ADS_DATABASE_UNAVAILABLE:'El historial de informes no está disponible. Revisa la conexión SQL y sus permisos; no se ejecutan cambios.',EXECUTIVE_DISABLED:'El informe ejecutivo diario está preparado pero no está activado.',ADS_BRIDGE_TIMEOUT:'La consulta ha superado el tiempo de espera. Consulta /historial y /estado antes de repetir una orden: puede haber una propuesta preparada o una ejecución pendiente de verificar.',ACCOUNT_BUDGET_BUSY:'Hay otra operación de presupuesto en curso. Consulta /historial antes de iniciar otra.',META_REPORT_PREPARING_OR_UNAVAILABLE:'El informe actualizado aún no está disponible. Vuelve a consultar en unos minutos.',ADS_REPORT_BUSY:'Hay una lectura de Meta en curso. Vuelve a consultar en unos minutos.',ACTOR_UNAUTHORIZED:'Esta cuenta o este chat no están autorizados para esta operación.',AUTOPILOT_HISTORY_INCOMPLETE:'El historial de presupuestos está incompleto; el ejecutor queda bloqueado hasta revisarlo.'};
  return {code,text:messages[code]||`No se ha podido completar la operación (${code}). Consulta /historial y /estado antes de repetir cambios. Los resultados inciertos no se reenvían automáticamente.`};
}
function formatBudgetProposal(p){
  const eligible=p.items.filter(i=>!i.reasons.length),blocked=p.items.filter(i=>i.reasons.length);
  const label=s=>String(s||'').replace(/[\r\n\u0000-\u001f]/g,' ').slice(0,90);
  const heading=[`Propuesta ${p.id} · ${p.state} · ${p.mode}`,`Solicitud: ${label(p.request)}`,`Periodo: ${p.intent.period||'presupuesto actual'} · Europe/Madrid`,`Caduca: ${new Date(p.expiresAt).toISOString()}`,`${eligible.length} elegibles · ${blocked.length} bloqueadas.`];
  const row=i=>`${label(i.name)} · ID ${i.campaignId}\n${money(i.before)} → ${money(i.after)}/día · ROAS ${i.metric?.roas??'N/D'} · compras ${i.metric?.purchases??'N/D'} · gasto ${money(i.metric?.spend==null?null:i.metric.spend*100)}\n${i.result?`${i.result.state}: ${(i.result.reasons||[]).map(r=>reasons[r]||r).join('; ')}`:i.reasons.length?`Bloqueada: ${i.reasons.slice(0,2).map(r=>reasons[r]||r).join('; ')}${i.reasons.length>2?` (+${i.reasons.length-2} controles)`:''}`:'Elegible; requiere tu confirmación.'}`;
  const footer=[`Impacto de elegibles: ${money(eligible.reduce((s,i)=>s+i.after-i.before,0))}/día de presupuesto configurado.`,...new Set(eligible.flatMap(i=>i.learning?.warnings||[])),p.mode==='LIVE'?'Solo CONFIRMAR ejecuta los cambios elegibles, con una nueva validación y lectura posterior de Meta.':'SIMULATION/SHADOW no modifican Meta.','Un resultado incierto requiere revisión y no se reenvía automáticamente.'];
  let text=[...heading,...eligible.map(row),...footer].join('\n\n');
  // Never present a confirmation after silently truncating eligible changes.
  if(text.length>3600)return {text:`Propuesta ${p.id}: demasiadas campañas para mostrar todos los cambios de forma completa. Solicita una propuesta por ID de campaña. Consulta /historial antes de repetir.`,markup:undefined};
  let shown=0;for(const i of blocked){const line=row(i);if(text.length+line.length+100>3900)break;text+='\n\n'+line;shown++;}
  if(shown<blocked.length)text+=`\n\nSe muestran ${shown}/${blocked.length} bloqueadas; consulta el motivo por ID de campaña.`;
  if(!eligible.length&&p.state==='PENDING')text+='\n\nNinguna campaña cumple los controles; no hay cambios que confirmar.';
  return {text,...(p.state==='PENDING'&&eligible.length?{markup:{inline_keyboard:[[{text:'CONFIRMAR',callback_data:`confirm:${p.id}`},{text:'CANCELAR',callback_data:`cancel:${p.id}`}]]}}:{})};
}
export function signAdsBridge(secret,timestamp,body){return createHmac('sha256',createHmac('sha256',secret).update('suleia:ads-bridge:v3').digest()).update(`${timestamp}.${body}`).digest('hex');}
export function formatAdsResult(data,options={}) {
  if(data.review)return {text:[data.text,data.deepLink?`Abrir Ads Intelligence: ${data.deepLink}`:null].filter(Boolean).join('\n\n').slice(0,3900)};
  if(data.autopilot)return {text:(data.text||'Budget Autopilot: informe actualizado no disponible.').slice(0,3900),autopilot:data.autopilot,cycleText:data.cycleText,cycleKey:data.cycleKey,navigation:[{label:'Campañas de hoy',request:{action:'analyze',query:{period:'hoy',level:'campaign'}}}]};
  if(data.report)return {text:`Informe Suleia · ${data.report.period.label}${data.report.period.partial?' · provisional':''}`,artifact:{kind:'report',report:data.report},format:data.format};
  if(data.orders)return compactOrders(data.orders,data.view,data.metric);
  if(data.analysis?.version===3)return compactMeta(data,options);
  if(data.morning){const b=data.morning;return {text:[`Informe matinal · ${b.range.since} → ${b.range.until}`,`Gasto ${money(b.spend===null?null:b.spend*100)} · Compras ${b.purchases??'N/D'} · CPA ${money(b.cpa===null?null:b.cpa*100)} · ROAS ${b.roas??'N/D'}`,`Mejoran: ${b.improving.join(', ')||'sin evidencia suficiente'}`,`Empeoran: ${b.deteriorating.join(', ')||'sin evidencia suficiente'}`,...b.priorities.map((p,i)=>`${i+1}. ${p.title} · ${p.campaign}\n${p.evidence}\nRiesgo: ${p.risk}`),...b.learningRisks.slice(0,5).map(p=>`${p.campaign}: ${p.reasons.join(', ')}`),'Solo preparado bajo demanda. Notificaciones recurrentes apagadas; LIVE desactivado.'].join('\n\n')};}
  const p=data.proposal;
  if(p){
    if(p.question)return {text:p.question};
    return formatBudgetProposal(p);
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
    let r;try{r=await fetchImpl(url,{method:'POST',redirect:'error',headers:{...headers,'Content-Type':'application/json'},body:serialized,signal:AbortSignal.timeout(ADS_BRIDGE_TIMEOUT_MS)});}
    catch(error){throw Error(['TimeoutError','AbortError'].includes(error.name)?'ADS_BRIDGE_TIMEOUT':'ADS_BRIDGE_UNAVAILABLE');}
    const result=await r.json().catch(()=>null);
    if(!r.ok||result?.ok!==true){const code=result?.diagnostic?.code||result?.code;throw Error(diagnosticCodes.has(code)||/^META_HTTP_(?:400|401|403|429|500|502|503|504)$/.test(code||'')?code:r.ok?'ADS_SERVICE_FAILED':`ADS_SERVICE_${r.status}`);}
    if(options.executive===true){if(!result.data.executive)throw Error('EXECUTIVE_CONTRACT_INVALID');return result.data.executive;}
    const formatted=formatAdsResult(result.data,options);
    if(formatted.artifact){const files=await renderArtifact(formatted.artifact);const pdf=formatted.format==='pdf';formatted.media={data:pdf?files.pdf:files.png,filename:pdf?'suleia-informe.pdf':'suleia-productos.png',mime:pdf?'application/pdf':'image/png',caption:formatted.text};delete formatted.artifact;}
    return formatted;
  }
  return {async executive(body,actor){return request({action:'executive-report',...body,actor},{executive:true});},async prepareBudget(body,actor,key){return request({...body,actor,requestKey:`telegram:prepare:${key}`});},async read(body,actor,options={}) {
    if(!['analyze','orders-summary','daily-report','autopilot'].includes(body.action))throw Error('READ_ACTION_INVALID');
    return request({...body,actor},options);
  },async handle(text,actor,updateId){
    if(config.commandCenterEnabled){
      if(/^\/(start|help|ayuda)$/.test(text))return {text:'Suleia Command Center 3.0\nPuedes consultar: «¿Cómo va Suleia hoy?», «Analiza NIDA», «¿Y ayer?», «Consulta pedido ES…», «¿Qué incidencias necesitan atención?», «Beneficio de 2026-10», «Salud de servicios», «Mis decisiones».\nEl contexto de campaña caduca a los 15 minutos y pertenece a tu cuenta. Los cambios necesitan una propuesta completa y tu confirmación. Los presupuestos se modifican solo tras una propuesta autorizada y tu confirmación; /estado muestra el modo y límites.\nSin modelo externo; si una frase es ambigua te pediré que la concretes. Pedidos de ayer, 14 días, 30 días o una fecha; gráfica por producto; informe en PDF o imagen. Configura el envío con «Informe diario». Trendtrack no está conectado.\n/campanas · /estado · /historial'};
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
    const detailed=/\b(?:diagnostico|detalle|detalles|detallado|detallada)\b/.test(text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase());
    return request(body,detailed?{view:'diagnosis'}:{});
  }};
}
