export const escapeHtml=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const safe=(s,n=90)=>{let out='';for(const c of String(s??'').replace(/[\r\n\u0000-\u001f]/g,' ')){const e=escapeHtml(c);if(out.length+e.length>n)return out+'…';out+=e;}return out;};
const metric=(v,d=2)=>Number.isFinite(v)?v.toLocaleString('es-ES',{maximumFractionDigits:d}):'N/D';
const money=v=>Number.isFinite(v)?`${metric(v)} €`:'N/D';
const time=at=>Number.isFinite(Date.parse(at))?new Intl.DateTimeFormat('es-ES',{timeZone:'Europe/Madrid',dateStyle:'short',timeStyle:'short'}).format(new Date(at)):'sin fecha verificable';
const validRoas=f=>Number.isFinite(f.roas)&&['VALID','ZERO'].includes(f.roasStatus);
export function rankFacts(rows){return [...rows].sort((a,b)=>Number(validRoas(b))-Number(validRoas(a))||(validRoas(a)?b.roas-a.roas:0)||String(a.entityId).localeCompare(String(b.entityId)));}
export function compactOrders(o,view='today') {
  const nav=[{label:'🔄 Actualizar ahora',request:{action:'orders-summary',view}}];
  if(o.freshness==='UNAVAILABLE')return {text:'📦 <b>PEDIDOS</b>\n\nDatos no disponibles. No se pudo consultar Dropea. Inténtalo de nuevo.',parseMode:'HTML',navigation:nav};
  const lines=view==='confirmations'?['✅ <b>CONFIRMACIONES REALIZADAS HOY</b>',`Confirmaciones: <b>${metric(o.confirmations,0)}</b>`,'Incluye pedidos creados en días anteriores.']:view==='hour'?['📦 <b>ÚLTIMA HORA</b>',`Recibidos: <b>${metric(o.last_hour,0)}</b>`]:[
    '📦 <b>PEDIDOS DE HOY</b>',`🛒 Recibidos: <b>${metric(o.received,0)}</b>\n✅ Confirmados: <b>${metric(o.confirmed,0)}</b>\n⏳ Pendientes: <b>${metric(o.pending,0)}</b>\n❌ Cancelados: <b>${metric(o.cancelled,0)}</b>`,
    `📊 Confirmación: <b>${o.received>0?metric(o.confirmed/o.received*100,1)+' %':'N/D'}</b>`,
    ...(o.unclassified>0?[`⚠️ Sin clasificar: ${o.unclassified}`]:[])];
  if(o.freshness!=='FRESH')lines.push('⚠️ Copia desactualizada; no se ha podido confirmar una actualización.');
  if(o.coverage!=='COMPLETE')lines.push('⚠️ Cobertura sin verificar: cifras parciales, no total definitivo.');
  lines.push(`🕒 Actualizado: ${time(o.observedAt)}\nFuente: Dropea V2 · Europe/Madrid`);
  return {text:lines.join('\n\n'),parseMode:'HTML',navigation:nav};
}
export function compactMeta(data,{page=0,view=['diagnosis','improve'].includes(data.focus)?'diagnosis':'summary'}={}) {
  const a=data.analysis,focus=data.focus,isFunnel=focus==='funnel',isOpportunity=focus==='opportunities';
  const opportunityIds=new Set((a.opportunities||[]).map(x=>x.entityId));
  const all=focus==='improve'?(a.improveAds||[]):focus==='top'?(a.topAds||[]):isOpportunity?(a.facts||[]).filter(f=>opportunityIds.has(f.entityId)):(a.facts||[]);
  const rank=focus==='improve'?rows=>[...rows]:rankFacts;
  const rows=isFunnel?[]:rank(all.filter(f=>f.delivery==='ACTIVE'));
  if(a.level==='ad'&&data.focus==='sales')rows.sort((a,b)=>Number(Number.isFinite(b.purchases))-Number(Number.isFinite(a.purchases))||(b.purchases??0)-(a.purchases??0)||String(a.entityId).localeCompare(String(b.entityId)));
  if(data.includeInactive&&!isFunnel)rows.push(...rank(all.filter(f=>f.delivery!=='ACTIVE')));
  const pageSize=view==='diagnosis'?2:4;
  const pages=Math.max(1,Math.ceil(rows.length/pageSize));page=Math.max(0,Math.min(Math.floor(page)||0,pages-1));
  const query={since:a.range.since,until:a.range.until,level:a.level||'campaign',...a.filters};
  // Carry exact campaign identity, never a rendered list position.
  if(data.selector)query.selector=data.selector;
  const request={action:'analyze',query,focus:data.focus,includeInactive:data.includeInactive===true};
  const navigation=[{label:'🔄 Actualizar',request:{...request,query:{...query,force:true}},page,view},
    {label:'🔍 Ver diagnóstico',request,page:0,view:'diagnosis'},
    {label:'📈 Ver anuncios',request:{...request,query:{...query,level:'ad'},...(isFunnel?{focus:'diagnosis'}:{})},page:0,view:'summary'}];
  if(page>0)navigation.push({label:'← Anterior',request,page:page-1,view});
  if(page+1<pages)navigation.push({label:'Ver más →',request,page:page+1,view});
  const heading=isFunnel?'EMBUDO DE CONVERSIÓN':focus==='improve'?'ANUNCIOS A MEJORAR':focus==='top'?'ANUNCIOS DESTACADOS':isOpportunity?'OPORTUNIDADES A VALIDAR':`${a.level==='ad'?'ANUNCIOS':a.level==='adset'?'CONJUNTOS':'CAMPAÑAS'} POR ${data.focus==='sales'&&a.level==='ad'?'COMPRAS':'ROAS'}`;
  const lines=[`📊 <b>META ADS · ${a.range.since===a.range.until?safe(a.range.since):safe(a.range.since+' → '+a.range.until)}</b>`,
    `💰 Gasto: ${money(a.totals?.spend)}\n🛒 Compras: ${metric(a.totals?.purchases,0)}\n🚀 <b>ROAS GLOBAL: ${metric(a.totals?.roas)}</b>`,
    `<b>${heading}</b>${isFunnel?'':` · ${page+1}/${pages}`}`];
  if(isFunnel){
    const stages=(a.funnel?.stages||[]).slice(0,8);
    lines.push(stages.length?stages.map(s=>`${safe(s.label,60)}: <b>${metric(s.value,0)}</b> · ${metric(s.rate)} %`).join('\n'):'Datos insuficientes para reconstruir el embudo.');
    lines.push(safe(a.funnel?.note||'Eventos atribuidos agregados; no son usuarios únicos ni prueban causalidad.',250));
  }
  for(const [i,f] of rows.slice(page*pageSize,page*pageSize+pageSize).entries()) {
    const enough=f.purchases>=5&&f.spend>=15&&f.impressions>=1000;
    lines.push(`<b>${page*pageSize+i+1}. ${safe(f.name)}</b>${f.delivery!=='ACTIVE'?' · Inactiva/no activa':''}\n<b>ROAS: ${validRoas(f)?metric(f.roas):'N/D'}</b>${!enough?' · Muestra insuficiente':''}\nGasto: ${money(f.spend)} · Compras: ${metric(f.purchases,0)}${f.product?.name?'\nProducto: '+safe(f.product.name):''}`);
    if(view==='diagnosis') {
      lines.push(`CTR: ${metric(f.linkCtr)} % · CPC: ${money(f.linkCpc)} · CPA: ${money(f.cpa)}\n${(f.diagnoses||[]).slice(0,2).map(d=>safe(d.recommendedAction,150)).join('\n')||'Datos insuficientes para un diagnóstico.'}`);
      if(f.product?.products?.length>1)lines.push(f.product.products.map(p=>safe(p.name,60)).slice(0,8).join(' · '));
    }
  }
  if(!rows.length&&!isFunnel)lines.push(focus==='improve'?'Sin anuncios con mejoras verificadas para esta consulta.':focus==='top'?'Sin anuncios destacados con evidencia suficiente.':isOpportunity?'Sin oportunidades verificadas para esta consulta.':'Sin campañas activas verificadas para esta consulta.');
  const visibleIds=new Set((isFunnel?all:rows).map(r=>r.entityId));
  const recommendations=(isOpportunity?a.opportunities||[]:a.actions||[]).filter(x=>visibleIds.has(x.entityId)).slice(0,3);
  if(!recommendations.length&&!isOpportunity)recommendations.push(...(a.opportunities||[]).filter(x=>visibleIds.has(x.entityId)).slice(0,3));
  if(recommendations.length)lines.push('💡 <b>QUÉ HARÍA HOY</b>\n'+recommendations.map(x=>`• ${safe(x.name,55)}: ${safe(x.action,isOpportunity?100:130)}${isOpportunity?`\nA favor: ${safe(x.favorable,90)}\nRiesgo: ${safe(x.risk,90)}`:''}`).join('\n'));
  if(data.previousDay)lines.push(`Ayer (día completo): gasto ${money(data.previousDay.totals.spend)} · compras ${metric(data.previousDay.totals.purchases,0)} · ROAS ${metric(data.previousDay.totals.roas)}.\nHoy está en curso; no implica una tendencia comparable.`);
  if(a.cache?.status==='STALE')lines.push('⚠️ No se pudo refrescar Meta. Última instantánea disponible.');
  lines.push(`🕒 Actualizado: ${time(a.observedAt)}\nFuente: Meta · 7d clic / 1d vista · Europe/Madrid\nLas conversiones pueden llegar con retraso. ROAS no equivale a beneficio.`);
  return {text:lines.join('\n\n'),parseMode:'HTML',navigation};
}
