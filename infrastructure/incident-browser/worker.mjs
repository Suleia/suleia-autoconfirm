import fs from 'node:fs/promises';
import {retryEvidencePlan} from './retry-policy.mjs';

// This stage observes independently, without a provider write adapter.
export async function loadProviderEnv(){
 // Bound otherwise unbounded Supabase reads/writes. Never retry mutations here.
 if(!globalThis.__suleiaBoundedFetch){
  const baseFetch=globalThis.fetch;
  globalThis.fetch=(input,options={})=>baseFetch(input,{...options,signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(45000)]):AbortSignal.timeout(45000)});
  globalThis.__suleiaBoundedFetch=true;
 }
 process.env.STORE_CONFIG_PATH='/state/worker-stores.json';
 const credentials=JSON.parse(await fs.readFile('/state/provider-env.json','utf8'));
 const allowed=new Set(['SUPABASE_ENABLED','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_SCHEMA','CHATBY_TOKEN','CHATBY_BASE_URL','DROPEA_STORES_CONFIG']);
 for(const c of JSON.parse(credentials.DROPEA_STORES_CONFIG||'[]'))if(/^[A-Z][A-Z0-9_]{2,127}$/.test(c.jwt_secret_reference))allowed.add(c.jwt_secret_reference);
 for(const [key,value]of Object.entries(credentials))if(allowed.has(key))process.env[key]=String(value);
}

export async function observeRetryCandidates(){
 await loadProviderEnv();
 const {selectRows}=await import('../../autoconfirm/src/clients/supabase.mjs');
 const {readDropeaV2ReturnIssueState}=await import('../../autoconfirm/src/clients/dropea-v2-incidents.mjs');
 const {getIncidentChatMessages,loadSubscriberIndex,findSubscriberInIndexForExactOrder}=await import('../../autoconfirm/src/clients/chatby.mjs');
 const {inspectPriorOrderReturn}=await import('../../autoconfirm/src/workflows/incident-order-return-guard.mjs');
 const {getTemplateDelivery}=await import('../../autoconfirm/src/db/supabase-store.mjs');
 const cached=(await selectRows('app_state',{query:{key:'eq.incidents_cache',select:'value,updated_at'},limit:1}))[0];
 if(!Array.isArray(cached?.value?.incidents)||!Number.isFinite(Date.parse(cached.updated_at))||Date.now()-Date.parse(cached.updated_at)>8*3600000)throw Error('FRESH_INCIDENT_CACHE_REQUIRED');
 const report={at:new Date().toISOString(),mode:'OBSERVE_ONLY',writes:0,cases:[]};
 let index;
 for(const incident of cached.value.incidents.filter(i=>['absent','rejected_goods'].includes(i.incidentType))){
  const item={orderId:incident.orderId,issueId:incident.incidenceId};
  try{
   const current=await readDropeaV2ReturnIssueState(incident,{includeOrder:true});
   const raw=current.issue?.raw||current.issue;
   if(raw.status!=='PENDING'||raw.is_active!==true||raw.resolution_status)continue;
   if(!incident.chatbyUserNs){report.cases.push({...item,reason:'NO_EXACT_CONVERSATION'});continue;}
   const messages=await getIncidentChatMessages(incident.chatbyUserNs);
   let plan=retryEvidencePlan({incident:{...incident,chatbyReadVerified:true},...current,messages});
   if(plan.eligible){
    index ||=await loadSubscriberIndex({maxPages:30,force:true});
    const subscriber=findSubscriberInIndexForExactOrder(index,{phone:current.order.customerPhone,orderId:incident.orderId});
    const prior=await inspectPriorOrderReturn(incident);
    if(!subscriber||subscriber.user_ns!==incident.chatbyUserNs)plan={eligible:false,reason:'FRESH_ASSOCIATION_REQUIRED'};
    else if(prior.verified||prior.blocked)plan={eligible:false,reason:'PRIOR_RETURN_GUARD'};
    else if(await getTemplateDelivery({storeId:'suleia',orderId:plan.orderId,templateName:`incident_resolution_v1:${plan.issueId}`}))plan={eligible:false,reason:'EXISTING_ACTION_CLAIM'};
   }
   report.cases.push({...item,eligible:plan.eligible,reason:plan.reason||'READY_FOR_EXECUTION',plan:plan.eligible?plan:undefined});
  }catch{report.cases.push({...item,reason:'FRESH_READ_FAILED'});}
 }
 await fs.writeFile('/state/retry-observation.tmp',JSON.stringify(report),{mode:0o600});
 await fs.rename('/state/retry-observation.tmp','/state/retry-observation.json');
 return {at:report.at,mode:report.mode,writes:0,observed:report.cases.length,eligible:report.cases.filter(c=>c.eligible).length};
}
