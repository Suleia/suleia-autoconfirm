const code=v=>typeof v==='string'&&/^[A-Z][A-Z0-9_]{0,100}$/.test(v)?v:null;
const owner=v=>typeof v==='string'&&/^(?:existing_[a-z_]+|vps_delivery_reply|SULEIA_CUSTOMER_CARE_AGENT|HUMAN)$/.test(v)?v:null;
const at=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
const day=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&at(v)?.startsWith(v)?v:null;
const clock=v=>typeof v==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v)?v:null;
const list=v=>(Array.isArray(v)?v:[]).slice(0,40).map(code).filter(Boolean);
export function normalizeCustomerCareSignal(row){
 const c=row.raw?.customerCare;
 if(!c||String(c.dropea_order_id)!==String(row.order_id)||String(c.active_issue_id)!==String(row.incidence_id)||!at(c.updated_at))return null;
 const result={mode:['SHADOW','CANARY','LIVE'].includes(c.mode)?c.mode:'SHADOW',status:code(c.status),intents:list(c.latest_customer_intents),wants_order:typeof c.wants_order==='boolean'?c.wants_order:null,
  known_slots:Object.keys(c.fact_evidence||{}).slice(0,40).map(x=>code(x.toUpperCase())).filter(Boolean),missing_slots:list(c.missing_slots),delivery_date:day(c.delivery_date),delivery_window:code(c.delivery_window),time_from:clock(c.time_from),time_to:clock(c.time_to),call_before_arrival:c.call_before_arrival===true,
  last_question_type:typeof c.last_outbound_question_type==='string'?c.last_outbound_question_type.split('+').map(code).filter(Boolean).join('+')||null:null,last_question_at:at(c.last_outbound_question_at),next_best_action:code(c.next_best_action),owner:owner(c.owner),reason:code(c.reason),waiting_for_customer:c.waiting_for_customer===true,waiting_for_provider:c.waiting_for_provider===true,
  last_verified_action:c.last_verified_action?.status==='VERIFIED'?{action:code(c.last_verified_action.action),at:at(c.last_verified_action.at)}:null,conversation_version:Number.isSafeInteger(c.conversation_version)&&c.conversation_version>=0?c.conversation_version:null,updated_at:at(c.updated_at),
  timeline:(Array.isArray(c.timeline)?c.timeline:[]).slice(-5).map(t=>({kind:code(t.kind),at:at(t.at),intents:list(t.intents),action:code(t.action),owner:owner(t.owner),reason:code(t.reason)}))};
 return result;
}
