// Shared read-side vocabulary. This module never authorizes or executes actions.
export const actionLabels={SEND_CHATBY_TEMPLATE:'Enviar plantilla v3',SEND_CHATBY_MESSAGE:'Contactar al cliente',PROVIDE_SOLUTION:'Aportar solución',REQUEST_REDELIVERY:'Solicitar nueva entrega',UPDATE_DELIVERY_DATA:'Actualizar datos de entrega',APPLY_DISCOUNT:'Aplicar descuento',REQUEST_AGENCY_PICKUP:'Enviar a agencia',REQUEST_RETURN:'Devolver al origen',RESOLVE_INCIDENT:'Resolver incidencia',WAIT_CUSTOMER:'Esperar respuesta',REVIEW_INTENT:'Revisar intención',REVIEW_EVIDENCE:'Validar evidencia'};
export const executionLabels={NOT_STARTED:'Pendiente',PREPARED:'Preparada',REQUESTED:'Solicitada',EXECUTING:'Ejecutando',VERIFIED:'Verificada',FAILED:'Fallida',UNKNOWN:'No verificable',BLOCKED:'Bloqueada'};
export const autonomyLabels={AUTOMATIC:'Automático',PREPARED:'Preparado',HUMAN_REVIEW:'Revisión'};
const workflowLabels={RECIPIENT_ABSENT:'Ausente',REFUSED_BY_RECIPIENT:'Rechazado',PENDING_DATA:'Faltan datos',NO_RESPONSE:'No respuesta',ADDRESS_INCORRECT:'Dirección',PICKUP_AT_AGENCY:'Recogida en agencia',GENERAL_INCIDENCE:'Incidencia general',UNKNOWN:'Sin clasificar'};
export const stateLabels={DETECTED:'Incidencia detectada',EVIDENCE_GATHERING:'Recopilando evidencia',CUSTOMER_CONTACT_REQUIRED:'Contacto pendiente',WAITING_CUSTOMER:'Esperando cliente',CUSTOMER_RESPONDED:'Cliente respondió',INTENT_INTERPRETED:'Intención interpretada',ACTION_PLANNED:'Acción preparada',READY_TO_EXECUTE:'Lista para ejecutar',EXECUTING:'Ejecutando',EXECUTION_REQUESTED:'Acción solicitada',EXECUTION_VERIFIED:'Acción verificada',RESOLVED:'Resuelta',HUMAN_REVIEW_REQUIRED:'Revisión necesaria',BLOCKED:'Bloqueada',STALE:'Datos atrasados',CONFLICT:'Evidencia contradictoria',EXECUTION_UNKNOWN:'Ejecución no verificable'};
const mode=v=>v==='DISABLED'||v==='PAUSED'?'OFF':['LIVE','CANARY','SHADOW'].includes(v)?v:v==='SIMULATION'||v==='SHADOW_READ_ONLY'?'SHADOW':null;
const stage=(id,label,value)=>({id,label,mode:mode(value),label_mode:mode(value)||'Sin evidencia'});
const breaker=(id,label,reason,at,known)=>({id,label,status:known?(reason?'OPEN':'CLOSED'):null,label_status:known?(reason?'Abierto':'Cerrado'):'Sin evidencia',opened_at:at||null,reason:reason?'Protección activada; consultar el detalle técnico':null,reason_code:reason||null});
export function workflowPresentation(row,{health=null}={}){
 const absent=row.workflow==='RECIPIENT_ABSENT',shadow=row.has_shadow===true;
 const stages=[stage('detection','Detectar',shadow?'SHADOW':null),stage('notification','Contactar',row.notification_mode),stage('interpretation','Interpretar',shadow?'SHADOW':null),stage('decision','Decidir',shadow?'SHADOW':null),stage('resolution','Ejecutar',row.resolution_mode),stage('verification','Verificar',absent&&health?.observer?.healthy?'LIVE':null)];
 const breakers=[breaker('notification','Avisos',row.notification_breaker_reason,row.notification_breaker_at,row.notification_mode!=null),breaker('resolution','Resoluciones',row.resolution_breaker_reason,row.resolution_breaker_at,row.resolution_mode!=null),breaker('provider','Proveedor',null,null,false)];
 const reservations=Number(row.reservations||0),canary=mode(row.notification_mode)==='CANARY';
 const enabled=row.automation_live===true&&row.native_send_enabled===true&&row.template_sends_enabled===true;
 return {id:row.workflow,label:workflowLabels[row.workflow]||'Otro workflow registrado',stages,breakers,
  controls:{automation_live:row.automation_live??null,notification_enabled:row.notification_mode==null?null:enabled,interpretation_enabled:null,resolution_enabled:row.resolution_mode==null?null:['CANARY','LIVE'].includes(row.resolution_mode),pickup_enabled:null,return_enabled:null},
  master:row.automation_live==null?null:row.automation_live?'ACTIVE':'DISABLED',
  canary:{active:canary,limit:canary?1:null,used:canary?reservations:null,remaining:canary?Math.max(0,1-reservations):null,candidate:row.canary_issue_id||null,result:reservations?Number(row.notifications)>0?'Aviso verificado':'Reserva pendiente de verificación':'No hay canary ejecutado todavía.'},
  counts:{reservations,notifications:Number(row.notifications||0),timers:Number(row.timers||0),resolutions:Number(row.resolutions||0),callbacks:absent?health?.counts?.callbacks??null:null},
  health:absent?(health?.observer?.healthy?'HEALTHY':health?'UNHEALTHY':'UNKNOWN'):'UNKNOWN',observer:absent?health?.observer??null:null,
  last_activity:row.last_activity||null,cutover:row.recipient_absent_template_cutover_at||null,
  current_activity:breakers.some(b=>b.status==='OPEN')?'Una protección está bloqueando acciones.':canary?reservations?'Canary reservado. Verificación y respuesta pendientes.':row.canary_issue_id?'Candidato seleccionado; todavía no hay aviso verificado.':'Esperando una incidencia elegible para el canary.':shadow?'Decisiones en simulación. Ejecución no acreditada en esta fuente.':'Sin evidencia suficiente del estado operativo.',
  playbook:absent?['Incidencia','Avisar cliente','Esperar respuesta','Interpretar','Aportar solución o revisar']:row.workflow==='REFUSED_BY_RECIPIENT'?['Rechazo','Revisar evidencia','Evaluar recuperación o devolución','Validar ejecución']:['Detectar incidencia','Revisar evidencia','Preparar decisión','Verificar resultado'],
  source:'Controles persistidos y proyección de simulación; no sustituye controles de otros emisores',read_only:true};
}
export function incidentAutonomy(item,workflow,{execution=null}={}){
 const d=item.dashboard||{},e=item.recovery?.evidence||{},s=item.absent_shadow||{};
 const current=d.decision_current===true,clear=current&&e.valid_response===true&&!['UNKNOWN','UNCLEAR','AMBIGUOUS'].includes(s.customer_intent||item.customer_intent||'UNKNOWN');
 let action=actionLabels[item.autopilot_next_action]?item.autopilot_next_action:'REVIEW_INTENT';
 if(clear&&s.customer_intent==='RESCHEDULE_DELIVERY')action='PROVIDE_SOLUTION';
 const waiting=d.flags?.WAITING_CUSTOMER===true;
 if(waiting)action='WAIT_CUSTOMER';
 const known=clear||waiting;
 const target=workflow?.stages?.find(x=>x.id===(action==='SEND_CHATBY_TEMPLATE'?'notification':'resolution'));
 const reasons=[];
 if(!current&&!waiting)reasons.push('No existe una decisión vigente con evidencia suficiente');
 if(!known)reasons.push('La intención o la evidencia necesitan revisión');
 if(known&&!waiting&&target?.mode!=='LIVE'&&target?.mode!=='CANARY')reasons.push('Ejecución deshabilitada o sin evidencia de activación');
 if(workflow?.breakers?.some(b=>b.status==='OPEN'))reasons.push('Protección del workflow abierta');
 if(target?.mode==='CANARY'&&workflow?.canary?.candidate!==item.canonical_issue_id)reasons.push('Incidencia fuera del canary seleccionado');
 // Explicit proof is required. A green workflow alone never promotes an incident.
 const gate=item.presentation_execution_gate===true&&item.presentation_action_allowed===true&&current;
 if(known&&!waiting&&!gate)reasons.push('Permiso y validación de ejecución pendientes');
 const automatic=known&&gate&&['LIVE','CANARY'].includes(target?.mode)&&!reasons.length;
 const autonomy=known?automatic?'AUTOMATIC':'PREPARED':'HUMAN_REVIEW';
 const real=execution?.evidence_mode==='REAL'?execution:null;
 const executionStatus=real?.execution_status||(known&&!waiting?'BLOCKED':'NOT_STARTED');
 const state=real?.execution_status==='VERIFIED'?'EXECUTION_VERIFIED':real?.execution_status==='UNKNOWN'?'EXECUTION_UNKNOWN':real?.execution_status==='REQUESTED'?'EXECUTION_REQUESTED':waiting?'WAITING_CUSTOMER':d.freshness==='STALE'?'STALE':!known?'HUMAN_REVIEW_REQUIRED':automatic?'READY_TO_EXECUTE':'BLOCKED';
 return {...item,autonomy:{status:autonomy,label:autonomyLabels[autonomy]},next_best_action:{action,label:actionLabels[action],reason:waiting?'Esperando respuesta dentro del plazo verificado':known?'Decisión preparada con evidencia vigente':'Revisar evidencia antes de decidir',confidence:known?'Alta':'No verificable',execution_mode:target?.mode||null,blocking_reasons:reasons},
 execution:{action_type:real?.action_type||action,action_label:actionLabels[real?.action_type||action]||'Acción registrada',status:executionStatus,label:executionLabels[executionStatus],provider:real?.provider||null,requested_at:real?.requested_at||null,executed_at:real?.executed_at||null,verified_at:real?.verified_at||null,blocking_reasons:reasons},
 autonomous_state:{code:state,label:stateLabels[state]},confidence:{evidence:e.valid_response?'Alta':e.customer_interacted?'Media':'No verificable',intent:known?'Alta':'No verificable',execution:executionStatus==='VERIFIED'?'Alta':'No verificable'}};
}
export function autonomyMatch(item,value){if(!value||value==='ALL')return true;if(value==='WAITING')return item.autonomous_state?.code==='WAITING_CUSTOMER';return item.autonomy?.status===value;}
export function autonomyMetrics(items){
 const unique=[...new Map(items.map(i=>[i.canonical_issue_id,i])).values()],active=unique.filter(i=>i.status==='PENDING'&&i.is_active===true);
 const metric=(id,label,n,denominator,definition)=>({id,label,numerator:n,denominator,value:n===null||!denominator?null:Math.round(n/denominator*1000)/10,definition});
 const contacted=unique.filter(i=>i.recovery?.evidence?.notification_at),responseCoverage=contacted.every(i=>i.recovery.evidence.valid_response||i.recovery.evidence.no_action_verified);
 const attempted=unique.filter(i=>i.execution.requested_at),verified=attempted.filter(i=>i.execution.status==='VERIFIED');
 return [
 metric('autonomous_resolution','Resolución autónoma',null,null,'Resoluciones VERIFIED sin intervención humana / resoluciones elegibles. Falta cobertura completa de intervención humana.'),
 metric('human_touch','Intervención humana',null,unique.length,'Incidencias únicas con intervención humana / incidencias gestionadas. La cola de revisión no acredita intervención.'),
 metric('prepared','Acciones preparadas',active.filter(i=>i.autonomy.status==='PREPARED').length,active.length,'Incidencias abiertas preparadas / incidencias abiertas creadas en el periodo'),
 metric('human_review','Necesitan revisión',active.filter(i=>i.autonomy.status==='HUMAN_REVIEW').length,active.length,'Incidencias abiertas que requieren revisión / incidencias abiertas creadas en el periodo; excluye histórico cerrado'),
 metric('execution_success','Éxito de ejecución',verified.length,attempted.length,'Incidencias con acción real verificada / incidencias con solicitud real observada; cobertura de los ledgers mostrados'),
 metric('verification_success','Verificación',verified.length,attempted.length,'Incidencias con verificación real / incidencias con solicitud real observada; la simulación no cuenta'),
 metric('unknown','Ejecución no verificable',attempted.filter(i=>i.execution.status==='UNKNOWN').length,attempted.length,'Incidencias con ejecución UNKNOWN / incidencias con solicitud real observada'),
 metric('customer_response','Respuesta del cliente',responseCoverage?contacted.filter(i=>i.recovery.evidence.valid_response).length:null,contacted.length,'Respuestas válidas / incidencias con aviso verificable. No disponible si falta evidencia vigente de respuesta o silencio en alguna conversación.'),
 metric('recovery','Recuperación',null,null,'Entregadas o recuperadas / intentos de recuperación; atribución canónica no disponible'),
 {id:'resolution_time',label:'Tiempo de resolución',value:null,definition:'Sin cobertura canónica de inicio y resolución atribuida'}];
}
