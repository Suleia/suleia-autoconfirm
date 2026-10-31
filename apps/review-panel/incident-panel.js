/* Incident presentation consumes the same canonical projection as counters. */
const IncidentPanel=(()=>{
  const types={RECIPIENT_ABSENT:['No se encontró al destinatario','Ausente','rose','warning'],REFUSED_BY_RECIPIENT:['Rechazado por destinatario','Rechazo','orange','return'],ADDRESS_INCORRECT:['Dirección incompleta','Dirección','blue','task'],PENDING_DATA:['Faltan datos de entrega','Faltan datos','amber','task'],PICKUP_AT_AGENCY:['Paquete en agencia','Agencia','violet','package'],NO_RESPONSE:['Sin respuesta del cliente','No respuesta','gray','message']};
  const tones={WAITING_CUSTOMER:'amber',CUSTOMER_RESPONDED:'green',HUMAN_REVIEW:'rose',SIMULATION_READY:'green',LOGISTICS_VALIDATION_REQUIRED:'blue',RESCHEDULE_REQUESTED:'blue',PICKUP_REQUESTED:'violet'};
  const icon=(kind,tone='blue')=>{const n=node('span',`ip-icon ${tone}`);n.append(recoveryIcon(kind));return n;};
  const badge=(label,tone)=>node('span',`ip-badge ${tone}`,label);
  const copy=(primary,secondary='')=>{const n=node('div','ip-copy');n.append(node('strong','',primary));if(secondary)n.append(node('small','',secondary));return n;};
  function pickupCard(g){
    const providerExplanations={GLS_TRACKING_PROVIDER_DENIED:'GLS ha rechazado la consulta del seguimiento; falta verificar disponibilidad e importe.',GLS_TRACKING_STILL_LOADING:'GLS no ha terminado de mostrar los datos del envío.'};
    const reasons={OFFICIAL_TRACKING_DATA_NOT_VERIFIABLE:'No se ha podido verificar la disponibilidad y el importe en el seguimiento oficial.',DIRECT_AGENCY_PHONE_NOT_VERIFIED:'Falta un teléfono directo de la agencia; el contacto general de GLS no lo sustituye.',MISSING_VERIFIED_AGENCY_DATA:'Faltan datos verificados de la agencia, como el horario o el teléfono directo.',WAITING_FOR_PICKUP_AVAILABILITY:'El paquete todavía no figura disponible para recoger.',PACKAGE_NOT_READY:'La recogida todavía no está disponible.',GLS_AGENCY_CONFLICT:'La agencia del seguimiento y la del buscador no coinciden.',EXACT_TEMPLATE_NOT_APPROVED:'La plantilla exacta aún no está aprobada.',WAITING_COD_RECONCILIATION:'Hay que conciliar el importe pendiente con el descuento y el transportista.',CYCLE_BUDGET_DEFERRED:'Se comprobará en el próximo ciclo.',CUSTOMER_CARE_REVIEW_REQUIRED:'La respuesta del cliente requiere la revisión del sistema de atención existente.',EXACT_CONVERSATION_NOT_AVAILABLE:'Falta verificar la conversación exacta de este pedido.',PICKUP_FRESH_READ_UNAVAILABLE:'El proveedor no ha permitido completar la lectura actual.',GLS_TRACKING_RATE_LIMITED:'GLS ha pedido esperar antes de consultar de nuevo.',READ_ONLY_RECONCILIATION_REQUIRED:'Se está verificando el envío anterior; no se repetirá.',EXISTING_CUSTOMER_CARE_OWNS_REPLY:'El cliente ha respondido; su gestión corresponde a Atención al cliente.'};
    const labels={PICKUP_DETECTED:'Pendiente de comprobar',GLS_LOOKUP_PENDING:'Buscando agencia GLS',GLS_AGENCY_FOUND:'Agencia verificada',WAITING_FOR_PICKUP_AVAILABILITY:'Esperando disponibilidad del paquete',TEMPLATE_PENDING_APPROVAL:'Esperando aprobación de plantilla',READY_TO_NOTIFY:'Aviso 1 preparado',SEND_CLAIMED:'Envío reservado',SEND_UNKNOWN:'Envío incierto: no repetir',SENT_PROVIDER_ACCEPTED:'Aviso 1 aceptado por proveedor',MESSAGE_VERIFIED:'Aviso 1 verificado',WAITING_CUSTOMER:'Esperando respuesta',GLS_AGENCY_CONFLICT:'Agencias en conflicto',WAITING_COD_RECONCILIATION:'Esperando importe contra reembolso',MANUAL_REVIEW:'Revisión manual',CLOSED:'Seguimiento cerrado'};
    const card=node('details','ip-resolution gls-pickup-notice');card.append(node('summary','',`GLS · ${labels[g.state]||'Pendiente de comprobar'}`));card.addEventListener('click',e=>e.stopPropagation());
    const a=g.agency||{},fresh=Date.now()-Date.parse(g.report_at)<3600000&&Date.parse(g.report_at)<=Date.now();card.style.overflowWrap='anywhere';
    for(const [name,value]of [['Estado',labels[g.state]||g.state],['Actualización',fresh?'Comprobación reciente':'Requiere nueva comprobación'],['Modo',g.mode],['Plantilla',g.template_status],['Agencia',a.agency_name],['Dirección',a.address_line],['Localidad',[a.postal_code,a.city,a.province].filter(Boolean).join(' · ')],['Horario',a.opening_hours],['Teléfono de la agencia',a.phone],['Fuente',a.source_url],['Verificación',a.validated_at?incidentDate(a.validated_at):null],['Importe verificado',Number.isSafeInteger(g.amount_cents)?(g.amount_cents/100).toLocaleString('es-ES',{style:'currency',currency:'EUR'}):'Pendiente de conciliar'],['Recibo Chatby / WAMID',g.wamid],['Bloqueo',g.reason],['Revisión',incidentDate(g.observed_at)]])if(value)card.append(node('small','',name+': '+value));
    if(g.reason&&reasons[g.reason])card.append(node('small','',reasons[g.reason]));
    if(g.reason&&providerExplanations[g.reason])card.append(node('small','',providerExplanations[g.reason]));
    if(g.lookup_reason&&reasons[g.lookup_reason])card.append(node('small','',reasons[g.lookup_reason]));
    if(g.sent_at)card.append(node('small','',`Fecha del aviso: ${incidentDate(g.sent_at)}`));
    card.append(node('small','','El aviso no confirma recogida ni resuelve la incidencia.'));return card;
  }
  function customerCareCard(c){
    const card=node('details','ip-resolution customer-care-context');card.append(node('summary','',`Contexto de atención · ${c.mode||'SHADOW'}`));
    if(c.next_best_action==='HUMAN_REVIEW')card.open=true;
    card.addEventListener('click',event=>event.stopPropagation());
    const labels={WAITING_CUSTOMER:'Esperar al cliente',WAITING_PROVIDER:'Esperar al proveedor',RESPOND:'Preparar respuesta',DELEGATE:'Delegar al workflow responsable',HUMAN_REVIEW:'Revisión humana'};
    for(const [label,value]of [
      ['Intención actual',(c.intents||[]).join(' + ')||'Por verificar'],
      ['Quiere recibirlo',c.wants_order===true?'Sí':c.wants_order===false?'No':'Por verificar'],
      ['Datos conocidos',[(c.known_slots||[]).join(', '),c.delivery_date,({MORNING:'Mañana',AFTERNOON:'Tarde'})[c.delivery_window],c.time_from?'Desde '+c.time_from:null,c.time_to?'Hasta '+c.time_to:null,c.call_before_arrival?'Llamar antes':null].filter(Boolean).join(' · ')||'Sin datos verificados'],
      ['Datos faltantes',(c.missing_slots||[]).join(' · ')||'Ninguno adicional'],
      ['Última pregunta',[c.last_question_type,c.last_question_at?incidentDate(c.last_question_at):null].filter(Boolean).join(' · ')||'Ninguna verificada'],
      ['Siguiente paso',labels[c.next_best_action]||c.next_best_action||'Por verificar'],['Responsable',c.owner||'HUMAN'],
      ...(c.version==='CONVERSATION_V3'?[
        ['Datos anteriores',(c.superseded_fact_types||[]).join(' · ')||'Ninguno'],
        ['Acción operativa',c.operational_action||'NONE'],['Respuesta al cliente',c.customer_reply_action||'NONE'],
        ['Confianza por dato',Object.entries(c.confidence||{}).map(([k,v])=>`${k}: ${Math.round(v*100)}%`).join(' · ')||'Por verificar'],
        ['Motivos de la decisión',(c.decision_reason_codes||[]).join(' · ')||c.reason||'Por verificar']
        ,['Preguntas del cliente pendientes',(c.pending_question_types||[]).join(' · ')||'Ninguna registrada'],
        ['Cuestiones respondidas con recibo',(c.answered_question_types||[]).join(' · ')||'Ninguna verificada'],
        ['Hechos del proveedor/sistema',(c.verified_fact_types||[]).join(' · ')||'Sin evidencia registrada'],
        ['Datos ambiguos',[...(c.ambiguous_fact_types||[]),...(c.unresolved||[])].join(' · ')||'Ninguno registrado'],
        ['Producto',c.product?[c.product.name,c.product.units?c.product.units+' unidad(es)':null].filter(Boolean).join(' · '):'Identidad o fuente por verificar'],
        ['Importe verificado en la lectura',Number.isSafeInteger(c.observed_verified_amount_cents)?(c.observed_verified_amount_cents/100).toLocaleString('es-ES',{style:'currency',currency:'EUR'})+' · '+incidentDate(c.amount_verified_at):'Pendiente de lectura verificada'],
        ['Descuento',c.discount_state||'Sin aplicación verificada'],
        ['Última respuesta contextual',c.last_contextual_outbound?[c.last_contextual_outbound.type,c.last_contextual_outbound.sender,incidentDate(c.last_contextual_outbound.at),c.last_contextual_outbound.readback_verified?'Lectura posterior verificada':'Sin verificación posterior'].filter(Boolean).join(' · '):'Sin recibo contextual verificado'],
        ['Repeticiones bloqueadas registradas',String(c.blocked_duplicate_findings||0)],
        ['Calidad / reconciliación',[c.interpretation_quality,c.reconciliation_state].filter(Boolean).join(' · ')||'Por verificar']
      ]:[]),
      ['Esperando a',c.waiting_for_customer?'Cliente':c.waiting_for_provider?'Proveedor':'Workflow responsable'],
      ['Última acción verificada',c.last_verified_action?.action||'Ninguna'],['Motivo',c.reason||'Por verificar']
    ])card.append(node('small','',label+': '+value));
    const timeline=(c.timeline||[]).map(t=>[t.kind,t.fact_type,(t.intents||[]).join(' + '),t.action,t.owner].filter(Boolean).join(' · ')).join(' → ');
    if(timeline)card.append(node('small','',`Cronología: ${timeline}`));
    card.append(node('small','ip-date',`Revisión · ${incidentDate(c.updated_at)} · conversación v${c.conversation_version??'—'}`));return card;
  }
  function row(item){
    const d=item.dashboard,r=item.recovery||{},e=r.evidence||{},type=types[item.interpreted_type]||['Incidencia por revisar','Otros','gray','warning'];
    const tr=node('tr','ip-row');tr.tabIndex=0;tr.setAttribute('aria-label',`Abrir incidencia ${item.dropea_issue_id}`);
    const order=node('div','ip-order');order.append(icon('package','gray'),copy(item.external_order_reference || `#${item.dropea_order_id || '—'}`,'INCIDENCIA'));
    order.children[1].append(node('small','ip-date',incidentDate(item.created_at)));
    const issue=copy(type[0]);issue.append(badge(type[1],type[2]),node('small','',`${d.attempt==='FIRST_ABSENCE'?'Intento 1':d.attempt==='SECOND_ABSENCE'?'Intento 2':d.attempt?'Intento no verificable':`#${item.dropea_issue_id}`} · ${d.priority<=2?'Riesgo alto':d.priority===3?'Riesgo medio':'Revisión pendiente'}`));
    const name=(item.customer_name||'Cliente no disponible').replace(/\s*-\s*$/,'').trim(),customer=node('div','ip-customer');
    customer.append(node('span','ip-avatar',name==='Cliente no disponible'?'?':name.split(/\s+/).slice(0,2).map(s=>s[0]).join('').toUpperCase()),copy(name));
    const evidence=node('div',`ip-evidence ${e.valid_response?'green':e.customer_interacted?'blue':'gray'}`);
    const message=e.message || e.action_label;
    const acceptance=item.manual_discount,discountReviewReason=item.resolution_observation?.human_review_reason;
    const discountReview=['ACCEPTED_DISCOUNT_INCIDENT_REOPENED','ACCEPTED_DISCOUNT_SUPPORT_RECONCILIATION_REQUIRED'].includes(discountReviewReason);
    const evidenceTitle=e.message_type==='IMAGE' && e.customer_interacted?'Imagen recibida':message?message:e.valid_response?'Evidencia verificada':e.no_action_verified?'Sin evidencia':'Chatby no verificable';
    const evidenceDetail=message?(e.message_type==='BUTTON'?'Botón / acción':e.valid_response?'Respuesta verificada':'Respuesta no concluyente'):e.no_action_verified?'Ninguna acción realizada':e.reason==='INCIDENT_NOTIFICATION_NOT_OBSERVED'?'Aviso de esta incidencia no verificado':'Lectura de conversación no verificable';
    if(e.message_type==='IMAGE' && e.customer_interacted)evidence.append(icon('package','gray'));
    const evidenceText=copy(evidenceTitle,evidenceDetail);evidenceText.title=message||evidenceDetail;
    if(e.customer_interacted && e.response_at)evidenceText.append(node('small','ip-date',`Chatby · ${incidentDate(e.response_at)} · ${Date.parse(e.response_at)>Date.parse(item.created_at)?'tras la apertura':Date.parse(e.response_at)<=Date.parse(item.created_at)?'anterior o simultánea a esta incidencia':'relación temporal por verificar'}`));
    if(acceptance){evidenceText.append(badge(acceptance.label,'amber'),node('small','ip-date',`Aceptación · ${incidentDate(acceptance.accepted_at)}`));}
    evidence.append(evidenceText,node('span','ip-chevron','›'));
    if(item.resolution_observation?.conversation_v3||item.resolution_observation?.customer_care)evidenceText.append(customerCareCard(item.resolution_observation.conversation_v3||item.resolution_observation.customer_care));
    const action=node('div','ip-action'),stale=d.action==='Actualizar evidencia';
    const title=stale?({REFUSED_BY_RECIPIENT:'Revisar evidencia de rechazo',ADDRESS_INCORRECT:'Revalidar la dirección',RECIPIENT_ABSENT:'Revalidar aviso de ausencia',PICKUP_AT_AGENCY:'Verificar recogida en agencia'}[item.interpreted_type]||d.action):d.action;
    action.append(icon(d.flags.WAITING_CUSTOMER?'clock':type[3],d.flags.WAITING_CUSTOMER?'amber':type[2]),copy(title,stale?'Fuentes pendientes de validar':d.action_detail));
    if(item.autonomy){const box=action.children[1];box.children[0].textContent=item.next_best_action.label;box.children[1].textContent=item.next_best_action.reason;const chip=badge(item.autonomy.label,item.autonomy.status==='AUTOMATIC'?'green':item.autonomy.status==='PREPARED'?'amber':'rose');chip.className+=' autonomy-chip';chip.title=item.next_best_action.blocking_reasons.join(' · ');box.append(chip);}
    const timer=r.timer||{},timerTone=timer.state==='EXPIRED'?'rose':timer.state==='ACTIVE'?timer.remaining_seconds<=10800?'amber':'green':'gray';
    const timerBox=node('div',`ip-timer ${timerTone}`);timerBox.append(icon('clock',timerTone),copy(timer.state==='ACTIVE'?recoveryDuration(timer.remaining_seconds):timer.state==='EXPIRED'?'Plazo vencido':'Plazo no verificable',timer.deadline?incidentDate(timer.deadline):'Sin temporizador confirmado'));
    const result=node('div','ip-result');const label=d.flags.WAITING_CUSTOMER?'Esperando cliente':d.flags.SIMULATION_READY?'Simulación preparada':d.flow==='CUSTOMER_RESPONDED'?'Cliente respondió':d.flow==='LOGISTICS_VALIDATION_REQUIRED'?'Validar logística':d.flow==='RESCHEDULE_REQUESTED'?'Nueva entrega':d.flow==='PICKUP_REQUESTED'?'Recogida en agencia recomendada':d.flags.HUMAN_REVIEW?e.valid_response?'Revisión humana':'Evidencia no concluyente':item.is_active?'Pendiente de revisión':'Histórico';
    if(item.resolution_observation?.gls_pickup)result.append(pickupCard(item.resolution_observation.gls_pickup));
    result.append(badge(label,tones[d.flow]||'gray'),node('small','',d.flags.SIMULATION_READY?'Lista para simular':d.blocking_reasons?.length||d.flags.HUMAN_REVIEW?'Acción bloqueada':item.is_active?'No ejecutable todavía':'Sin acción vigente'));
    if(acceptance)result.append(badge(acceptance.label,'amber'),node('small','',discountReview?'Revisar el correo anterior y el importe contra reembolso':acceptance.pending?'Comprobar estado del descuento y de soporte':'Revisar estado actual antes de actuar'));
    if(item.execution)result.append(node('small','',`${item.execution.action_label || 'Última acción'}: ${item.execution.label}`));
    if(item.resolution_observation){
      const o=item.resolution_observation;
      const details=node('details','ip-resolution'),heading=node('summary','','Plan de resolución');details.append(heading);
      const current=Date.now()-Date.parse(o.observed_at)<45*60000&&Date.parse(o.observed_at)<=Date.now()&&!(Date.parse(item.latest_private_customer_message_at)>Date.parse(o.observed_at))&&item.is_active===true;
      if(item.is_active===true && (o.customer_replied||discountReview) && o.verification_status!=='VERIFIED' && (o.current_owner==='HUMAN'||o.human_review_reason)){
        const reason=o.human_review_reason||o.capability_blocker||'REVIEW_REQUIRED';
        const explanations={
          CUSTOMER_RESPONSE_REQUIRES_REVIEW:['La respuesta no permite identificar una instrucción segura.','Revisar el mensaje y decidir la gestión o la aclaración necesaria.'],
          DELIVERY_DATE_AND_WINDOW_REQUIRED:['Falta una fecha o franja inequívoca.','Obtener del cliente el día y la franja de entrega.'],
          REQUESTED_DELIVERY_DATE_EXPIRED:['La fecha solicitada ya ha pasado.','Solicitar una fecha nueva; no reutilizar la anterior.'],
          REQUESTED_DELIVERY_WINDOW_EXPIRED:['La franja solicitada ya ha terminado.','Solicitar un nuevo día y franja.'],
          CAPABILITY_RELEASE_GATE:['La versión desplegada necesita validar las pruebas de resolución.','Validar la versión y su control de activación; no pedir de nuevo datos al cliente.'],
          CAPABILITY_SHADOW:['La acción identificada no está habilitada para ejecución automática.','Revisar su capacidad o tramitar el caso manualmente.'],
          CAPABILITY_RESERVED_OR_UNCERTAIN:['Hay una ejecución anterior pendiente de comprobar.','Verificar Dropea antes de repetir cualquier acción.'],
          CAPABILITY_NOT_ALLOWED:['Dropea no permite la acción solicitada.','Revisar las opciones disponibles con el transportista.'],
          DISCOUNT_ECONOMIC_MUTATION_CONTRACT_UNAVAILABLE:['El descuento aceptado no tiene aplicación económica verificada.','Comprobar el importe contra reembolso con soporte.'],
          INTENT_CHANGED_AFTER_ACTION_RECONCILE:['El cliente cambió su respuesta después de una gestión.','Comprobar qué se ejecutó antes de atender la nueva instrucción.'],
          ACCEPTED_DISCOUNT_INCIDENT_REOPENED:['El correo a soporte y la solución anteriores corresponden a otra incidencia de este pedido. La nueva incidencia sigue pendiente.','Validar la instrucción actual del cliente y comprobar el importe contra reembolso antes de resolverla. No repetir el correo anterior; el descuento no consta aplicado por ese envío.'],
          ACCEPTED_DISCOUNT_SUPPORT_RECONCILIATION_REQUIRED:['Hay una aceptación de descuento registrada en el pedido, pero falta conciliar la gestión de soporte con la incidencia actual.','Revisar si el correo y la solución anteriores pertenecen a otra incidencia, validar la instrucción actual del cliente y comprobar el importe contra reembolso. No repetir el correo mientras se comprueba la gestión anterior.']
        };
        const [why,next]=explanations[reason]||['No hay una solución automática validada con la evidencia disponible.','Revisar el mensaje y el bloqueo; verificar cualquier gestión anterior antes de actuar.'];
        const alert=node('div','ip-human-review');alert.setAttribute('role','note');
        const heading=discountReview?reason==='ACCEPTED_DISCOUNT_INCIDENT_REOPENED'?'Incidencia reabierta · descuento pendiente de comprobar':'Descuento aceptado · conciliación de soporte pendiente':'Necesita tu decisión · el cliente ha respondido';
        const eventLabel=discountReview?'Aceptación registrada en el pedido':'Respuesta',eventAt=discountReview?acceptance?.accepted_at||o.customer_event_at:o.customer_event_at||e.response_at;
        alert.append(node('strong','',heading),node('p','',`Motivo: ${why}`),node('p','',`Qué falta: ${next}`),node('small','',`${eventLabel}: ${incidentDate(eventAt)} · Revisión: ${incidentDate(o.observed_at)}`),node('small','',current?'Evidencia vigente':'Actualizar evidencia antes de decidir'),node('small','',`Referencia: ${reason}`));
        result.prepend?result.prepend(alert):result.append(alert);
      }
      for(const [label,value] of [['Observación',current?'Vigente':'Actualizar evidencia'],[discountReview?'Respuesta de esta incidencia':'Cliente respondió',discountReview?'Comprobar instrucción actual; la aceptación registrada pertenece al pedido':o.customer_replied?'Sí':'No verificado'],['Intención',(o.customer_intents||[]).join(' + ')],['Plan',(o.resolution_plan?.steps||[]).map(s=>`${s.action} [${s.status}]`).join(' → ')],['Siguiente acción',o.next_best_action||(o.explicit_wait_until?'WAIT':'HUMAN_REVIEW')],['Responsable',o.current_owner],['Esperando a',o.timer_state?.waiting_for],['Límite',o.timer_state?.deadline?incidentDate(o.timer_state.deadline):'—'],['Ejecución',o.execution_status],['Verificación',o.verification_status],['Resultado logístico',o.logistics_outcome],['Bloqueo',o.human_review_reason||o.capability_blocker||'Ninguno observado']])details.append(node('small','',`${label}: ${value||'—'}`));
      details.addEventListener('click',event=>event.stopPropagation());details.addEventListener('keydown',event=>event.stopPropagation());result.append(details);
    }
    const priority=badge(`P${d.priority}`,`priority-${d.priority}`);priority.title=d.priority_reason;
    tr.append(...[order,issue,customer,evidence,action,timerBox,result,priority].map(n=>cell(n,'ip-cell')));
    tr.addEventListener('click',()=>openDetail(item.canonical_issue_id));tr.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openDetail(item.canonical_issue_id);}});return tr;
  }
  function head(){const tr=node('tr');for(const [label,key] of [['Pedido','order'],['Incidencia','incident'],['Cliente','customer'],['Evidencia cliente',null],['Siguiente acción',null],['Timer','timer'],['Resultado',null],['Prioridad','priority']]){
    const th=node('th');if(key){const button=node('button','ip-sort',`${label} ↕`);button.type='button';th.setAttribute('aria-sort',state.filters.sort===key?state.filters.direction==='desc'?'descending':'ascending':'none');button.addEventListener('click',()=>{state.filters.direction=state.filters.sort===key&&state.filters.direction!=='desc'?'desc':'asc';state.filters.sort=key;state.offset=0;head();loadQueue();});th.append(button);}else th.textContent=label;tr.append(th);}$('table-head').replaceChildren(tr);}
  function filters(root){
    const data=state.summary.incidents,d=data.dashboard,historical=state.filters.scope==='HISTORICAL';
    const resolution=node('div','incident-filter-actions');
    for(const [value,label] of [['replied_unresolved','Cliente respondió sin resolver'],['stuck','Atascadas'],['prepared','Acción preparada']]){
      const b=node('button',`filter-chip ${state.filters.resolution===value?'active':''}`,label);b.type='button';b.addEventListener('click',()=>{state.filters.resolution=state.filters.resolution===value?'':value;state.offset=0;loadQueue();});resolution.append(b);
    }root.append(resolution);
    $('view-title').textContent='Panel de incidencias';
    const searchRoot=$('incident-search-bar'),search=node('input','ip-search');search.type='search';search.placeholder='Buscar pedido, incidencia o cliente…';search.setAttribute('aria-label',search.placeholder);search.value=state.filters.q||'';
    const submit=()=>{state.filters.q=search.value.trim();state.offset=0;loadQueue();};search.addEventListener('change',submit);search.addEventListener('keydown',e=>{if(e.key==='Enter')submit();});searchRoot.replaceChildren(icon('search','gray'),search);
    const toolbar=node('div','incident-filter-toolbar'),tabs=node('div','incident-scope-tabs');
    for(const [value,label,active] of [['ACTIVE','Pendientes actuales',!historical],['HISTORICAL','Consultar histórico',historical]]){const b=node('button',`filter-chip ${active?'active':''}`,label);b.type='button';b.setAttribute('aria-pressed',String(active));b.addEventListener('click',()=>{state.filters={scope:value};state.offset=0;loadQueue();});tabs.append(b);}
    const controls=node('div','incident-filter-actions');for(const [label,cls,run] of [['Limpiar filtros','secondary-button',()=>{state.filters={scope:historical?'HISTORICAL':'ACTIVE'};}],['Aplicar filtros','primary-button',()=>{}]]){const b=node('button',cls,label);b.type='button';b.addEventListener('click',()=>{run();state.offset=0;loadQueue();});controls.append(b);}toolbar.append(tabs,controls);root.append(toolbar);
    const manual=node('div','autonomy-tabs');
    for(const [value,label] of [['pending',`Descuentos aceptados · acción manual (${data.manual_discounts?.pending??0})`],['accepted','Ver aceptaciones registradas']]){const b=node('button',`filter-chip ${state.filters.manual_discount===value?'active':''}`,label);b.type='button';b.addEventListener('click',()=>{state.filters={scope:historical?'HISTORICAL':'ACTIVE',manual_discount:value};state.offset=0;loadQueue();});manual.append(b);}root.append(manual);
    const fields=node('div','incident-filter-grid');
    if(data.autonomy){const stats=node('div','autonomy-tabs');stats.append(badge(`Preparadas · ${data.autonomy.prepared}`,'amber'),badge(`Acciones verificadas · ${data.autonomy.verified}`,'green'));stats.title='Acciones verificadas no implica resolución autónoma sin intervención humana';root.append(stats);}
    const autonomy=node('div','autonomy-tabs');autonomy.setAttribute('aria-label','Autonomía');for(const [value,label]of [['','Todas'],['AUTOMATIC','Automáticas'],['WAITING','Esperando'],['PREPARED','Preparadas'],['HUMAN_REVIEW','Necesitan mi atención']]){const b=node('button',`filter-chip ${state.filters.autonomy===value?'active':''}`,label);b.type='button';b.setAttribute('aria-pressed',String((state.filters.autonomy||'')===value));b.addEventListener('click',()=>{state.filters.autonomy=value;state.offset=0;loadQueue();});autonomy.append(b);}root.append(autonomy);
    const definitions=[['scope','Alcance',historical?[['HISTORICAL','Histórico']]:[['ACTIVE',`Pendientes de resolver (${d.scope_counts.ACTIVE})`],['FOLLOWUP',`Seguimiento (${d.scope_counts.FOLLOWUP})`]]],['type','Tipo de incidencia',d.chips.type.map(c=>[c.value,c.label])],['response','Estado cliente',[['VALID_ACTION','Respuesta válida'],['INCONCLUSIVE_INTERACTION','Respuesta no concluyente'],['NO_ACTION','Sin respuesta verificada'],['NOT_VERIFIABLE','No verificable']]],['automation','Automatización',[['HUMAN_REVIEW','Revisión humana'],['SIMULATION_READY','Simulación preparada'],['WAITING_CUSTOMER','Esperando cliente']]],['month','Tiempo',(data.available_months||[]).map(m=>[m,m])],['risk','Riesgo',[1,2,3,4,5,6].map(n=>[String(n),`P${n}`])],['template','Plantilla',d.templates.map(t=>[t,t])]];
    for(const [key,label,values] of definitions){const field=node('label','incident-filter-field',label),select=node('select','filter-select');select.setAttribute('aria-label',label);if(key!=='scope')select.append(new Option(key==='month'?'Todos los meses':key==='template'?'Todas las plantillas':'Todos',''));for(const [value,title] of values)select.append(new Option(title,value));select.value=state.filters[key]||(key==='scope'?'ACTIVE':'');select.addEventListener('change',()=>{state.filters[key]=select.value;});field.append(select);fields.append(field);}root.append(fields);
    const groups=node('div','incident-chip-groups');for(const [key,label] of [['type','Tipo de incidencia'],['attempt','Intentos de entrega'],['flow','Estado del flujo']]){const group=node('div','incident-chip-group');group.append(node('small','',label));const chips=node('div','incident-chips');for(const c of d.chips[key]){const tone=types[c.value]?.[2]||tones[c.value]||(c.value==='FIRST_ABSENCE'?'blue':c.value==='SECOND_ABSENCE'?'violet':'orange');const b=node('button',`filter-chip ip-chip ${tone} ${state.filters[key]===c.value?'active':''}`,`${c.label} · ${c.count}`);b.type='button';b.setAttribute('aria-pressed',String(state.filters[key]===c.value));b.addEventListener('click',()=>{state.filters[key]=state.filters[key]===c.value?'':c.value;state.offset=0;loadQueue();});chips.append(b);}group.append(chips);groups.append(group);}root.append(groups);
    if(historical){const range=node('div','ip-date-range');for(const [key,label] of [['from','Desde'],['to','Hasta']]){const field=node('label','incident-date-field',label),input=node('input','filter-select');input.type='date';input.value=state.filters[key]||'';input.addEventListener('change',()=>{state.filters[key]=input.value;});field.append(input);range.append(field);}root.append(range);}
    head();
  }
  return {row,head,filters};
})();
