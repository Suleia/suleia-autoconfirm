export const rejectedWorkflowKey = value => ['RECIPIENT_REJECTED','REFUSED_BY_RECIPIENT','REJECTED_GOODS','REJECTED_BY_RECIPIENT','REFUSED'].includes(value)?'RECIPIENT_REJECTED':value;
const names={detection:'Detectar',notification:'Contactar',interpretation:'Interpretar',decision:'Decidir',recovery_offer:'Ofrecer 5 €',discount:'Aplicar 5 €',new_delivery:'Nueva entrega',return:'Devolución',resolution:'Ejecución por acción',verification:'Verificar'};
export function rejectedWorkflowPresentation(base,owner){
 const age=Date.now()-Date.parse(owner?.observed_at);
 const fresh=owner?.workflow==='RECIPIENT_REJECTED'&&age>=0&&age<5*60000;
 const stages=['detection','notification','interpretation','decision','recovery_offer','discount','new_delivery','return','resolution','verification'].map(id=>{
  const value=fresh?owner.stages?.[id==='notification'?'contact':id]:null;
  const mode=['LIVE','OFF','CANARY','SHADOW'].includes(value)?value:null;
  return {id,label:names[id],mode,label_mode:id==='resolution'?'Ver etapas':mode||'Sin evidencia'};
 });
 return {...base,id:'RECIPIENT_REJECTED',label:'Rechazado',stages,
  master:fresh?(owner.master_enabled?'ACTIVE':'DISABLED'):null,
  controls:{automation_live:fresh?owner.master_enabled:null,notification_enabled:null,interpretation_enabled:fresh?owner.stages.interpretation==='LIVE':null,resolution_enabled:null,pickup_enabled:null,return_enabled:fresh?owner.stages.return==='LIVE':null},
  health:fresh?(owner.healthy?'HEALTHY':'UNHEALTHY'):'UNKNOWN',observer:fresh?{last_completed_at:owner.last_cycle_at,lag_seconds:(Date.now()-Date.parse(owner.last_cycle_at))/1000}:null,
  breakers:['notification','discount','delivery','return'].map(id=>{const s=fresh?owner.breakers?.[id]:null;return {id,label:({notification:'Oferta Chatby',discount:'Aplicación descuento',delivery:'Nueva entrega',return:'Devolución'})[id],status:['OPEN','CLOSED'].includes(s)?s:null,label_status:s==='OPEN'?'Abierto':s==='CLOSED'?'Cerrado':'Sin evidencia'};}),
  last_activity:owner?.last_cycle_at||base.last_activity,
  current_activity:fresh?`Contacto nativo Chatby. Oferta: ${owner.stages?.recovery_offer||'UNKNOWN'}; devolución: ${owner.stages?.return||'UNKNOWN'}. Descuentos aceptados: gestión manual por decisión del propietario; sin correo automático a Dropea.`:'Sin lectura reciente del propietario Render.',
  playbook:['Rechazo detectado','Contacto nativo Chatby','Leer intención actual','Quiere recibir → recuperación → acepta 5 € → acción manual pendiente','Quiere devolver → devolución gobernada','Ambiguo → revisión','Sin respuesta a oferta → 48 h → relectura y devolución'],
  policy:owner?.policy||null,owner:owner?.owner||'render_incident_automation',
  source:'Estado observado del propietario Render + registros Supabase correlacionados; no representa simulación como ejecución',
  counts:{...base.counts,notifications:null,timers:null,resolutions:null},runtime:owner||null};
}
const labels={CONTACT_CUSTOMER:'Contactar al cliente',WAIT_FOR_CUSTOMER:'Esperar respuesta',OFFER_RECOVERY_DISCOUNT:'Ofrecer descuento de 5 €',APPLY_DISCOUNT:'Aplicar descuento de 5 €',REQUEST_NEW_DELIVERY:'Solicitar nueva entrega',RETURN_TO_ORIGIN:'Devolver al origen',OFFER_AGENCY:'Ofrecer recogida en agencia',HUMAN_REVIEW:'Revisar intención'};
export function rejectedIncidentPresentation(result,workflow){
 const d=result.rejected_observation?.decision;
 if(!d||d.decision_status!=='CURRENT')return result;
  const age=Date.now()-Date.parse(d.read_at);
  const fresh=d.read_verified===true&&age>=0&&age<20*60000;
 const newer=Date.parse(result.latest_private_customer_message_at||0)>Date.parse(d.responded_at||0);
 const action=fresh&&!newer?d.next_best_action:'HUMAN_REVIEW';
 const label=labels[action]||labels.HUMAN_REVIEW;
 const known=action!=='HUMAN_REVIEW';
 const reasons=known?['La acción exige validación final del propietario; consultar capacidad por etapa']:['Evidencia ambigua, desactualizada o posterior a la decisión'];
 return {...result,canonical_workflow:'RECIPIENT_REJECTED',rejected_decision:d,
  autonomy:{status:known?'PREPARED':'HUMAN_REVIEW',label:known?'Preparado':'Revisión'},
  next_best_action:{action,label,reason:({ACCEPTS_DISCOUNT:'Acepta el descuento de 5 €',WANTS_ORDER:'Quiere recibir el pedido',REJECTS_DISCOUNT:'No acepta descuento; no implica rechazo del pedido',REQUESTS_RETURN:'Solicita devolución',NO_RESPONSE:'Sin respuesta verificada'})[d.intent]||'Intención pendiente de aclarar',confidence:fresh?'Alta':'No verificable',execution_mode:null,blocking_reasons:reasons},
  execution:{...result.execution,blocking_reasons:result.execution.status==='VERIFIED'?[]:reasons},
  autonomous_state:result.execution.status==='VERIFIED'?result.autonomous_state:{code:action==='WAIT_FOR_CUSTOMER'?'WAITING_CUSTOMER':known?'ACTION_PLANNED':'HUMAN_REVIEW_REQUIRED',label:action==='WAIT_FOR_CUSTOMER'?'Esperando cliente':known?'Acción preparada':'Revisión necesaria'}};
}

