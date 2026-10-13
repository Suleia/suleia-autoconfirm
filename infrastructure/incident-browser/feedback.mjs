import fs from 'node:fs/promises';
import {logisticsOutcome} from './runtime-state.mjs';

// Read-only provider follow-up. Feedback never grants permission for a new write
// or edits a business rule from customer prose. It makes outcomes reviewable.
export async function followRetryOutcomes(){
 const {selectRows,upsertRows}=await import('../../autoconfirm/src/clients/supabase.mjs');
 const {readDropeaV2ReturnIssueState}=await import('../../autoconfirm/src/clients/dropea-v2-incidents.mjs');
 let previous={cases:[]};try{previous=JSON.parse(await fs.readFile('/state/retry-feedback.json','utf8'));}catch{}
 const rows=await selectRows('template_delivery_ledger',{query:{provider:'eq.dropea','raw->>owner':'eq.vps_retry_evidence',status:'eq.verified',select:'order_id,raw,attempted_at,sent_at',order:'updated_at.desc'},limit:200,timeoutMs:10000});
 const cases=new Map((previous.cases||[]).map(c=>[c.issueId,c]));
 const candidates=rows.filter(r=>!['DELIVERED','RETURNED_OR_RETURNING','CANCELLED'].includes(cases.get(String(r.raw?.issueId))?.outcome));
 candidates.sort((a,b)=>Date.parse(cases.get(String(a.raw?.issueId))?.checkedAt||0)-Date.parse(cases.get(String(b.raw?.issueId))?.checkedAt||0));
 for(const r of candidates.slice(0,10)){
  const orderId=String(r.order_id),issueId=String(r.raw?.issueId||'');if(!/^\d+$/.test(orderId)||!/^\d+$/.test(issueId))continue;
  const checkedAt=new Date().toISOString(),old=cases.get(issueId);
  try{
   const current=await readDropeaV2ReturnIssueState({orderId,incidenceId:issueId},{includeOrder:true});
   const outcome=logisticsOutcome({...current,attemptedAt:r.attempted_at});
   const value={orderId,issueId,date:r.raw.date,time_window:r.raw.time_window,scheduleSource:r.raw.scheduleSource||'CUSTOMER_EXPLICIT',executedAt:r.attempted_at,checkedAt,outcome};
   cases.set(issueId,value);
   if(old?.outcome!==outcome)await fs.appendFile('/state/retry-feedback-events.jsonl',JSON.stringify(value)+'\n',{mode:0o600});
  }catch{cases.set(issueId,{...old,orderId,issueId,checkedAt,readError:'PROVIDER_READ_FAILED'});}
 }
 const all=[...cases.values()],summary={verifiedResolutions:rows.length,tracked:all.length,delivered:all.filter(c=>c.outcome==='DELIVERED').length,awaitingCarrier:all.filter(c=>c.outcome==='AWAITING_CARRIER').length,reopened:all.filter(c=>c.outcome==='INCIDENT_REOPENED').length,readErrors:all.filter(c=>c.readError).length};
 const value={at:new Date().toISOString(),policyUpdates:'REVIEW_AND_TEST_REQUIRED',summary,cases:all};
 await fs.writeFile('/state/retry-feedback.tmp',JSON.stringify(value),{mode:0o600});await fs.rename('/state/retry-feedback.tmp','/state/retry-feedback.json');
 await upsertRows('app_state',{key:'vps_retry_feedback_v1',value,updated_at:value.at},{onConflict:'key',timeoutMs:10000});
 return summary;
}
