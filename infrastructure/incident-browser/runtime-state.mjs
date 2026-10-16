import {CYCLE_FRESHNESS_MS} from './schedule.mjs';
export function runtimeReadiness({control,sites,cycle,reconcile,now=Date.now()}){
 const configured=['AUTO','AUTO_CANARY'].includes(control?.mode);
 const sessions=Object.values(sites||{}).length===2&&Object.values(sites).every(s=>s.session==='UI_PRESENT_REQUIRES_IDENTITY_VERIFICATION');
 const fresh=Number.isFinite(Date.parse(cycle?.completedAt||cycle?.at))&&now-Date.parse(cycle.completedAt||cycle.at)<CYCLE_FRESHNESS_MS;
 const reason=!configured?'OBSERVATION_ONLY':reconcile?'RECONCILIATION_REQUIRED':!sessions?'SESSION_REQUIRED':cycle?.error?'CYCLE_FAILED':!fresh?'WAITING_FRESH_CYCLE':'READY';
 return {executionConfigured:configured,executionEnabled:configured&&reason==='READY',readiness:reason};
}
export function executionFailure({saveAttempted=false,error}){
 return {status:saveAttempted?'RECONCILE':'FAILED_PRE_SAVE',reason:/^[A-Z_]+$/.test(error?.message||'')?error.message:'EXECUTION_INTERRUPTED',saveAttempted};
}
export function logisticsOutcome({order,issue,relatedIssues=[],attemptedAt}){
 const status=String(order?.status||'').toUpperCase(),raw=issue?.raw||issue;
 if(status==='DELIVERED')return 'DELIVERED';
 if(['RETURNED','RETURN_IN_PROGRESS','RETURNING'].includes(status))return 'RETURNED_OR_RETURNING';
 if(['CANCELLED','CANCELED'].includes(status))return 'CANCELLED';
 if(raw?.status==='PENDING'&&!raw.resolution_status&&Date.parse(raw.updated_at)>Date.parse(attemptedAt))return 'INCIDENT_REOPENED';
 if(laterOpenIssue({order,issue,relatedIssues,attemptedAt}))return 'INCIDENT_REOPENED';
 return 'AWAITING_CARRIER';
}

export function laterOpenIssue({order,issue,relatedIssues=[],attemptedAt}){
 const original=issue?.raw||issue,orderId=String(order?.orderId||'');
 if(!orderId||!Number.isFinite(Date.parse(attemptedAt)))return null;
 return relatedIssues.map(value=>value?.raw||value).filter(value=>
  value?.id&&String(value.id)!==String(original?.id)&&String(value.order_id)===orderId
  &&value.status==='PENDING'&&value.is_active===true&&!value.resolution_status
  &&Date.parse(value.created_at)>Date.parse(attemptedAt)
 ).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at))[0]||null;
}
