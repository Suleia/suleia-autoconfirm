const code=v=>typeof v==='string'&&/^[A-Z][A-Z0-9_]{0,100}$/.test(v)?v:null;
const date=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)?v:null;
export function normalizeResolutionSignal(row){
 const r=row.raw?.incidentResolution;
 if(!r||String(r.incident_id)!==String(row.incidence_id)||String(r.order_id)!==String(row.order_id)||!date(r.observed_at))return null;
 const plan=r.resolution_plan;
 const observation={
  workflow:code(r.workflow),issue_state:code(r.issue_state),customer_contact_status:code(r.customer_contact_status),
  customer_response_status:code(r.customer_response_status),customer_replied:r.customer_replied===true,
  customer_intents:(r.customer_intents||[]).map(code).filter(Boolean),customer_event_at:date(r.customer_event_at),
  next_best_action:code(r.next_best_action),explicit_wait_until:date(r.explicit_wait_until),human_review_reason:code(r.human_review_reason),current_owner:code(r.current_owner),
  execution_status:code(r.execution_status),verification_status:code(r.verification_status),logistics_outcome:code(r.logistics_outcome),
  customer_replied_but_unresolved:r.customer_replied_but_unresolved===true,action_prepared:r.action_prepared===true,
  observed_at:date(r.observed_at),capability_blocker:code(r.capability_blocker),
  timer_state:r.timer_state?{waiting_for:code(r.timer_state.waiting_for),waiting_since:date(r.timer_state.waiting_since),deadline:date(r.timer_state.deadline),on_timeout_action:code(r.timer_state.on_timeout_action)}:null,
  findings:(r.findings||[]).map(f=>({code:code(f.code),reasons:(f.reasons||[]).map(code).filter(Boolean)})),
  resolution_plan:plan?{plan_id:hash(plan.plan_id),input_hash:hash(plan.input_hash),status:code(plan.status),created_at:date(plan.created_at),superseded_at:date(plan.superseded_at),
    steps:(plan.steps||[]).map(s=>({action:code(s.action),capability:code(s.capability),dependency:code(s.dependency),status:code(s.status),verification:code(s.verification)}))}:null
 };
 return {dropea_issue_id:String(row.incidence_id),dropea_order_id:String(row.order_id),observation,source_updated_at:observation.observed_at};
}