export function rejectedMetrics(items, actions) {
 const cases=[...new Map(items.filter(i=>rejectedWorkflowKey(i.interpreted_type)==='RECIPIENT_REJECTED').map(i=>[i.canonical_issue_id,i])).values()];
 const observed=cases.filter(i=>i.rejected_observation?.decision?.decision_status==='CURRENT');
 const intent=i=>i.rejected_observation.decision.intent;
 const count=(id,label,value,definition)=>({id,label,value,unit:'count',definition});
 const uniqueActions=type=>new Set(actions.filter(a=>a.workflow==='RECIPIENT_REJECTED'&&a.evidence_mode==='REAL'&&a.execution_status==='VERIFIED'&&a.action_type===type).map(a=>a.id)).size;
 return [count('rejected_total','Incidencias rechazadas',cases.length,'Incidencias únicas creadas en el periodo.'),
 count('wants_order','Quiere recibir',observed.filter(i=>i.rejected_observation.decision.wants_order===true).length,'Intenciones registradas por el propietario; no acredita entrega.'),
 count('wants_return','Solicita devolución',observed.filter(i=>intent(i)==='REQUESTS_RETURN').length,'Intenciones registradas; no cuenta como devolución ejecutada.'),
 count('discount_offered','Ofertas de 5 € verificadas',uniqueActions('OFFER_RECOVERY_DISCOUNT'),'Ofertas con entrega Chatby verificada para incidencias del periodo; cobertura del registro importado.'),
 count('discount_accepted','Aceptaciones observadas',cases.filter(i=>i.discount_recovery_response_status==='DISCOUNT_ACCEPTED'||i.rejected_observation?.decision?.discount_accepted===true).length,'Aceptaciones por incidencia; no acredita aplicación ni entrega.'),
 count('returns','Devoluciones verificadas',uniqueActions('REQUEST_RETURN'),'Solicitudes verificadas en Dropea; no implica mercancía recibida en origen.'),
 count('recovered_orders','Pedidos recuperados',null,'Requiere entrega final atribuida a recuperación; cobertura pendiente.'),
 count('delivery_after_recovery','Entregas tras recuperación',null,'No se infiere entrega de una solución enviada.'),
 {id:'recovery_profit',label:'Beneficio recuperado',value:null,unit:'EUR',definition:'Sin atribución verificada de ingresos y costes a la recuperación.'}];
}
