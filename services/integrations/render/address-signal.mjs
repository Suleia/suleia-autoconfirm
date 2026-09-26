import {encryptPrivateJson} from '../../../packages/platform-core/src/operational-truth/dropea-canonical.mjs';
import crypto from 'node:crypto';
const keys=['template_name','notification_at','offer_due_at','return_due_at','last_customer_at','last_required_field_request_at','intent','state','action','eligible','read_at','missing_fields','customer_message_present','discount_accepted','discount_offered_at','initial_milestones','input_snapshot_hash','policy_snapshot_hash','decision_id','decision_status','policy','stages'];
export function normalizeAddressSignal(row,{hmacKey}={}){
 const raw=typeof row.raw==='object'?row.raw:null,d=raw?.addressWorkflow;
 if(raw?.incidentType!=='address'||!d||String(raw.orderId)!==String(row.order_id)||String(raw.incidenceId)!==String(row.incidence_id)
  ||String(d.canonical_order_id)!==String(row.order_id)||String(d.canonical_issue_id)!==String(row.incidence_id)||!Number.isFinite(Date.parse(row.updated_at)))return null;
 const observation=Object.fromEntries(keys.map(k=>[k,d[k]??null]));
 observation.issue_version=d.issue_version||null;
 observation.read_verified=d.read_verified===true;
 observation.notification_message_id=d.message_id?crypto.createHash('sha256').update(String(d.message_id)).digest('hex'):null;
 observation.provider_plan=d.provider_plan?{action:d.provider_plan.action,allowed:d.provider_plan.allowed===true,reason:d.provider_plan.reason||null}:null;
 const execution=d.last_execution||d.execution;
 observation.execution=execution?Object.fromEntries(['status','action','error','provider_error_code','verified','attempted_at','verified_at','attemptedAt','completedAt','sentAt'].map(k=>[k,execution[k]??null])):null;
 return {dropea_issue_id:String(row.incidence_id),dropea_order_id:String(row.order_id),observation,source_updated_at:row.updated_at,
  private_address_ciphertext:hmacKey?encryptPrivateJson({original:d.original_address||null,provided:d.customer_provided_address||d.address||null,candidate:d.effective_address_candidate||null},hmacKey):null};
}
