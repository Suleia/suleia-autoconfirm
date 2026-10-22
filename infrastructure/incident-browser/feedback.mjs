import fs from 'node:fs/promises';
import {logisticsOutcome,laterOpenIssue} from './runtime-state.mjs';

export async function readRetryOutcome({current,orderId,issueId,attemptedAt,incidents,readIssue}){
 const raw=current?.issue?.raw||current?.issue;
 if(String(current?.order?.orderId)!==String(orderId)||String(raw?.id)!==String(issueId)||String(raw?.order_id)!==String(orderId))throw Error('FOLLOWUP_IDENTITY_MISMATCH');
 const terminal=logisticsOutcome({...current,attemptedAt});
 if(['DELIVERED','RETURNED_OR_RETURNING','CANCELLED','INCIDENT_REOPENED'].includes(terminal))return {outcome:terminal};
 const ids=[...new Set(incidents.filter(i=>String(i.orderId)===String(orderId)&&String(i.incidenceId)!==String(issueId)).map(i=>String(i.incidenceId)))];
 if(ids.length>10)throw Error('FOLLOWUP_CANDIDATE_LIMIT');
 const relatedIssues=[];
 for(const id of ids){
  if(!/^\d+$/.test(id))throw Error('FOLLOWUP_ISSUE_ID_INVALID');
  const next=await readIssue({orderId,incidenceId:id});
  const raw=next.issue?.raw||next.issue;
  if(String(raw?.id)!==id||String(raw?.order_id)!==String(orderId))throw Error('FOLLOWUP_IDENTITY_MISMATCH');
  relatedIssues.push(raw);
 }
 const later=laterOpenIssue({...current,relatedIssues,attemptedAt});
 return {outcome:logisticsOutcome({...current,relatedIssues,attemptedAt}),...(later?{followupIssueId:String(later.id)}:{})};
}

// Read-only provider follow-up. Feedback never grants permission for a new write
// or edits a business rule from customer prose. It makes outcomes reviewable.
export async function followRetryOutcomes(){
 const {selectRows,upsertRows}=await import('../../autoconfirm/src/clients/supabase.mjs');
 const {readDropeaV2ReturnIssueState}=await import('../../autoconfirm/src/clients/dropea-v2-incidents.mjs');
 let previous={cases:[]};try{previous=JSON.parse(await fs.readFile('/state/retry-feedback.json','utf8'));}catch{}
 const groups=await Promise.all(['vps_retry_evidence','vps_delivery_reply'].map(owner=>selectRows('template_delivery_ledger',{query:{provider:'eq.dropea','raw->>owner':'eq.'+owner,status:'eq.verified',select:'order_id,raw,attempted_at,sent_at',order:'updated_at.desc'},limit:200,timeoutMs:10000})));
 const rows=deliveryFollowupReceipts(groups.flat());
 const cache=(await selectRows('app_state',{query:{key:'eq.incidents_cache',select:'value,updated_at'},limit:1,timeoutMs:10000}))[0];
 // The cache discovers identities only; every candidate is read again in Dropea.
 if(!Array.isArray(cache?.value?.incidents)||!Number.isFinite(Date.parse(cache.updated_at))||Date.now()-Date.parse(cache.updated_at)>3600000)throw Error('FRESH_FEEDBACK_CACHE_REQUIRED');
 const cases=new Map((previous.cases||[]).map(c=>[c.issueId,c]));
 const candidates=rows.filter(r=>!['DELIVERED','RETURNED_OR_RETURNING','CANCELLED'].includes(cases.get(String(r.raw?.issueId))?.outcome));
 candidates.sort((a,b)=>Date.parse(cases.get(String(a.raw?.issueId))?.checkedAt||0)-Date.parse(cases.get(String(b.raw?.issueId))?.checkedAt||0));
 for(const r of candidates.slice(0,10)){
  const orderId=String(r.order_id),issueId=String(r.raw?.issueId||'');if(!/^\d+$/.test(orderId)||!/^\d+$/.test(issueId))continue;
  const checkedAt=new Date().toISOString(),old=cases.get(issueId);
  try{
   const current=await readDropeaV2ReturnIssueState({orderId,incidenceId:issueId},{includeOrder:true});
   const outcome=await readRetryOutcome({current,orderId,issueId,attemptedAt:r.attempted_at,incidents:cache.value.incidents,readIssue:readDropeaV2ReturnIssueState});
   const value={orderId,issueId,date:r.raw.date,time_window:r.raw.time_window,scheduleSource:r.raw.scheduleSource||null,executedAt:r.attempted_at,checkedAt,...outcome,...deliveryFollowupStatus(outcome)};
   cases.set(issueId,value);
   if(old?.outcome!==value.outcome||old?.followupIssueId!==value.followupIssueId)await fs.appendFile('/state/retry-feedback-events.jsonl',JSON.stringify(value)+'\n',{mode:0o600});
  }catch{cases.set(issueId,{...old,orderId,issueId,checkedAt,readError:'PROVIDER_READ_FAILED'});}
 }
 const all=[...cases.values()],summary={verifiedResolutions:rows.length,tracked:all.length,delivered:all.filter(c=>c.outcome==='DELIVERED').length,awaitingCarrier:all.filter(c=>c.outcome==='AWAITING_CARRIER').length,awaitingNewDelivery:all.filter(c=>c.logisticsStatus==='AWAITING_NEW_DELIVERY').length,reopened:all.filter(c=>c.outcome==='INCIDENT_REOPENED').length,readErrors:all.filter(c=>c.readError).length};
 const value={at:new Date().toISOString(),policyUpdates:'REVIEW_AND_TEST_REQUIRED',summary,cases:all};
 await fs.writeFile('/state/retry-feedback.tmp',JSON.stringify(value),{mode:0o600});await fs.rename('/state/retry-feedback.tmp','/state/retry-feedback.json');
 await upsertRows('app_state',{key:'vps_retry_feedback_v1',value,updated_at:value.at},{onConflict:'key',timeoutMs:10000});
 return summary;
}

export function deliveryFollowupReceipts(rows){
 return [...new Map(rows.filter(r=>['vps_retry_evidence','vps_delivery_reply'].includes(r.raw?.owner)&&/^\d+$/.test(String(r.order_id))&&/^\d+$/.test(String(r.raw?.issueId))&&String(r.raw?.orderId||r.order_id)===String(r.order_id)&&Number.isFinite(Date.parse(r.attempted_at))).map(r=>[String(r.order_id)+':'+String(r.raw.issueId),r])).values()];
}
export function deliveryFollowupStatus({outcome}){
 return {logisticsStatus:outcome==='AWAITING_CARRIER'?'AWAITING_NEW_DELIVERY':outcome==='INCIDENT_REOPENED'?'NEW_INCIDENT':outcome,commerciallyClosed:outcome==='DELIVERED'};
}
