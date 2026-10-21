const CommandCenterPanel=(()=>{
 const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n;};
 async function mount(root){
   if(!state.config?.command_center_enabled)return;
   const section=el('section','cc-overview'),head=el('header','cc-heading');
   head.append(el('div','', 'SULEIA · CENTRO DE MANDO'),el('h2','','Estado y decisiones del asistente'));
   section.append(head);root.append(section);
   try{
     const d=await api('/api/operations/command-center');
     if(!section.isConnected)return;
     const grid=el('div','cc-grid');
     for(const [title,value,detail]of[
       ['Modo',d.mode.startsWith('SHADOW')?'Solo lectura'+(d.mode.includes('PRUEBA LOCAL')?' · PRUEBA LOCAL':''):d.mode,'Escrituras Meta desactivadas'],
       ['Control de gasto',`${money(d.limits.maxBudgetCents===null?null:d.limits.maxBudgetCents/100)}/día por campaña`,`${d.limits.maxChangePercent}% máximo por cambio`],
       ['Informes automáticos',d.notificationsEnabled?'Activados':'Desactivados','El informe ejecutivo se pide desde Telegram'],
       ['Inteligencia comercial',d.trendtrack.connected?'Conectada':'Pendiente de conexión',`${d.trendtrack.creditsConsumed} créditos consumidos`]
     ]){const c=el('article','cc-card');c.append(el('span','cc-muted',title),el('strong','',value),el('small','cc-muted',detail));grid.append(c);}
     section.append(grid);
     const cols=el('div','cc-columns'),sources=el('article','cc-card');sources.append(el('h3','','Fuentes y actualización'));
     for(const s of d.connections){const row=el('p','cc-source');row.append(el('strong','',s.source),el('span',s.status==='FRESH'?'cc-good':'cc-warning',({FRESH:'Actualizada',STALE:'Desactualizada',UNKNOWN:'Sin verificar'})[s.status]||'Requiere revisión'),el('small','',s.observedAt?date(s.observedAt):'Sin fecha verificable'));sources.append(row);}
     if(!d.connections.length)sources.append(el('p','cc-warning','No hay conexiones verificables en esta consulta.'));
     const brief=el('article','cc-card');brief.append(el('h3','','Último informe ejecutivo'));
     if(d.latestBrief){brief.append(el('p','cc-muted',date(d.latestBrief.observedAt)));for(const p of d.latestBrief.priorities||[])brief.append(el('p','',p.evidence),el('small','cc-muted',p.action));}
     else brief.append(el('p','cc-muted','Escribe «¿Cómo va Suleia hoy?» en Telegram para preparar el primer informe.'));
     cols.append(sources,brief);section.append(cols);
     const history=el('article','cc-card');history.append(el('h3','','Propuestas e historial'));
     for(const p of d.proposals.slice(0,10))history.append(el('p','',`${p.id} · ${p.state} · ${p.mode} · ${date(p.expiresAt)}`));
     if(!d.proposals.length)history.append(el('p','cc-muted','Todavía no hay propuestas. Cada administrador consulta sus decisiones desde Telegram con «Mis decisiones».'));
     section.append(history,el('p','cc-muted','Las propuestas usan el ejecutor existente. Cada confirmación pertenece a su autor; el historial no autoriza nuevas acciones.'));
   }catch{if(section.isConnected)section.append(el('p','cc-warning','El centro de mando no está disponible. No se muestran cifras sin verificar.'));}
 }
 return {mount};
})();
