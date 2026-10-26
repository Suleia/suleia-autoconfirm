/* Premium presentation over the existing authenticated Campaign Review Agent. */
const GrowthIntelligencePanel=(()=>{
 const labels={spend:'Gasto',roas:'ROAS atribuido',purchases:'Compras atribuidas',cpa:'CPA atribuido',impressions:'Impresiones',reach:'Alcance',frequency:'Frecuencia',cpm:'CPM',linkCtr:'CTR de enlace',linkCpc:'CPC de enlace',outboundClicks:'Clics salientes',linkClicks:'Clics en enlace',landingPageViews:'Landing views',addToCart:'Añadidos al carrito',costPerCart:'Coste por carrito',initiateCheckout:'Checkout',costPerCheckout:'Coste por checkout',purchaseValue:'Valor de compras',dailyBudgetCents:'Presupuesto activo observado',averageOrderValue:'Valor medio de compra (AOV)'};
 const states={CANDIDATA_ESCALAR:'Candidata a escalar',PROTEGER:'Proteger',MANTENER:'Mantener',MANTENER_VIGILAR:'Mantener',MEJORAR_CREATIVIDAD:'Mejorar creatividad',MEJORAR_CONVERSION:'Mejorar conversión',INVESTIGAR:'Investigar',REVISAR_REDUCCION:'Revisar reducción',REVISAR_PAUSA:'Revisar pausa',DATOS_INSUFICIENTES:'Datos insuficientes',INACTIVA:'Inactiva'};
 const moneyKeys=new Set(['spend','cpa','cpm','linkCpc','costPerCart','costPerCheckout','purchaseValue','dailyBudgetCents','averageOrderValue']);
 const format=(v,k='')=>v===null||v===undefined||!Number.isFinite(Number(v))?'N/D':new Intl.NumberFormat('es-ES',{maximumFractionDigits:2,...(moneyKeys.has(k)?{style:'currency',currency:'EUR'}:{})}).format(k==='dailyBudgetCents'?v/100:v)+(k==='linkCtr'?' %':k==='roas'?'×':'');
 const e=(tag,cls='',value)=>node(tag,cls,value);
 const button=(label,fn,primary=false)=>{const b=e('button',primary?'gi-button primary':'gi-button',label);b.type='button';b.addEventListener('click',fn);return b;};
 const contextQuery=q=>Object.fromEntries(Object.entries(q).filter(([k])=>['period','since','until','level','campaignId','campaignIds','adsetId','adId','productId','compareSince','compareUntil'].includes(k)));
 const section=(title,subtitle)=>{const s=e('section','gi-card');if(title)s.append(e('h3','',title));if(subtitle)s.append(e('p','gi-muted',subtitle));return s;};
 const pathIcon={spend:'M5 6h14v12H5zM8 3h10v3M14 11h5',roas:'M4 16 9 11l4 3 7-9M15 5h5v5',purchases:'M2 3h3l2 12h11l3-9H6M8 20h.1M17 20h.1',cpa:'M8 8a4 4 0 1 0 8 0 4 4 0 1 0-8 0M5 21v-3a7 7 0 0 1 14 0v3',default:'M4 19V9M10 19V4M16 19V12M21 19V2'};
 Object.assign(pathIcon,{impressions:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12ZM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8',reach:'M4 21v-3a5 5 0 0 1 10 0v3M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8M17 4a3 3 0 0 1 0 6M18 14a4 4 0 0 1 3 4v3',frequency:'M5 5h12l3 4M20 4v5h-5M19 19H7l-3-4M4 20v-5h5',cpm:'M4 19V9M10 19V4M16 19V12M21 19V2',linkCtr:'m6 3 13 9-7 1-3 7-3-17ZM14 15l5 5',linkCpc:'m10 14 4-4M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0',outboundClicks:'M13 3h8v8M21 3 9 15M9 4H4v16h16v-5',landingPageViews:'M3 5h18v15H3zM3 9h18M7 6h.1M10 6h.1',addToCart:pathIcon.purchases,costPerCart:pathIcon.purchases,initiateCheckout:'M4 5h16v14H4zM4 9h16M7 14h4',costPerCheckout:'M4 5h16v14H4zM4 9h16M7 14h4',purchaseValue:'M5 7h14l2 14H3L5 7ZM8 8V6a4 4 0 0 1 8 0v2',dailyBudgetCents:'M3 6h18v14H3zM3 10h18M15 14h3M6 3h12'});
 function icon(key){const box=e('span','gi-icon'),svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),p=document.createElementNS(svg.namespaceURI,'path');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.8');svg.setAttribute('aria-hidden','true');p.setAttribute('d',pathIcon[key]||pathIcon.default);svg.append(p);box.append(svg);return box;}
 function spark(values,cls=''){
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 100 36');svg.setAttribute('class','gi-spark '+cls);svg.setAttribute('aria-hidden','true');
  const valid=values.filter(Number.isFinite);if(valid.length<2)return svg;const min=Math.min(...valid),max=Math.max(...valid),span=max-min||1;
  let d='',connected=false;values.forEach((v,i)=>{if(!Number.isFinite(v)){connected=false;return;}d+=`${connected?'L':'M'}${i/Math.max(1,values.length-1)*96+2},${32-(v-min)/span*27} `;connected=true;});
  const p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',d);p.setAttribute('fill','none');p.setAttribute('stroke','currentColor');p.setAttribute('stroke-width','2');svg.append(p);return svg;
 }
 function dailyPoints(report){
  if(report.accountSeries?.current)return report.accountSeries.current.map(metrics=>({day:metrics.since,complete:true,scope:'PROVIDER_ACCOUNT',metrics}));
  const dates=[...new Set(report.rows.flatMap(r=>(r.series||[]).map(d=>d.since)))].sort();
  return dates.map(day=>{
   const rows=report.rows.filter(r=>r.source==='META_INSIGHTS').map(r=>(r.series||[]).find(d=>d.since===day));
   const sum=k=>rows.length&&rows.every(r=>r&&Number.isFinite(r[k]))?rows.reduce((n,r)=>n+r[k],0):null;
   const metrics={};for(const k of ['spend','purchases','purchaseValue','impressions','linkClicks','outboundClicks','landingPageViews','addToCart','initiateCheckout'])metrics[k]=sum(k);
   for(const [key,[a,b,scale]]of Object.entries({roas:['purchaseValue','spend',1],cpa:['spend','purchases',1],averageOrderValue:['purchaseValue','purchases',1],linkCtr:['linkClicks','impressions',100],linkCpc:['spend','linkClicks',1],cpm:['spend','impressions',1000],costPerCart:['spend','addToCart',1],costPerCheckout:['spend','initiateCheckout',1]}))metrics[key]=metrics[a]!==null&&metrics[b]>0?metrics[a]/metrics[b]*scale:null;
   metrics.reach=rows.length===1?rows[0]?.reach??null:null;metrics.frequency=rows.length===1?rows[0]?.frequency??null:null;
   return {day,metrics};
  });
 }
 function comparisonFor(report,key,value,before,partial=false){
  const conversion=['roas','cpa','purchases','purchaseValue','averageOrderValue'].includes(key);
  const compatible=!partial&&report.comparison.comparable&&(!conversion||report.totals.purchaseType===report.previous.purchaseType);
  return compatible&&Number.isFinite(value)&&Number.isFinite(before)&&before>0?(value-before)/before*100:null;
 }
 function changeTone(key,change){const costs=['cpa','linkCpc','costPerCart','costPerCheckout','cpm'].includes(key),benefit=['roas','purchases','linkCtr','purchaseValue','averageOrderValue','linkClicks','impressions','reach','landingPageViews'].includes(key);return change===null||change===0||(!costs&&!benefit)?'neutral':(costs?change<0:change>0)?'favorable':'adverse';}
 function kpis(root,report,{compact=false}={}){
  const partial=report.totals.scope!=='PROVIDER_ACCOUNT'&&report.subtotal?.state==='PARTIAL'&&report.subtotal.metrics,totals={...(partial?{...report.subtotal.metrics,dailyBudgetCents:report.totals.dailyBudgetCents,reach:null,frequency:null}:report.totals)},previous={...report.previous};
  totals.averageOrderValue=Number.isFinite(totals.purchaseValue)&&totals.purchases>0?totals.purchaseValue/totals.purchases:null;
  previous.averageOrderValue=Number.isFinite(previous.purchaseValue)&&previous.purchases>0?previous.purchaseValue/previous.purchases:null;
  if(partial)root.append(e('p','gi-subtotal',`Subtotal verificado: ${report.subtotal.included} de ${report.subtotal.total} entidades. Comparación no disponible.`));
  const keys=compact?['spend','roas','purchases','cpa','linkCtr','linkCpc','reach','purchaseValue','linkClicks','averageOrderValue','impressions','addToCart']:['spend','roas','purchases','cpa','impressions','reach','frequency','cpm','linkCtr','linkCpc','outboundClicks','landingPageViews','addToCart','costPerCart','initiateCheckout','costPerCheckout','purchaseValue','dailyBudgetCents'];
  const primary=e('div',compact?'gi-kpis gi-reference-kpis':'gi-kpis gi-primary-kpis'),secondary=e('div','gi-kpis gi-secondary-kpis'),points=(report.growth?.trend?.current||dailyPoints(report)).map(p=>({...p,metrics:{...p.metrics,averageOrderValue:Number.isFinite(p.metrics?.purchaseValue)&&p.metrics?.purchases>0?p.metrics.purchaseValue/p.metrics.purchases:null}}));
  keys.forEach((key,index)=>{
   const card=e('article',`gi-kpi gi-tone-${index%4}`);card.setAttribute('data-metric',key);
   if(key==='comparison'){
    const copy=e('div','gi-period-summary');copy.append(e('strong','','Comparativa de periodo'));
    for(const metric of ['spend','purchases','roas','cpa']){const delta=comparisonFor(report,metric,totals[metric],previous[metric],partial),row=e('div');row.append(e('span','',labels[metric]),e('strong','gi-change '+changeTone(metric,delta),delta===null?'N/D':`${delta>=0?'↑ +':'↓ −'}${format(Math.abs(delta))} %`));copy.append(row);}
    card.append(icon('default'),copy);primary.append(card);return;
   }
   const value=totals[key],before=previous[key],change=comparisonFor(report,key,value,before,partial),tone=changeTone(key,change);
   const copy=e('div','gi-kpi-copy');copy.append(e('span','gi-label',labels[key]),e('strong','gi-value',format(value,key)),e('small','gi-change '+tone,change===null?'Sin comparación válida':`${change>=0?'↑ +':'↓ −'}${format(Math.abs(change))} %`));
   if(change!==null)copy.append(e('small','gi-previous',`vs. ${format(before,key)}`));
   const mini=spark(points.map(p=>p.metrics[key]));mini.setAttribute('data-series-metric',key);
   card.append(icon(key==='averageOrderValue'?'purchaseValue':key),copy,mini);
   const coverage=report.totals.coverage?.[key]?.status||(value==null?'UNAVAILABLE':'DERIVED');
   card.title=`${labels[key]} · ${report.range.since} → ${report.range.until} · ${report.observedAt} · ${coverage}${['reach','frequency'].includes(key)?(report.totals.scope==='PROVIDER_ACCOUNT'?' · ámbito único de cuenta devuelto por Meta':' · audiencias únicas no sumables; selecciona una entidad'):''}${key==='addToCart'?' · eventos atribuidos de añadir al carrito; no son artículos únicos ni unidades de producto':''}${key==='averageOrderValue'?' · valor de compras atribuido / compras atribuidas; no equivale al AOV de Shopify':''}${key==='dailyBudgetCents'?' · inventario observado, sin revalidación del ejecutor':''}`;
   if(!compact||value==null||partial||report.freshness!=='FRESH'||report.range.partial)card.append(e('small','gi-kpi-state',value==null?(['reach','frequency'].includes(key)?'Selecciona una entidad':'No disponible'):partial?'Subtotal parcial':report.freshness!=='FRESH'?'Histórico':report.range.partial?'Provisional':key==='dailyBudgetCents'?'Observado · sin revalidación':'Actualizado'));
   (compact||index<4?primary:secondary).append(card);
  });root.append(primary);if(!compact)root.append(secondary);
 }
 function funnel(root,report,onStage){
  const card=section('Embudo de rendimiento','LANDING → CARRITO → CHECKOUT → COMPRA · eventos atribuidos agregados'),grid=e('div','gi-funnel');
  const data=report.growth?.funnel;
  const steps=data?.stages||[['landingPageViews','Landing'],['addToCart','Carrito'],['initiateCheckout','Checkout'],['purchases','Compra']].map(([key,label])=>({key,label,value:report.totals[key],rate:null,state:'INSUFFICIENT'}));
  for(const stage of steps.filter(s=>['landingPageViews','addToCart','initiateCheckout','purchases'].includes(s.key))){
   const b=button('',()=>onStage?.(stage.key));b.className='gi-stage '+(stage.state==='DETERIORATED'?'deteriorated':'');b.title=stage.reason||'Ratio agregado, no recorrido único';
   b.append(e('span','',stage.label),e('strong','',format(stage.value)),e('small','',stage.rate==null?'Sin evidencia suficiente':`${format(stage.rate)} % sobre etapa anterior`),e('small','',stage.rateChangePercent==null?'Sin comparación válida':`${format(stage.rateChangePercent)} % de variación del ratio`),e('small','',`Coste ${format(stage.cost,'spend')}`));grid.append(b);
  }
  card.append(grid);
  const detail=e('details');detail.append(e('summary','','Calidad de etapas y denominadores'),e('p','gi-muted',data?.note||'Esperando validación de denominadores, poblaciones y etapas. No se inventan pérdidas.'));for(const s of steps)detail.append(e('p','',`${s.label}: ${format(s.value)} · coste ${format(s.cost,'spend')} · ${s.reason||s.state||'observado'}`));card.append(detail);root.append(card);
 }
 function chart(root,report){
  const c=section('Evolución del rendimiento'),head=e('div','gi-section-head'),legend=e('div','gi-chart-legend'),graph=e('div','gi-trend-chart');
  c.classList.add('gi-performance');const active=new Set(['spend','purchases','roas']),colors={spend:'#2387ff',purchases:'#08c49b',roas:'#9147ff'};
  const select=e('select');select.setAttribute('aria-label','Métrica de evolución');for(const [v,l]of [['combined','Gasto, compras y ROAS'],...['spend','purchases','roas','cpa','addToCart','costPerCart','initiateCheckout','linkCtr','linkCpc'].map(k=>[k,labels[k]])]){const o=e('option','',l);o.value=v;select.append(o);}select.value='combined';
  function draw(){
   graph.replaceChildren();const trend=report.growth?.trend,current=trend?.current||dailyPoints(report),previous=trend?.previous||[],metrics=select.value==='combined'?[...active]:[select.value];
   const values=metrics.flatMap(k=>current.map(d=>d.metrics?.[k])).filter(Number.isFinite);
   if(!values.length){graph.append(e('p','gi-empty','La serie aún no está disponible. Los indicadores se conservan.'));return;}
   const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),make=(tag,attrs={})=>{const x=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))x.setAttribute(k,String(v));return x;};
   svg.setAttribute('viewBox','0 0 760 244');svg.setAttribute('role','img');svg.setAttribute('aria-label','Evolución de '+metrics.map(k=>labels[k]).join(', ')+'; cada métrica tiene su propia escala y unidad');
   const left=46,right=metrics.length>1?648:706,bottom=207,top=24,count=Math.max(current.length,2),x=i=>left+i/(count-1)*(right-left);
   for(let i=0;i<5;i++)svg.append(make('path',{d:`M${left} ${top+i*(bottom-top)/4}H${right}`,stroke:'#e8eef8',fill:'none'}));
   const defs=make('defs');svg.append(defs);
   metrics.forEach((metric,index)=>{
    const color=colors[metric]||'#2387ff',max=Math.max(...current.map(p=>p.metrics?.[metric]).filter(Number.isFinite),...((metrics.length===1&&report.comparison.comparable)?previous.map(p=>p.metrics?.[metric]).filter(Number.isFinite):[]),1)*1.08,y=v=>bottom-v/max*(bottom-top);
    const axisX=index===0?left-7:right+10+(index-1)*52;
    const axisLabel=make('text',{x:axisX,y:12,fill:color,'font-size':9,'text-anchor':index===0?'end':'start'});axisLabel.textContent=metric==='spend'?'Gasto (€)':metric==='purchases'?'Compras':metric==='roas'?'ROAS (×)':labels[metric];svg.append(axisLabel);
    for(let i=0;i<5;i++){const t=make('text',{x:axisX,y:top+i*(bottom-top)/4+3,fill:color,'font-size':9,'text-anchor':index===0?'end':'start'});const v=max*(1-i/4);t.textContent=metric==='roas'?format(v,'roas'):metric==='purchases'?format(Math.round(v)):format(v);svg.append(t);}
    const gradient=make('linearGradient',{id:`gi-chart-fill-${metric}`,x1:0,y1:0,x2:0,y2:1});gradient.append(make('stop',{offset:'0%','stop-color':color,'stop-opacity':'.18'}),make('stop',{offset:'100%','stop-color':color,'stop-opacity':'.01'}));defs.append(gradient);
    const drawRows=(rows,dashed)=>{
     let path='',segment=[],segments=[];rows.forEach((row,i)=>{const value=row.metrics?.[metric];if(!Number.isFinite(value)){if(segment.length)segments.push(segment);segment=[];return;}segment.push([x(i),y(value)]);const dot=make('circle',{cx:x(i),cy:y(value),r:3,fill:color,tabindex:0}),title=make('title');title.textContent=`${dashed?'Anterior':'Actual'} ${row.day}: ${format(value,metric)}${row.complete===false?' · subtotal parcial '+row.included+'/'+row.total:''}`;dot.append(title);svg.append(dot);});if(segment.length)segments.push(segment);
     for(const points of segments){path+=points.map(([a,b],i)=>`${i?'L':'M'}${a} ${b}`).join(' ')+' ';if(!dashed&&points.length>1)svg.append(make('path',{d:`M${points[0][0]} ${bottom}L${points.map(p=>p.join(' ')).join('L')}L${points.at(-1)[0]} ${bottom}Z`,fill:`url(#gi-chart-fill-${metric})`,'data-area-metric':metric}));}
     const line=make('path',{d:path,fill:'none',stroke:color,'stroke-width':2.5,'stroke-linejoin':'round','data-metric':metric});if(dashed)line.setAttribute('stroke-dasharray','5 4');svg.append(line);
    };
    if(metrics.length===1&&report.comparison.comparable)drawRows(previous,true);drawRows(current,false);
   });
   for(const [i,row]of current.entries()){if(current.length>14&&i%Math.ceil(current.length/7)&&i!==current.length-1)continue;const t=make('text',{x:x(i),y:232,'font-size':9,fill:'#8090aa','text-anchor':'middle'});t.textContent=row.day.slice(5).split('-').reverse().join('/');svg.append(t);}
   graph.append(svg);if(current.some(p=>p.complete===false))graph.append(e('p','gi-chart-note','Serie parcial: consulta la cobertura de cada punto.'));
   const note=e('small','gi-chart-note',metrics.length>1?'Escalas independientes: € · compras · ROAS. Pasa por los puntos para ver los valores.':'Azul: periodo actual · línea discontinua: periodo anterior comparable.');graph.append(note);
  }
  for(const key of ['spend','purchases','roas']){const b=button((key==='spend'?'Gasto (€)':key==='purchases'?'Compras':'ROAS'),()=>{if(active.has(key)&&active.size===1)return;active.has(key)?active.delete(key):active.add(key);b.setAttribute('aria-pressed',String(active.has(key)));select.value='combined';draw();});b.setAttribute('aria-pressed','true');b.style?.setProperty?.('--series-color',colors[key]);legend.append(b);}
  head.append(legend,select);select.addEventListener('change',draw);c.append(head,graph);draw();root.append(c);
 }
 function decisionCard(item,context){
  const tone=item.status==='CANDIDATA_ESCALAR'?'scale':['MANTENER','MANTENER_VIGILAR','PROTEGER'].includes(item.status)?'keep':['REVISAR_REDUCCION','REVISAR_PAUSA'].includes(item.status)?'reduce':'review';
  const card=e('article','gi-decision '+item.status.toLowerCase()+' gi-decision-'+tone),head=e('div','gi-decision-head');head.append(icon(tone==='scale'?'roas':tone==='reduce'?'cpa':'default'),e('span','gi-pill',states[item.status]||item.status));card.append(head,e('h4','',item.name));
  const why=e('p','gi-decision-why',item.why);why.title=item.why;card.append(why);card.title=`${item.level==='campaign'?'Campaña':item.level==='adset'?'Conjunto':'Anuncio'} · confianza ${item.confidence==='MEDIUM'?'media':'baja'} · ${context?.historyAnchor||''}`;
  card.append(button('Ver análisis →',()=>GrowthAnalysisDrawer.open(item.id,item.level,context?.query||{})));return card;
 }
 function decisions(root,value,query){const card=section('Cerebro Meta · Decisiones del día','Recomendaciones basadas en datos, oportunidades y señales contrastadas.');card.classList.add('gi-brain-card');
  card.title=`Decisiones: ${value.historyAnchor} · ${value.temporalStatus==='HISTORICAL_CONTEXT'?'contexto histórico, sin acciones actuales':'contexto actual'} · reglas ${value.version}`;
  const grid=e('div','gi-decisions'),shown=new Set();for(const item of [...value.decisions.topActions,...value.decisions.campaigns]){const key=item.level+':'+item.id;if(shown.has(key))continue;shown.add(key);grid.append(decisionCard(item,{...value,query}));if(shown.size===4)break;}
  if(!value.decisions.topActions.length)grid.append(e('p','gi-empty',value.progress?.pending?'Preparando la evidencia histórica para las recomendaciones.':'Sin evidencia suficiente para priorizar intervenciones. Se conserva la información disponible.'));
  card.append(grid);const all=e('details','gi-all-decisions');all.append(e('summary','','VER TODAS LAS RECOMENDACIONES'));
  const table=e('div','gi-entity-list');for(const item of [...value.decisions.campaigns,...value.decisions.adsets,...value.decisions.ads]){const row=e('article');row.append(e('strong','',item.name),e('span','',states[item.status]||item.status),button('Ver análisis',()=>GrowthAnalysisDrawer.open(item.id,item.level,query)));table.append(row);}all.append(table);card.append(all);root.append(card);
 }
 function goal(root,value){const g=value.goal,c=section('OBJETIVO SULEIA','Objetivos: 55 pedidos iniciales y 40 confirmados al día. No son cifras actuales ni promesas.');
  if(value.progress?.blocks?.goals==='PREPARING'){c.append(e('p','gi-loading','Preparando las cohortes comerciales con su propia fecha de lectura…'));root.append(c);return;}
  const grid=e('div','gi-goal-grid');for(const [label,v,target]of [['Pedidos de hoy',g.today?.orders,55],['Confirmados de pedidos de hoy',g.today?.confirmedFromTodayCohort,40],['Eventos de confirmación hoy',g.today?.confirmationEventsToday,null],['Confirmación en cohortes maduras',g.mature?.confirmationRate==null?null:g.mature.confirmationRate*100,null]]){const box=e('article');box.append(e('span','',label),e('strong','',format(v)+(label.startsWith('Confirmación en')&&v!=null?' %':'')));if(target)box.append(e('small','',`Objetivo ${target} · ${v==null?'N/D':format(v/target*100)+' %'}`));grid.append(box);}c.append(grid);
  c.append(e('p','gi-muted',g.today?.note||'Sin datos comerciales conectados.'));
  if(g.mature)c.append(e('p','gi-muted',`Cohorte ${g.mature.range?.since} → ${g.mature.range?.until} · ${g.mature.orders} pedidos · madurez mínima ${g.mature.maturityDays} días · duplicidad ${g.mature.duplicateAssessment}.`));
  for(const scenario of g.scenarios||[])c.append(e('p','',`${({conservative:'Conservador',central:'Central',favorable:'Favorable'}[scenario.key])}: confirmación ${format(scenario.confirmationRate*100)} % → ${format(scenario.requiredOrders)} pedidos necesarios para 40 confirmados.`));
  c.append(e('p','gi-muted',g.scenarioNote||'Muestra madura insuficiente para escenarios.'),e('p','gi-muted','CPA sostenible: N/D. '+g.budgetReason));root.append(c);
 }
 function measurement(root,value){const c=section('Calidad de medición · Pixel y CAPI',value.measurement.state==='ANOMALOUS'?'Señales anómalas para investigar':'Medición parcial · evidencia de eventos individuales no disponible');
  c.append(e('p','',value.measurement.capi.reason),e('p','',value.measurement.next),e('p','gi-muted','Shopify: pedidos y sesiones de checkout son poblaciones diferentes. La causa de una discrepancia no queda acreditada por los agregados.'));
  if(value.measurement.issues.length){const groups=new Map();for(const i of value.measurement.issues)groups.set(i.code,(groups.get(i.code)||0)+1);c.append(e('p','gi-warning',`${value.measurement.issues.length} señales de medición en las entidades consultadas. Comprueba su cobertura antes de decidir.`));const details=e('details','gi-technical');details.append(e('summary','','Ver señales y referencias técnicas'));for(const [code,count]of groups)details.append(e('p','',`${code}: ${count}`));for(const i of value.measurement.issues)details.append(e('small','',`${i.code} · ${i.entityId}`));c.append(details);}root.append(c);
 }
 function dashboard(root,report,query,hooks){
  root.classList.add('growth-v10','gi-reference');const indicators=e('div','gi-overview-indicators');kpis(indicators,report,{compact:true});root.append(indicators);
  const visual=e('div','gi-visual-grid'),funnelRoot=e('div'),trendRoot=e('div');hooks.chart(trendRoot);visual.append(trendRoot,funnelRoot);root.append(visual);
  funnel(funnelRoot,report,key=>hooks.stage(key));
  const brain=e('div','gi-growth-area');brain.append(e('p','gi-loading','Preparando histórico y decisiones con el lector compartido…'));root.append(brain);
  const controller=new AbortController();
  let previewRendered=false;const apply=value=>{if(!root.contains(brain))return;const progressKey=JSON.stringify([value.progress?.blocks,value.observedAt,value.failures]);if(value.progress?.pending&&previewRendered===progressKey)return;previewRendered=value.progress?.pending?progressKey:false;report.growth=value;indicators.replaceChildren();kpis(indicators,report,{compact:true});brain.replaceChildren();funnelRoot.replaceChildren();trendRoot.replaceChildren();chart(trendRoot,report);funnel(funnelRoot,report,key=>hooks.stage(key));decisions(brain,value,query);const more=e('details','gi-more-insights');more.append(e('summary','','Métricas adicionales, objetivos y calidad de medición'));kpis(more,report);goal(more,value);measurement(more,value);brain.append(more);if(value.progress?.pending||value.failures?.length)brain.prepend(e('p','gi-loading',value.progress?.pending?'Histórico en preparación; el resumen y el embudo ya están disponibles.':'Parte del histórico no está disponible; se conservan los datos verificados.'));
  };
  AdsReportClient.load('/api/operations/ads-intelligence/review/growth?'+new URLSearchParams(contextQuery(query)),{signal:controller.signal,onProgress:apply,onStatus:d=>{if(root.contains(brain)&&!previewRendered)brain.replaceChildren(e('p','gi-loading','El histórico sigue preparándose; los indicadores disponibles permanecen visibles.'));}})
    .then(value=>{apply(value);if(!root.contains(brain))return;if(value.clientWaitExpired||value.failures?.length)brain.append(button('Reintentar histórico',async()=>{previewRendered=false;try{apply(await AdsReportClient.load('/api/operations/ads-intelligence/review/growth?'+new URLSearchParams({...contextQuery(query),retry:'true'}),{signal:controller.signal,onProgress:apply}));}catch{brain.prepend(e('p','gi-warning','El bloque histórico sigue sin estar disponible.'));}}));
    const linked=new URLSearchParams((location.hash||'').split('?')[1]||'');if(/^\d+$/.test(linked.get('entityId')||'')&&['campaign','adset','ad'].includes(linked.get('entityLevel')))GrowthAnalysisDrawer.open(linked.get('entityId'),linked.get('entityLevel'),query);
   }).catch(error=>{if(error.name!=='AbortError'&&root.contains(brain))brain.replaceChildren(e('p','gi-warning','El análisis histórico no está disponible. Los indicadores y etapas disponibles se conservan; reintenta Actualizar.'));});
  return ()=>controller.abort();
 }
 return {dashboard,kpis,chart,dailyPoints,format,labels,states,button,section,spark,funnel,decisionCard,contextQuery,icon};
})();
