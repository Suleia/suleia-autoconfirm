/* Premium presentation over the existing authenticated Campaign Review Agent. */
const GrowthIntelligencePanel=(()=>{
 const labels={spend:'Gasto',roas:'ROAS atribuido',purchases:'Compras atribuidas',cpa:'CPA atribuido',impressions:'Impresiones',reach:'Alcance',frequency:'Frecuencia',cpm:'CPM',linkCtr:'CTR de enlace',linkCpc:'CPC de enlace',outboundClicks:'Clics salientes',linkClicks:'Clics en enlace',landingPageViews:'Landing views',addToCart:'Carrito',costPerCart:'Coste por carrito',initiateCheckout:'Checkout',costPerCheckout:'Coste por checkout',purchaseValue:'Valor de compras',dailyBudgetCents:'Presupuesto activo actual'};
 const states={CANDIDATA_ESCALAR:'Candidata a escalar',PROTEGER:'Proteger',MANTENER:'Mantener',MANTENER_VIGILAR:'Mantener',MEJORAR_CREATIVIDAD:'Mejorar creatividad',MEJORAR_CONVERSION:'Mejorar conversión',INVESTIGAR:'Investigar',REVISAR_REDUCCION:'Revisar reducción',REVISAR_PAUSA:'Revisar pausa',DATOS_INSUFICIENTES:'Datos insuficientes',INACTIVA:'Inactiva'};
 const moneyKeys=new Set(['spend','cpa','cpm','linkCpc','costPerCart','costPerCheckout','purchaseValue','dailyBudgetCents']);
 const format=(v,k='')=>v===null||v===undefined||!Number.isFinite(Number(v))?'N/D':new Intl.NumberFormat('es-ES',{maximumFractionDigits:2,...(moneyKeys.has(k)?{style:'currency',currency:'EUR'}:{})}).format(k==='dailyBudgetCents'?v/100:v)+(k==='linkCtr'?' %':k==='roas'?'×':'');
 const e=(tag,cls='',value)=>node(tag,cls,value);
 const button=(label,fn,primary=false)=>{const b=e('button',primary?'gi-button primary':'gi-button',label);b.type='button';b.addEventListener('click',fn);return b;};
 const contextQuery=q=>Object.fromEntries(Object.entries(q).filter(([k])=>['period','since','until','level','campaignId','campaignIds','adsetId','adId','productId','compareSince','compareUntil'].includes(k)));
 const section=(title,subtitle)=>{const s=e('section','gi-card');if(title)s.append(e('h3','',title));if(subtitle)s.append(e('p','gi-muted',subtitle));return s;};
 const pathIcon={spend:'M5 6h14v12H5zM8 3h10v3M14 11h5',roas:'M4 16 9 11l4 3 7-9M15 5h5v5',purchases:'M2 3h3l2 12h11l3-9H6M8 20h.1M17 20h.1',cpa:'M8 8a4 4 0 1 0 8 0 4 4 0 1 0-8 0M5 21v-3a7 7 0 0 1 14 0v3',default:'M4 19V9M10 19V4M16 19V12M21 19V2'};
 function icon(key){const box=e('span','gi-icon'),svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),p=document.createElementNS(svg.namespaceURI,'path');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.8');svg.setAttribute('aria-hidden','true');p.setAttribute('d',pathIcon[key]||pathIcon.default);svg.append(p);box.append(svg);return box;}
 function spark(values,cls=''){
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 100 36');svg.setAttribute('class','gi-spark '+cls);svg.setAttribute('aria-hidden','true');
  const valid=values.filter(Number.isFinite);if(valid.length<2)return svg;const min=Math.min(...valid),max=Math.max(...valid),span=max-min||1;
  let d='',connected=false;values.forEach((v,i)=>{if(!Number.isFinite(v)){connected=false;return;}d+=`${connected?'L':'M'}${i/Math.max(1,values.length-1)*96+2},${32-(v-min)/span*27} `;connected=true;});
  const p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',d);p.setAttribute('fill','none');p.setAttribute('stroke','currentColor');p.setAttribute('stroke-width','2');svg.append(p);return svg;
 }
 function kpis(root,report){
  const keys=['spend','roas','purchases','cpa','impressions','reach','frequency','cpm','linkCtr','linkCpc','outboundClicks','landingPageViews','addToCart','costPerCart','initiateCheckout','costPerCheckout','purchaseValue','dailyBudgetCents'];
  const primary=e('div','gi-kpis gi-primary-kpis'),secondary=e('div','gi-kpis gi-secondary-kpis');
  keys.forEach((key,index)=>{
   const card=e('article',`gi-kpi gi-tone-${index%4}`),value=report.totals[key];
   const conversion=['roas','cpa','purchases','purchaseValue'].includes(key),compatible=report.comparison.comparable&&(!conversion||report.totals.purchaseType===report.previous.purchaseType);
   const before=compatible?report.previous[key]:null,change=compatible&&Number.isFinite(value)&&Number.isFinite(before)&&before>0?(value-before)/before*100:null;
   const costs=['cpa','linkCpc','costPerCart','costPerCheckout','cpm'].includes(key),benefit=['roas','purchases','linkCtr','purchaseValue'].includes(key);
   const good=change!==null&&(costs?change<0:benefit?change>0:null),tone=change===0?'neutral':good===true?'favorable':good===false&&(costs||benefit)?'adverse':'neutral';
   const copy=e('div','gi-kpi-copy');copy.append(e('span','gi-label',labels[key]),e('strong','gi-value',format(value,key)),e('small','gi-change '+tone,change===null?'Sin comparación válida':`${change>=0?'↑':'↓'} ${format(Math.abs(change))} % · vs. ${format(before,key)}`));
   card.append(icon(key),copy,spark(report.rows.flatMap(()=>[])));
   const days=[...new Set(report.rows.flatMap(r=>r.series.map(d=>d.since)))].sort();
   const series=days.map(day=>{
    const rows=report.rows.filter(r=>r.source==='META_INSIGHTS').map(r=>r.series.find(d=>d.since===day));
    if(!rows.length||rows.some(r=>!r))return null;
    const sum=k=>rows.every(r=>Number.isFinite(r[k]))?rows.reduce((n,r)=>n+r[k],0):null;
    const ratios={roas:['purchaseValue','spend',1],cpa:['spend','purchases',1],linkCtr:['linkClicks','impressions',100],linkCpc:['spend','linkClicks',1],cpm:['spend','impressions',1000],costPerCart:['spend','addToCart',1],costPerCheckout:['spend','initiateCheckout',1]};
    if(['reach','frequency','dailyBudgetCents'].includes(key))return null;
    if(ratios[key]){const [a,b,scale]=ratios[key],num=sum(a),den=sum(b);return num!==null&&den>0?num/den*scale:null;}return sum(key);
   });
   card.lastChild.replaceWith(spark(series));
   const coverage=report.totals.coverage?.[key]?.status||(value==null?'UNAVAILABLE':'DERIVED');
   card.title=`${report.range.since} → ${report.range.until} · ${report.observedAt} · ${coverage}${['reach','frequency'].includes(key)?' · audiencias únicas no sumables':''}`;
   card.append(e('small','gi-kpi-state',value==null?'Datos incompletos':report.freshness!=='FRESH'?'Histórico':report.range.partial?'Provisional':'Actualizado'));
   (index<4?primary:secondary).append(card);
  });root.append(primary,secondary);
 }
 function funnel(root,report,onStage){
  const card=section('Embudo de rendimiento','LANDING → CARRITO → CHECKOUT → COMPRA · eventos atribuidos agregados'),grid=e('div','gi-funnel');
  const data=report.growth?.funnel;
  const steps=data?.stages||[['landingPageViews','Landing'],['addToCart','Carrito'],['initiateCheckout','Checkout'],['purchases','Compra']].map(([key,label])=>({key,label,value:report.totals[key],rate:null,state:'INSUFFICIENT'}));
  for(const stage of steps.filter(s=>['landingPageViews','addToCart','initiateCheckout','purchases'].includes(s.key))){
   const b=button('',()=>onStage?.(stage.key));b.className='gi-stage '+(stage.state==='DETERIORATED'?'deteriorated':'');b.title=stage.reason||'Ratio agregado, no recorrido único';
   b.append(e('span','',stage.label),e('strong','',format(stage.value)),e('small','',stage.rate==null?'Sin evidencia suficiente':`${format(stage.rate)} % sobre etapa anterior`),e('small','',stage.rateChangePercent==null?'Sin comparación válida':`${format(stage.rateChangePercent)} % de variación del ratio`));grid.append(b);
  }
  card.append(grid,e('p','gi-muted',data?.note||'Esperando validación de denominadores, poblaciones y etapas. No se inventan pérdidas.'));
  const detail=e('details');detail.append(e('summary','','Impresiones, clics y calidad de etapas'));for(const s of steps)detail.append(e('p','',`${s.label}: ${format(s.value)} · coste ${format(s.cost,'spend')} · ${s.reason||s.state||'observado'}`));card.append(detail);root.append(card);
 }
 function chart(root,report){
  const c=section('Evolución del rendimiento','Una métrica por eje · actual y anterior cuando son compatibles'),select=e('select');select.setAttribute('aria-label','Métrica de evolución');
  for(const key of ['spend','purchases','roas','cpa','addToCart','costPerCart','initiateCheckout','linkCtr','linkCpc']){const option=e('option','',labels[key]);option.value=key;select.append(option);}
  const graph=e('div','gi-trend-chart');let metric='roas';select.value=metric;
  function draw(){graph.replaceChildren();const trend=report.growth?.trend;
   const dates=[...new Set(report.rows.flatMap(r=>r.series.map(d=>d.since)))].sort();
   const fallback=dates.map(day=>{const rows=report.rows.filter(r=>r.source==='META_INSIGHTS').map(r=>r.series.find(d=>d.since===day));const sum=k=>rows.length&&rows.every(r=>r&&Number.isFinite(r[k]))?rows.reduce((n,r)=>n+r[k],0):null;const ratios={roas:['purchaseValue','spend',1],cpa:['spend','purchases',1],costPerCart:['spend','addToCart',1],linkCtr:['linkClicks','impressions',100],linkCpc:['spend','linkClicks',1]};let value=sum(metric);if(ratios[metric]){const [a,b,m]=ratios[metric],num=sum(a),den=sum(b);value=num!==null&&den>0?num/den*m:null;}return {day,metrics:{[metric]:value}};});
   const current=trend?.current||fallback,previous=trend?.previous||[],values=[...current,...previous].map(d=>d.metrics?.[metric]).filter(Number.isFinite);
   if(!values.length){graph.append(e('p','gi-empty','Serie incompleta o preparándose. No se dibujan ceros ficticios.'));return;}
   const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 760 250');svg.setAttribute('role','img');svg.setAttribute('aria-label','Evolución de '+labels[metric]);
   const max=Math.max(...values,1),count=Math.max(current.length,previous.length,2),x=i=>48+i/(count-1)*680,y=v=>205-v/max*170;
   for(let i=0;i<4;i++){const line=document.createElementNS(ns,'path');line.setAttribute('d',`M48 ${35+i*56}H730`);line.setAttribute('stroke','#e8eff8');line.setAttribute('fill','none');svg.append(line);const text=document.createElementNS(ns,'text');text.setAttribute('x','2');text.setAttribute('y',String(39+i*56));text.setAttribute('font-size','10');text.setAttribute('fill','#7991ad');text.textContent=format(max*(1-i/3),metric);svg.append(text);}
   for(const [rows,color,dashed]of [[previous,'#a2b4d4',true],[current,'#2187f6',false]]){let d='',connected=false;rows.forEach((row,i)=>{const v=row.metrics?.[metric];if(!Number.isFinite(v)){connected=false;return;}d+=`${connected?'L':'M'}${x(i)} ${y(v)} `;connected=true;const dot=document.createElementNS(ns,'circle'),title=document.createElementNS(ns,'title');dot.setAttribute('cx',x(i));dot.setAttribute('cy',y(v));dot.setAttribute('r','3');dot.setAttribute('fill',color);dot.setAttribute('tabindex','0');title.textContent=`${dashed?'Anterior':'Actual'} ${row.day}: ${format(v,metric)}`;dot.append(title);svg.append(dot);});const path=document.createElementNS(ns,'path');path.setAttribute('d',d);path.setAttribute('fill','none');path.setAttribute('stroke',color);path.setAttribute('stroke-width','2.8');if(dashed)path.setAttribute('stroke-dasharray','6 5');svg.append(path);}
   for(const marker of trend?.markers||[]){const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(marker.at));const index=current.findIndex(r=>r.day===day);if(index<0)continue;const p=document.createElementNS(ns,'path'),title=document.createElementNS(ns,'title');p.setAttribute('d',`M${x(index)} 20V210`);p.setAttribute('stroke','#d7aa43');p.setAttribute('stroke-dasharray','3 4');title.textContent=day+' · cambio de presupuesto, contexto sin causalidad acreditada';p.append(title);svg.append(p);}
   graph.append(svg,e('p','gi-muted',`${labels[metric]} · ${report.range.since} → ${report.range.until}. Azul: actual; discontinua: anterior. ${trend?.note||'Esperando el histórico compartido.'}`),e('p','gi-muted',trend?.budgetNote||''));
  }
  select.addEventListener('change',()=>{metric=select.value;draw();});c.append(select,graph);draw();root.append(c);
 }
 function decisionCard(item,context){
  const card=e('article','gi-decision '+item.status.toLowerCase());card.append(e('span','gi-pill',states[item.status]||item.status),e('h4','',item.name),e('p','gi-muted',`${item.level==='campaign'?'Campaña':item.level==='adset'?'Conjunto':'Anuncio'}${item.adsetName?' · '+item.adsetName:''} · prioridad ${item.priority??'N/D'} · confianza ${item.confidence==='MEDIUM'?'media':'baja'}`),e('p','',item.why));
  const m=item.evidence?.week||{},metrics=e('div','gi-decision-metrics');for(const key of ['spend','purchases','roas','cpa','addToCart'])metrics.append(e('span','',`${labels[key]} ${format(m[key],key)}`));
  const range=item.evidence?.ranges?.week||context?.selectedRange;card.append(metrics,e('small','gi-muted',range?`${range.since} → ${range.until} · histórico completo`:'Periodo no acreditado'),button('VER ANÁLISIS',()=>GrowthAnalysisDrawer.open(item.id,item.level,context?.query||{}),true));return card;
 }
 function decisions(root,value,query){const card=section('CEREBRO META · DECISIONES DEL DÍA','Qué mantener, qué mejorar y dónde invertir mejor, según rendimiento e histórico.');
  card.append(e('p','gi-muted',`Decisiones: ${value.historyAnchor} · ${value.temporalStatus==='HISTORICAL_CONTEXT'?'contexto histórico, sin acciones actuales':'contexto actual'} · reglas ${value.version} · supervisión V5.1`));
  const grid=e('div','gi-decisions');for(const item of value.decisions.topActions)grid.append(decisionCard(item,{...value,query}));
  if(!value.decisions.topActions.length)grid.append(e('p','gi-empty','Sin evidencia suficiente para priorizar intervenciones. Se conserva la información disponible.'));
  card.append(grid);const all=e('details','gi-all-decisions');all.append(e('summary','','VER TODAS LAS RECOMENDACIONES'));
  const table=e('div','gi-entity-list');for(const item of [...value.decisions.campaigns,...value.decisions.adsets,...value.decisions.ads]){const row=e('article');row.append(e('strong','',item.name),e('span','',states[item.status]||item.status),button('Ver análisis',()=>GrowthAnalysisDrawer.open(item.id,item.level,query)));table.append(row);}all.append(table);card.append(all);root.append(card);
 }
 function goal(root,value){const g=value.goal,c=section('OBJETIVO SULEIA','Objetivos: 55 pedidos iniciales y 40 confirmados al día. No son cifras actuales ni promesas.');
  const grid=e('div','gi-goal-grid');for(const [label,v,target]of [['Pedidos de hoy',g.today?.orders,55],['Confirmados de pedidos de hoy',g.today?.confirmedFromTodayCohort,40],['Eventos de confirmación hoy',g.today?.confirmationEventsToday,null],['Confirmación en cohortes maduras',g.mature?.confirmationRate==null?null:g.mature.confirmationRate*100,null]]){const box=e('article');box.append(e('span','',label),e('strong','',format(v)+(label.startsWith('Confirmación en')&&v!=null?' %':'')));if(target)box.append(e('small','',`Objetivo ${target} · ${v==null?'N/D':format(v/target*100)+' %'}`));grid.append(box);}c.append(grid);
  c.append(e('p','gi-muted',g.today?.note||'Sin datos comerciales conectados.'));
  if(g.mature)c.append(e('p','gi-muted',`Cohorte ${g.mature.range?.since} → ${g.mature.range?.until} · ${g.mature.orders} pedidos · madurez mínima ${g.mature.maturityDays} días · duplicidad ${g.mature.duplicateAssessment}.`));
  for(const scenario of g.scenarios||[])c.append(e('p','',`${({conservative:'Conservador',central:'Central',favorable:'Favorable'}[scenario.key])}: confirmación ${format(scenario.confirmationRate*100)} % → ${format(scenario.requiredOrders)} pedidos necesarios para 40 confirmados.`));
  c.append(e('p','gi-muted',g.scenarioNote||'Muestra madura insuficiente para escenarios.'),e('p','gi-muted','CPA sostenible: N/D. '+g.budgetReason));root.append(c);
 }
 function measurement(root,value){const c=section('Calidad de medición · Pixel y CAPI',value.measurement.state==='ANOMALOUS'?'Señales anómalas para investigar':'Medición parcial · evidencia de eventos individuales no disponible');
  c.append(e('p','',value.measurement.capi.reason),e('p','',value.measurement.next),e('p','gi-muted','Shopify: pedidos y sesiones de checkout son poblaciones diferentes. La causa de una discrepancia no queda acreditada por los agregados.'));
  if(value.measurement.issues.length)c.append(e('p','gi-warning',value.measurement.issues.map(i=>i.code+' · '+i.entityId).join(' · ')));root.append(c);
 }
 function dashboard(root,report,query,hooks){
  root.classList.add('growth-v10');kpis(root,report);
  const visual=e('div','gi-visual-grid'),funnelRoot=e('div'),trendRoot=e('div');hooks.chart(trendRoot);visual.append(trendRoot,funnelRoot);root.append(visual);
  funnel(funnelRoot,report,key=>hooks.stage(key));
  const brain=e('div','gi-growth-area');brain.append(e('p','gi-loading','Preparando histórico y decisiones con el lector compartido…'));root.append(brain);
  const controller=new AbortController();
  AdsReportClient.load('/api/operations/ads-intelligence/review/growth?'+new URLSearchParams(contextQuery(query)),{signal:controller.signal,onStatus:d=>{if(root.contains(brain))brain.replaceChildren(e('p','gi-loading','El histórico sigue preparándose; los indicadores disponibles permanecen visibles.'));}})
    .then(value=>{if(!root.contains(brain))return;report.growth=value;brain.replaceChildren();funnelRoot.replaceChildren();trendRoot.replaceChildren();chart(trendRoot,report);funnel(funnelRoot,report,key=>hooks.stage(key));decisions(brain,value,query);goal(brain,value);measurement(brain,value);
    const linked=new URLSearchParams((location.hash||'').split('?')[1]||'');if(/^\d+$/.test(linked.get('entityId')||'')&&['campaign','adset','ad'].includes(linked.get('entityLevel')))GrowthAnalysisDrawer.open(linked.get('entityId'),linked.get('entityLevel'),query);
   }).catch(error=>{if(error.name!=='AbortError'&&root.contains(brain))brain.replaceChildren(e('p','gi-warning','El análisis histórico no está disponible. Los indicadores y etapas disponibles se conservan; reintenta Actualizar.'));});
  return ()=>controller.abort();
 }
 return {dashboard,kpis,chart,format,labels,states,button,section,spark,funnel,decisionCard,contextQuery};
})();
