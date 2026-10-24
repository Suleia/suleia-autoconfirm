const ExecutiveReportPanel=(()=>{
 let generation=0;
 const button=(label,fn,primary=false)=>{const b=node('button',primary?'ai-primary':'ai-secondary',label);b.type='button';b.addEventListener('click',fn);return b;};
 const plain=s=>String(s||'').replace(/<\/?b>/g,'').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
 function messageText(text){const p=node('pre','executive-text');let target=p;for(const token of String(text).split(/(<\/?b>)/)){if(token==='<b>'){const b=node('strong');p.append(b);target=b;}else if(token==='</b>')target=p;else target.append(document.createTextNode(plain(token)));}return p;}

 function dailyDecisionBrief(root,brief){
  if(!brief)return;
  const box=node('section','ai-card rv-card daily-brain'),heading=node('div','daily-brain-heading'),label=node('div');
  label.append(node('span','rv-eyebrow','SULEIA · META DECISION INTELLIGENCE'),node('h3','','Decisiones diarias · Cerebro Meta'));
  heading.append(label,node('span','daily-brain-state',brief.status==='READY'?'Lectura actual':brief.status==='HISTORICAL_ONLY'?'Histórico verificado':'Datos insuficientes'));
  box.append(heading,node('p','ai-footnote','Propuestas de revisión basadas en hasta 7 y 30 días completos. No se desactiva ninguna campaña ni se modifican presupuestos desde esta vista.'));
  const stats=node('div','daily-brain-stats');
  for(const [name,value] of [['Campañas analizadas',brief.summary?.campaigns??0],['Conjuntos / anuncios',String(brief.summary?.adsets??0)+' / '+String(brief.summary?.ads??0)],['Señales para revisar',brief.summary?.requiresReview??0]]){const item=node('div','daily-brain-stat');item.append(node('small','',name),node('strong','',String(value)));stats.append(item);}
  box.append(stats);
  const title={REVISAR_PAUSA:'Revisar posible pausa',REVISAR_REDUCCION:'Revisar reducción',CANDIDATA_ESCALAR:'Potencial de escalado',PROTEGER:'Proteger',MEJORAR_CONVERSION:'Mejorar conversión',MEJORAR_CREATIVIDAD:'Revisar creatividad',INVESTIGAR:'Investigar',MANTENER_VIGILAR:'Mantener y vigilar',DATOS_INSUFICIENTES:'Sin evidencia suficiente',INACTIVA:'Inactiva'};
  const important=node('div','daily-brain-priorities');
  important.append(node('h4','','Acciones prioritarias'));
  if(brief.status==='INSUFFICIENT')important.append(node('p','audit-warning','Los informes no tienen suficiente frescura o compatibilidad para recomendar acciones actuales. Ninguna cifra histórica se presenta como lectura actual.'));
  const actions=brief.topActions||[];
  if(!actions.length)important.append(node('p','ai-empty','No hay actuaciones respaldadas por datos suficientes para esta revisión.'));
  for(const r of actions.slice(0,5)){
   const item=node('article','daily-brain-item'),top=node('div','daily-brain-item-top');
   top.append(node('strong','',r.name),node('span','daily-brain-badge daily-brain-'+String(r.status||'').toLowerCase(),title[r.status]||r.status));
   item.append(top,node('p','daily-brain-context',r.level==='ad'?'Anuncio · '+(r.adsetName||'Conjunto no identificado'):r.level==='adset'?'Conjunto de anuncios':'Campaña'),
    node('p','',r.why),node('p','daily-brain-next',r.next));
   const ev=r.evidence?.week||{};
   const detail=node('p','daily-brain-metrics',`7 días · Gasto ${ev.spend==null?'N/D':Number(ev.spend).toLocaleString('es-ES',{style:'currency',currency:'EUR'})} · Compras ${ev.purchases??'N/D'} · CPA ${ev.cpa==null?'N/D':Number(ev.cpa).toLocaleString('es-ES',{style:'currency',currency:'EUR'})} · ROAS ${ev.roas??'N/D'} · Carritos ${ev.addToCart??'N/D'}`);
   item.append(detail);
   if(r.level==='campaign')item.append(button('Ver análisis',()=>CampaignAuditPanel.open(r.campaignId,{period:'7d'})));
   else item.append(button('Revisar anuncios',()=>CampaignReviewPanel.navigate('creatives',{period:'7d',campaignId:r.campaignId,level:'ad'})));
   important.append(item);
  }
  box.append(important);
  const all=node('details','daily-brain-all');all.append(node('summary','','Todas las campañas y creatividades · clasificación y evidencia'));
  for(const [label,items] of [['Campañas',brief.campaigns||[]],['Conjuntos',brief.adsets||[]],['Anuncios',brief.ads||[]]]){
   all.append(node('h4','',label));
   const wrap=node('div','rv-table-wrap'),table=node('table','ai-table rv-table'),thead=node('thead'),tr=node('tr');
   for(const h of ['Entidad','Decisión','Gasto 7d','Compras','CPA','ROAS','Carritos'])tr.append(node('th','',h));
   thead.append(tr);table.append(thead);
   const tbody=node('tbody');
   for(const r of items){const row=node('tr'),m=r.evidence?.week||{};for(const v of [r.name,title[r.status]||r.status,m.spend==null?'N/D':Number(m.spend).toFixed(2)+' €',m.purchases??'N/D',m.cpa==null?'N/D':Number(m.cpa).toFixed(2)+' €',m.roas??'N/D',m.addToCart??'N/D'])row.append(node('td','',String(v)));tbody.append(row);}
   table.append(tbody);wrap.append(table);all.append(wrap);
  }
  box.append(all,node('p','ai-footnote',(brief.generatedFrom?.week?`Histórico: ${brief.generatedFrom.week.since} → ${brief.generatedFrom.week.until}. `:'')+'Sujeto a atribución tardía, costes reales y política V5.1. Cambios solo mediante ejecutor y aprobación.'));
  root.append(box);
 }

 function reportDetail(root,value){
  root.replaceChildren();root.append(node('h3','','Informe '+(value.body?.targetDate||'')),node('p','',`Estado: ${value.state} · ${value.kind} · ${value.errorCode||'sin error'}`));
  if(!value.body){root.append(node('p','ai-empty','No hay cifras verificadas disponibles todavía.'));return;}
  const body=value.body;root.append(node('p','ai-footnote',`Observación ${body.observedAt||'no disponible'} · Generado ${body.generatedAt} · ${body.dataState} · Motor ${body.ruleVersion||'N/D'}`));
  const actions=node('div','rv-actions');for(const [label,tab]of [['Comparar con ayer','comparator'],['Ver anuncios top','creatives'],['Revisar recomendaciones','opportunities']])actions.append(button(label,()=>CampaignReviewPanel.navigate(tab,{period:tab==='comparator'?'ayer':'7d'})));root.append(actions);
  const campaigns=body.evidence?.today?.inventory?.campaign||body.evidence?.week?.inventory?.campaign||[];
  if(campaigns.length){const select=node('select');select.setAttribute('aria-label','Campaña del informe');for(const c of campaigns){const o=node('option','',c.name);o.value=c.id;select.append(o);}root.append(select,button('Ver análisis de campaña',()=>CampaignAuditPanel.open(select.value,{period:'7d'})));}
  dailyDecisionBrief(root,body.dailyDecisions);
  const messages=node('div','executive-messages');for(const m of body.messages){const p=node('article','ai-card rv-card executive-message');p.dataset.reportPart=m.part;p.append(messageText(m.text));messages.append(p);}root.append(messages);
  const delivery=node('section','ai-card rv-card');delivery.append(node('h3','','Historial de envíos Telegram'));
  if(!value.deliveries.length)delivery.append(node('p','ai-empty',value.kind==='MANUAL'?'La auditoría manual no envía Telegram.':value.dailyEnabled?'Sin envíos registrados. Revisar programación, destinatarios y errores.':'Sin envíos registrados. La activación productiva requiere aprobación.'));
  for(const d of value.deliveries)delivery.append(node('p',/UNKNOWN|SENDING|REJECTED/.test(d.state)?'audit-warning':'',`Usuario ${d.recipient} · Parte ${d.part+1} · ${d.state} · ${d.attempts} intento(s) · Mensaje ${d.message_id||'sin recibo'}${d.code?' · '+d.code:''}`));
  delivery.append(node('p','ai-footnote','SENDING tras interrupción y UNKNOWN requieren reconciliación. No se reenvían automáticamente.'));root.append(delivery);
  const evidence=node('details','ai-card rv-card');evidence.append(node('summary','','Evidencia canónica y comparaciones históricas'),node('p','',`Huella ${body.evidenceDigest} · Cero escrituras Meta`));
  for(const k of ['today','week','month']){const r=body.evidence?.[k];evidence.append(node('h4','',({today:'Auditoría del día / periodo elegido',week:'Comparación semanal',month:'Evolución mensual'}[k])),node('pre','executive-text',r?JSON.stringify({range:r.range,baseline:r.baselineRange,observedAt:r.observedAt,freshness:r.freshness,totals:r.totals,previous:r.previous,changes:r.changes,warnings:r.warnings},null,2):'Fuente no disponible'));}root.append(evidence);
 }
 async function load(root){
  const current=++generation;root.replaceChildren();root.classList.add('rv-view');root.append(node('h2','','Informes y revisiones'),node('p','ai-footnote','El mismo informe y la misma evidencia para el panel y Telegram. Una auditoría manual no envía el informe diario ni cambia presupuestos.'));
  const status=node('p','rv-connection','Consultando programación…'),toolbar=node('div','rv-actions'),period=node('select'),detail=node('section','executive-detail'),list=node('section','ai-card rv-card');period.setAttribute('aria-label','Periodo de auditoría ejecutiva');
  for(const [v,label]of [['hoy','Hoy'],['ayer','Ayer'],...['3','7','14','30','60','90'].map(n=>[n+'d',n+' días completos']),['custom','Personalizado']]){const o=node('option','',label);o.value=v;period.append(o);}
  const from=node('input'),until=node('input');from.type=until.type='date';from.setAttribute('aria-label','Auditoría desde');until.setAttribute('aria-label','Auditoría hasta');from.hidden=until.hidden=true;period.addEventListener('change',()=>from.hidden=until.hidden=period.value!=='custom');
  const active=()=>current===generation&&state.view==='ads'&&root.contains(detail);
  async function open(id,remaining=40){if(!active())return;try{const r=await api('/api/operations/ads-intelligence/executive/'+id);if(!active())return;reportDetail(detail,r);if(r.state==='PREPARING'&&remaining>0)setTimeout(()=>open(id,remaining-1),5000);}catch{detail.replaceChildren(node('p','ai-error','No se pudo consultar el informe. Reintenta; la auditoría no se enviará por Telegram.'));}}
  const generate=button('Generar auditoría ahora',async()=>{generate.disabled=true;try{const query=period.value==='custom'?{since:from.value,until:until.value}:{period:period.value};const r=await api('/api/operations/ads-intelligence/executive/generate',{method:'POST',body:{query}});await open(r.id);await history();}catch{detail.replaceChildren(node('p','ai-error','No se pudo preparar la auditoría. Comprueba fechas y permisos.'));}finally{generate.disabled=false;}},true);
  let latest=null,cursor=null;const more=button('Cargar anteriores',()=>history(true));
  async function history(append=false){try{const h=await api('/api/operations/ads-intelligence/executive/history?'+new URLSearchParams({limit:20,...(append&&cursor?{cursor}:{})}));if(!active())return;status.textContent=`Programación: ${h.time} ${h.timezone} · ${h.enabled?'activada':'preparada, sin activar'} · Próxima ejecución: ${new Date(h.nextExecution).toLocaleString('es-ES',{timeZone:'Europe/Madrid'})} · ${h.recipientsCount} destinatarios configurados`;
   if(!append){list.replaceChildren(node('h3','','Historial de informes diarios y auditorías'));latest=h.entries[0]?.id||null;}
   for(const row of h.entries){const item=node('article','executive-history');item.append(node('strong','',`${date(row.created_at)} · ${row.kind}`),node('span','',`${row.state} · ${row.data_state||'sin corte'}${row.error_code?' · '+row.error_code:''}`),button('Abrir informe',()=>open(row.id)));list.append(item);}
   if(!h.entries.length)list.append(node('p','ai-empty','Todavía no hay informes. Puedes generar una auditoría de lectura.'));cursor=h.nextCursor;more.hidden=!cursor;list.append(more);
  }catch{status.textContent='Historial no disponible. Revisar migración 059 y permisos SQL; no se sustituyen errores por cifras cero.';}}
  toolbar.append(period,from,until,generate,button('Ver último informe',()=>latest?open(latest):history()),button('Actualizar historial',()=>history()));root.append(status,toolbar,list,detail);await history();const linked=new URLSearchParams((location.hash||'').split('?')[1]||'');if(/^[a-f0-9]{64}$/.test(linked.get('reportId')||'')){await open(linked.get('reportId'));const part={overview:0,diagnosis:1,creatives:2,opportunities:3}[linked.get('section')];if(part!==undefined)detail.querySelector('[data-report-part=\"'+part+'\"]')?.scrollIntoView({block:'start'});}
 }
 return {load,renderDecisions:dailyDecisionBrief};
})();
