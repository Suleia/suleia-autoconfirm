const labels={WAIT_FOR_NOTIFICATION:'Esperar envío inicial verificable',WAIT_FOR_CUSTOMER:'Esperar respuesta',OFFER_5_EURO_DISCOUNT:'Ofrecer descuento de 5 €',RETURN_TO_ORIGIN:'Solicitar devolución',CHANGE_ADDRESS:'Cambiar dirección en Dropea',PICKUP_AT_AGENCY:'Solicitar recogida en agencia',PROVIDE_ADDRESS_SOLUTION:'Aportar dirección en Dropea',ASK_MISSING_FIELDS:'Pedir datos de dirección',HUMAN_REVIEW:'Revisar dirección',MANUAL_DISCOUNT_RECOVERY:'Descuento aceptado · acción manual'};
export function addressWorkflowPresentation(base,owner){
 const age=Date.now()-Date.parse(owner?.observed_at),fresh=owner?.workflow==='ADDRESS_INCORRECT'&&age>=0&&age<5*60000;
 const stages={detection:'Detectar',notification:'Aviso nativo',interpretation:'Interpretar',decision:'Decidir',details:'Pedir datos',solution:'Aportar dirección',change_address:'Cambiar dirección',pickup:'Recogida en agencia',offer:'Ofrecer 5 €',return:'Devolución'};
 const cycleAge=Date.now()-Date.parse(owner?.last_cycle_at),healthy=fresh&&cycleAge>=0&&cycleAge<45*60000;
 return {...base,owner:'render_incident_automation',health:healthy?'HEALTHY':fresh?'UNHEALTHY':'UNKNOWN',runtime:owner||null,
  stages:Object.entries(stages).map(([id,label])=>({id,label,mode:fresh?owner.stages?.[id]||null:null,label_mode:fresh?owner.stages?.[id]||'Sin evidencia':'Sin evidencia'})),
  breakers:['details','solution','change_address','pickup','offer','return'].map(id=>({id,label:stages[id],status:fresh?owner.breakers?.[id]:null,label_status:fresh&&owner.breakers?.[id]==='OPEN'?'Abierto':fresh&&owner.breakers?.[id]==='CLOSED'?'Cerrado':'Sin evidencia'})),
  current_activity:fresh?'Plazos desde el envío inicial real: 24 h oferta, 48 h devolución. Una dirección parcial pasa a espera y revisión manual.':'Sin lectura reciente del propietario Render.',
  policy:owner?.policy||null,playbook:['Aviso nativo observado','Leer respuesta actual','Dirección nueva → cambio de dirección permitido; alternativa: aportar solución','Dirección incompleta → pedir datos → revisión manual','Recogida en agencia → comprobar permiso y solicitar','Sin respuesta válida → 24 h oferta → 48 h devolución','Descuento aceptado → gestión manual']};
}
export function addressIncidentPresentation(item){
 const d=item.address_observation;if(!d||item.interpreted_type!=='ADDRESS_INCORRECT')return item;
 const age=Date.now()-Date.parse(d.read_at),fresh=age>=0&&age<20*60000;
 const last=Date.parse(d.last_customer_at||d.notification_at||'');
 const newer=Boolean(item.latest_private_customer_message_at)&&(!Number.isFinite(last)||Date.parse(item.latest_private_customer_message_at)>last);
 const action=fresh&&!newer?d.action:'HUMAN_REVIEW',manual=['HUMAN_REVIEW','MANUAL_DISCOUNT_RECOVERY'].includes(action);
 const execution=d.execution||{},verified=execution.verified===true;
 const reason=d.state==='WAITING_DETAILS_MANUAL_REVIEW'?'Dirección incompleta: espera de datos y revisión manual; los plazos iniciales de descuento y devolución quedan anulados.':!fresh||newer?'La decisión necesita una lectura actualizada.':d.initial_milestones?'El cliente ha respondido; los plazos iniciales quedan anulados.':'Plazos desde el envío real de la plantilla inicial.';
 return {...item,canonical_workflow:'ADDRESS_INCORRECT',
  autonomy:{status:manual?'HUMAN_REVIEW':'PREPARED',label:manual?'Revisión':'Preparado'},
  next_best_action:{action,label:labels[action]||labels.HUMAN_REVIEW,reason,confidence:fresh&&!newer?'Alta':'No verificable',execution_mode:'Consultar etapa',blocking_reasons:manual?[reason]:['Sujeto a modo, permisos y relectura del ejecutor']},
  execution:{...item.execution,status:verified?'VERIFIED':execution.status==='EXECUTION_UNKNOWN'?'UNKNOWN':'NOT_STARTED',label:verified?'Verificado':execution.status==='EXECUTION_UNKNOWN'?'No verificable':'Sin ejecución verificada',requested_at:execution.attempted_at||execution.attemptedAt||execution.sentAt,verified_at:execution.verified_at||execution.completedAt||null},
  autonomous_state:{code:verified?'EXECUTION_VERIFIED':manual?'HUMAN_REVIEW_REQUIRED':action.startsWith('WAIT')?'WAITING_CUSTOMER':'ACTION_PLANNED',label:verified?'Ejecución verificada':manual?'Revisión manual':labels[action]||'Pendiente'}};
}
