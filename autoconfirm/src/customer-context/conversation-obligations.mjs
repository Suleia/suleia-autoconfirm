import {extractWamid} from '../workflows/incident-discount-policy.mjs';
import {contextualQuestion} from './question-context.mjs';

const fields={DATE:['DELIVERY_DATE'],TIME_WINDOW:['TIME_WINDOW'],DATE_AND_WINDOW:['DELIVERY_DATE','TIME_WINDOW'],WANTS_ORDER_AND_SCHEDULE:['WANTS_ORDER','DELIVERY_DATE','TIME_WINDOW'],WANTS_ORDER:['WANTS_ORDER'],CONFIRM_ORDER:['WANTS_ORDER'],POSTAL_CODE:['POSTAL_CODE'],ADDRESS:['ADDRESS'],AGENCY_PICKUP:['REQUESTS_AGENCY']};
const answersSlot=(slot,fact)=>fact.confidence>=.9&&(slot==='TIME_WINDOW'?['DELIVERY_WINDOW','TIME_FROM','TIME_TO','DELIVERY_AVAILABILITY'].includes(fact.type):slot===fact.type);

// A derived projection over the existing fact ledger, transcript and receipts.
// No second memory database, sender or ownership state is introduced.
export function reconcileConversationQuestions(state,events,incoming,previous){
 const byMid=new Map(events.filter(e=>e.direction==='OUTBOUND').map(e=>[extractWamid(e.message),e]));
 state.clarifications=state.clarifications.map(old=>{
  const event=byMid.get(old.provider_message_id),purpose=event?contextualQuestion(event.message):old.clarification_type;
  const requested=fields[purpose];
  if(!requested)return {...old,clarification_type:purpose||old.clarification_type};
  const answers=incoming.filter(f=>Date.parse(f.source_event_at)>Date.parse(old.sent_at));
  const used=answers.filter(f=>requested.some(slot=>answersSlot(slot,f)));
  const remaining=requested.filter(slot=>!used.some(f=>answersSlot(slot,f)));
  const answered=remaining.length===0,at=answered?used.map(f=>f.source_event_at).sort().at(-1):null;
  return {...old,clarification_type:purpose,question_purpose:purpose,requested_slots:requested,remaining_slots:remaining,
   canonical_order_id:state.canonical_order_id,active_issue_id:state.active_issue_id,
   answered_at:at,answer_hash:answered?used.map(f=>f.source_event_hash).sort().join(':'):null,
   answer_event_hashes:[...new Set(used.map(f=>f.source_event_hash))],
   status:answered?'ANSWERED':old.status==='ANSWERED'?'PROVIDER_ACCEPTED':old.status};
 });
 const answeredIds=new Set((previous?.timeline||[]).filter(e=>e.kind==='INFORMATION_RESPONSE'&&e.status==='PROVIDER_ACCEPTED'&&e.provider_message_id&&e.readback_verified===true).flatMap(e=>e.answered_fact_ids||[]));
 state.pending_customer_questions=Object.values(state.current_facts).filter(f=>f.fact_type.startsWith('ASKS_')&&f.value_json===true&&f.confidence>=.9&&!answeredIds.has(f.fact_id)).map(f=>({type:f.fact_type,fact_id:f.fact_id,source_event_hash:f.source_event_hash,source_event_at:f.source_event_at}));
 state.answered_customer_questions=[...answeredIds];
 const pending=new Set(state.pending_customer_questions.map(q=>q.type));
 state.latest_customer_intents=state.latest_customer_intents.filter(t=>!t.startsWith('ASKS_')||pending.has(t));
 state.question_memory={pending:state.clarifications.filter(q=>!q.answered_at&&['ATTEMPTING','PROVIDER_ACCEPTED','DELIVERY_UNVERIFIED'].includes(q.status)).map(q=>({purpose:q.question_purpose||q.clarification_type,slots:q.remaining_slots||q.missing_slots||[],wamid:q.provider_message_id||null,status:q.status,sent_at:q.sent_at,source:q.source})),customer_questions:state.pending_customer_questions};
}
