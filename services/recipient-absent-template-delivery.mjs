import {authorizeNativeAbsent,nativeAbsentControlReady,nativeAbsentEligibility} from './recipient-absent-native-gate.mjs';
import {classifyAbsenceAttempt,classifyAbsentCause} from '../packages/platform-core/src/incident/absent-evidence.mjs';
import {ABSENT_TEMPLATE_BODY,ABSENT_TEMPLATE_BUTTONS} from '../packages/platform-core/src/incident/absent-template.mjs';

export function absentContactInput(fresh){
  const {issue,order,chatby}=fresh;
  return {canonical_issue_id:issue.canonical_issue_id,canonical_order_id:issue.canonical_order_id,
    conversation_id:chatby.conversation_id,exact_identity_verified:order.identity_status==='EXACT' && chatby.verified===true,
    type:issue.type,status:issue.status,is_active:issue.is_active,decision_currentness:fresh.decision_currentness,
    return_in_progress:fresh.return_in_progress,absence_classification:classifyAbsenceAttempt({issue}).status,
    contact_cause:classifyAbsentCause(issue).interpreted_type,order_in_incidence:order.canonical_state==='INCIDENCE',
    order_notification_count:chatby.order_notification_count,customer_activity_after_issue:chatby.customer_activity_after_issue,
    issue_created_at:issue.created_at,history_complete:chatby.history_complete,previous_notification_count:chatby.notification_count,
    issue_read_at:issue.observed_at,order_read_at:order.observed_at,chatby_read_at:chatby.observed_at};
}

export function approvedAbsentPayload(template,{conversationId,orderId}){
  let components=template?.components;
  if(typeof components==='string'){try{components=JSON.parse(components);}catch{components=[];}}
  const body=components?.find(c=>c.type==='BODY')?.text;
  const buttons=components?.find(c=>c.type==='BUTTONS')?.buttons;
  if(String(template?.id)!=='1552419' || template.name!=='dropea_ausente_v3' || template.status!=='APPROVED'
    || template.language!=='es_ES' || !template.namespace || body!==ABSENT_TEMPLATE_BODY
    || JSON.stringify(buttons?.map(b=>({type:b.type,text:b.text})))!==JSON.stringify(ABSENT_TEMPLATE_BUTTONS.map(b=>({type:'QUICK_REPLY',text:b.text})))
    || !/^\d+$/.test(String(orderId)) || !conversationId)throw new Error('APPROVED_TEMPLATE_CONTRACT_REQUIRED');
  // Preserve the published native reply destinations. Only transport ownership
  // changes; no callback, template, confirmation or logistics mutation occurs.
  return {user_ns:conversationId,content:{name:template.name,lang:template.language,namespace:template.namespace,
    params:{'BODY_{{1}}':'de nuevo','BODY_{{2}}':`ES${orderId}`,
      QUICK_REPLY_1:'f295175n452453267',QUICK_REPLY_2:'f295175n452453269',QUICK_REPLY_3:'f295175n452453271'}}};
}

export async function deliverAbsentTemplate({candidate,readFresh,ledger,readTemplate,send,persistOutcome,now=()=>new Date()}){
  // Catalogue before fresh reads: catalogue latency cannot age authorization.
  const template=await readTemplate();
  const fresh=await readFresh(candidate.canonical_issue_id),input=absentContactInput(fresh);
  if(String(fresh.issue.dropea_order_id)!==String(candidate.dropea_order_id))throw new Error('EXACT_ORDER_IDENTITY_REQUIRED');
  const payload=approvedAbsentPayload(template,{conversationId:input.conversation_id,orderId:candidate.dropea_order_id});
  const claim=await authorizeNativeAbsent({readFresh:async()=>input,ledger,source:'CONTROLLER_TEMPLATE_API',now});
  if(!claim.allow)return {status:'BLOCKED',reason:claim.reason};
  const finalGate=await ledger.transaction(async store=>{
    const c=await store.controlForUpdate();
    return c.evidence?.notification_owner==='CONTROLLER_TEMPLATE_API'
      ? nativeAbsentEligibility(input,c,new Date(now())):'NOTIFICATION_OWNER_MISMATCH';
  });
  if(finalGate){await persistOutcome(claim.claim_id,'BLOCKED_BEFORE_POST');return {status:'BLOCKED',reason:finalGate};}
  // A durable claim is never released after an uncertain response. Independent
  // history observation owns verification and the single 48h timer.
  try{await send(payload);await persistOutcome(claim.claim_id,'API_ACKNOWLEDGED');return {status:'ACKNOWLEDGED'};}
  catch{await persistOutcome(claim.claim_id,'API_RESULT_UNCERTAIN');return {status:'RECONCILIATION_REQUIRED'};}
}

export function createAbsentTemplateDelivery({pool,readFresh,ledger,token,fetchImpl=fetch}){
  let running=false,cursor=0;
  const api=async(path,body)=>{
    const response=await fetchImpl(`https://app.chatby.io/api${path}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,
      'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
    const data=await response.json();
    if(!response.ok || data.status==='error' || data.ok===false || data.success===false || data.error)throw new Error('CHATBY_TEMPLATE_REQUEST_FAILED');
    return data;
  };
  return {async run(){
    if(running)return {deferred:true};running=true;
    try{
      const control=(await pool.query("SELECT * FROM operations.recipient_absent_native_control WHERE workflow='RECIPIENT_ABSENT'")).rows[0];
      if(!nativeAbsentControlReady(control) || control.evidence?.notification_owner!=='CONTROLLER_TEMPLATE_API')return {disabled:true};
      const rows=(await pool.query(`SELECT i.canonical_issue_id,i.dropea_order_id FROM read_models.operations_incident_records i
        JOIN read_models.recipient_absent_current_context c USING(canonical_issue_id,canonical_order_id)
        WHERE i.type='RECIPIENT_ABSENT' AND i.status='PENDING' AND i.is_active=true AND c.current=true
        AND i.created_at >= $1 AND NOT EXISTS(SELECT 1 FROM operations.recipient_absent_native_notifications n WHERE n.canonical_order_id=i.canonical_order_id)
        AND ($2::text IS NULL OR i.canonical_issue_id=$2) ORDER BY i.created_at`,
        [control.recipient_absent_template_cutover_at,control.status==='CANARY'?control.canary_issue_id:null])).rows;
      if(!rows.length)return {checked:0};
      const candidate=rows[cursor++ % rows.length];
      const result=await deliverAbsentTemplate({candidate,readFresh,ledger,
        readTemplate:async()=>{
          const r=await api('/whatsapp-template/list?name=dropea_ausente_v3&limit=100',{});
          const exact=r.data?.filter(t=>t.name==='dropea_ausente_v3' && t.language==='es_ES');
          if(exact?.length!==1)throw new Error('TEMPLATE_CATALOG_AMBIGUOUS');return exact[0];
        },send:payload=>api('/subscriber/send-whatsapp-template',payload),
        persistOutcome:(id,status)=>pool.query(`UPDATE operations.recipient_absent_native_notifications
          SET outcome=coalesce(outcome,'{}'::jsonb)||$2::jsonb WHERE claim_id=$1`,[id,JSON.stringify({transport:'CONTROLLER_TEMPLATE_API',transport_status:status})])});
      return {checked:1,...result};
    }finally{running=false;}
  }};
}
