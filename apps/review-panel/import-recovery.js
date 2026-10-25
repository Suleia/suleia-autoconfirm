/* Isolated read-only view: never executes imports, corrections, templates or claims. */
const ImportRecoveryPanel=(()=>{
 const labels={ADDRESS_RECOVERY_REQUIRED:'Pendiente de validar',SHADOW_OBSERVE:'Observación de fallos registrados',WAITING_CUSTOMER:'Esperando dirección del cliente',WAITING_CUSTOMER_ADDRESS:'Esperando dirección del cliente',AUTO_CORRECTED:'Dirección corregida y verificada',REIMPORT_PENDING:'Pendiente de recuperar',IMPORT_VERIFIED:'Importación verificada',ALREADY_IMPORTED:'Ya existe en Dropea',VERIFY_EXISTING_ADDRESS:'Revisar dirección del pedido existente',MANUAL_REVIEW:'Necesita revisión',RECONCILE_BEFORE_RETRY:'Conciliar antes de actuar',OUT_OF_SCOPE:'Fuera de recuperación de dirección',EXISTING_HANDLING:'Conserva el manejo actual',SUPERSEDED:'Sustituido por un fallo posterior',END:'Finalizado',NO_CARRIER_FOR_ADDRESS:'Sin servicio de transporte para la dirección',POSTAL_CODE_NOT_COVERED:'Dropea rechaza la cobertura',ADDRESS_LINES_TOO_LONG:'Dirección demasiado larga',CARRIER_COVERAGE_REVIEW:'Revisar cobertura con el transportista',ENABLE_DROPEA_IMPORT:'Reimportación todavía desactivada',ENABLE_SHOPIFY_WRITE:'Corrección todavía desactivada'};
 const label=v=>labels[v]||'Revisión del expediente';
 const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n;};
 function render(root,data){
   root.replaceChildren();const h=el('header','panel-heading');h.append(el('h2','','Import Recovery'));root.append(h);
   if(!data?.available){root.append(el('p','notice','La recuperación de importaciones no está activada en este panel.'));return;}
   root.append(el('p','queue-source',`${data.mode==='SHADOW'?'SHADOW · solo observación de fallos':'Recuperación por pedido'} · Corte: ${new Date(data.observedAt).toLocaleString('es-ES')}`));
   if(data.stale)root.append(el('p','notice','La lectura tiene más de 90 minutos. Actualiza el estado antes de dar un caso por recuperado.'));
   const metrics=el('div','summary-grid');for(const[k,l]of [['pending','Pendientes'],['address_import_failures','Fallos de dirección'],['auto_corrected','Corregidos'],['customer_required','Necesitan cliente'],['recovered','Recuperados'],['manual_review','Revisión'],['duplicates_prevented','Duplicados evitados']]){const card=el('article','summary-card');card.append(el('small','',l),el('strong','',data.metrics[k]));metrics.append(card);}root.append(metrics);
   const scope=el('label','','Mostrar '),select=el('select');for(const[k,l]of [['pending','Pendientes'],['all','Todos los fallos registrados']]){const o=el('option','',l);o.value=k;select.append(o);}scope.append(select);root.append(scope);
   const list=el('div','ir-case-list');root.append(list);
   const draw=()=>{list.replaceChildren();const rows=data.items.filter(r=>select.value==='all'||!r.resolved_at);
     if(!rows.length){list.append(el('p','','No hay expedientes en este filtro.'));return;}
     for(const r of rows){const card=el('article','ir-case');card.append(el('strong','',`Shopify ${r.shopify_order_id}`),el('span','',label(r.failure_code)),el('span','',label(r.address_status)),el('p','',label(r.next_action)));if(r.last_error)card.append(el('p','notice',label(r.last_error)));list.append(card);}
   };select.value='pending';select.addEventListener('change',draw);draw();
 }
 async function load(){try{const data=await api('/api/operations/import-recovery');state.importRecovery=data;render($('import-recovery-view'),data);}catch{$('import-recovery-view').replaceChildren(el('p','notice','No se pudo leer Import Recovery. No se muestra cero como si fuera una lectura válida.'));}}
 function card(data,onOpen){const b=el('button','summary-card','');b.type='button';b.append(el('small','','Errores de importación'),el('strong','',data?.available&&!data.stale?`${data.metrics.pending} pendientes`:'Lectura pendiente'),el('small','','Abrir Import Recovery'));b.addEventListener('click',onOpen);return b;}
 return {render,load,card};
})();
