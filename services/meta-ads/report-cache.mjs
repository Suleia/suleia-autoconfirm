import {randomUUID} from 'node:crypto';
const safeCode=e=>{
 const c=e?.code||e?.message;
 if(['42501','42P01','42703','53300','57P01','57014'].includes(c))return 'ADS_DATABASE_UNAVAILABLE';
 if(/^META_HTTP_(400|401|403|429|500|502|503|504)$/.test(c||''))return c;
 if(['META_RATE_LIMITED','META_QUEUE_FULL','META_QUEUE_TIMEOUT','META_QUOTA_RESERVED','META_CIRCUIT_OPEN','META_TIMEOUT','ACCOUNT_NOT_ELIGIBLE','INSIGHTS_IDENTITY_INVALID','CONTRACT_MISMATCH','META_PAGINATION_INCOMPLETE','META_PAGINATION_BLOCKED','META_PAYLOAD_INVALID','META_API_ERROR'].includes(c))return c;
 return ['TimeoutError','AbortError'].includes(e?.name)?'META_TIMEOUT':'META_SOURCE_UNAVAILABLE';
};
export class ReportReadError extends Error{
 constructor(diagnostic){super(diagnostic.code);this.code=diagnostic.code;this.status=diagnostic.state==='PREPARING'?202:503;this.diagnostic=diagnostic;}
}
export function reportDependencyError(error){return new ReportReadError({id:randomUUID(),source:'POSTGRESQL',state:'FAILED',code:'ADS_DATABASE_UNAVAILABLE',connection:'UNAVAILABLE',failedAt:new Date().toISOString(),checkedAt:new Date().toISOString(),lastValidAt:null,retryable:!['42501','42P01','42703'].includes(error?.code),retryAfterSeconds:5});}
// One bounded cache and one coalesced GET job per canonical range. No writers,
// notifications, credentials or raw provider errors enter diagnostics.
export function createReportCache({read,restore=null,now=()=>Date.now(),waitMs=4000,maxAgeMs=120000,maxConcurrent=2,maxEntries=8,maxRows=40000,jobDeadlineMs=60000}){
 const cache=new Map(),jobs=new Map(),failures=new Map(),restores=new Map(),restoredAt=new Map();let lastSuccessAt=null,lastLatencyMs=null,rateFailure=null;
 const retain=(key,value)=>{const rowCount=['current','prior','daily'].reduce((n,k)=>n+Object.values(value.dataset[k]||{}).flat().length,0),entry={value,rowCount};if(rowCount>maxRows)return entry;cache.delete(key);cache.set(key,entry);while(cache.size>maxEntries||[...cache.values()].reduce((n,r)=>n+r.rowCount,0)>maxRows)cache.delete(cache.keys().next().value);return entry;};
 const diagnostic=(key,state,code,job=null)=>{const failure=failures.get(key)||rateFailure;return ({id:job?.id||failure?.id||randomUUID(),source:code==='ADS_DATABASE_UNAVAILABLE'?'POSTGRESQL':'META_MARKETING_API',state,code,connection:state==='PREPARING'?'READING':code==='META_HTTP_401'||code==='META_HTTP_403'?'AUTH_REQUIRED':['META_HTTP_429','META_RATE_LIMITED','META_QUOTA_RESERVED'].includes(code)?'RATE_LIMITED':'UNAVAILABLE',providerCode:failure?.providerCode??null,providerSubcode:failure?.providerSubcode??null,transient:failure?.transient===true,failedAt:failure?.at||null,checkedAt:new Date(now()).toISOString(),lastValidAt:cache.get(key)?.value.observedAt||null,lastSuccessfulReadAt:lastSuccessAt,latencyMs:job?now()-job.startedAt:failure?.latencyMs??null,retryable:!['META_HTTP_400','META_HTTP_401','META_HTTP_403','ACCOUNT_NOT_ELIGIBLE','CONTRACT_MISMATCH','INSIGHTS_IDENTITY_INVALID','ADS_DATABASE_UNAVAILABLE'].includes(code),retryAfterSeconds:failure?.retryAfterSeconds||(['META_HTTP_429','META_RATE_LIMITED'].includes(code)?60:2),cache:cache.has(key)?'HISTORICAL':'EMPTY'});};
 return {async snapshot(key,query,maxRangeDays){
  if(!cache.has(key)&&restore&&!restores.has(key)&&restores.size<maxConcurrent&&(!restoredAt.has(key)||now()-restoredAt.get(key)>60000)){
   restoredAt.delete(key);restoredAt.set(key,now());while(restoredAt.size>32)restoredAt.delete(restoredAt.keys().next().value);
   const task=Promise.resolve().then(()=>restore(query,maxRangeDays)).then(value=>{if(value&&!cache.has(key)&&Number.isFinite(Date.parse(value.observedAt))&&Date.parse(value.observedAt)<=now())retain(key,{...value,readFailed:true});}).catch(()=>null).finally(()=>restores.delete(key));restores.set(key,task);
  }
  if(!cache.has(key)&&restores.has(key)){let t;try{await Promise.race([restores.get(key),new Promise(resolve=>{t=setTimeout(resolve,150);})]);}finally{clearTimeout(t);}}
  let base=cache.get(key),job=jobs.get(key),failed=false;
  if(!job&&rateFailure&&now()-Date.parse(rateFailure.at)<rateFailure.retryAfterSeconds*1000){const d=diagnostic(key,'FAILED',rateFailure.code);if(!base)throw new ReportReadError(d);return {...base.value,readFailed:true,diagnostic:d};}
  if(query.force===true||!base||base.value.readFailed||now()-Date.parse(base.value.observedAt)>=maxAgeMs){
   const failure=failures.get(key),cooldown=(failure?.retryAfterSeconds||2)*1000;
   if(!job&&failure&&now()-Date.parse(failure.at)<cooldown){
    if(!base)throw new ReportReadError(diagnostic(key,'FAILED',failure.code));failed=true;
   }else{
    if(!job){
     if(jobs.size>=maxConcurrent){if(base)return {...base.value,readFailed:true,diagnostic:diagnostic(key,'PREPARING','ADS_REPORT_BUSY')};throw new ReportReadError(diagnostic(key,'PREPARING','ADS_REPORT_BUSY'));}
     job={id:randomUUID(),startedAt:now()};jobs.set(key,job);
     job.task=Promise.resolve().then(()=>read(query,maxRangeDays)).then(value=>{
      const entry=retain(key,value);failures.delete(key);lastSuccessAt=new Date(now()).toISOString();lastLatencyMs=now()-job.startedAt;
      return entry;
     }).catch(error=>{failures.set(key,{id:job.id,code:safeCode(error),at:new Date(now()).toISOString(),latencyMs:now()-job.startedAt,providerCode:Number.isInteger(error?.providerCode)?error.providerCode:null,providerSubcode:Number.isInteger(error?.providerSubcode)?error.providerSubcode:null,transient:error?.transient===true,retryAfterSeconds:Math.max(['META_RATE_LIMITED','META_HTTP_429'].includes(safeCode(error))?60:2,Number(error?.retryAfterSeconds)||0)});if(['META_RATE_LIMITED','META_HTTP_429'].includes(failures.get(key).code))rateFailure=failures.get(key);while(failures.size>maxEntries)failures.delete(failures.keys().next().value);throw error;}).finally(()=>jobs.delete(key));
    }
    // A valid previous cut returns immediately while its one refresh runs.
    // Keep timed-out jobs reserved until their actual network work settles.
    if(base&&query.force!==true){job.task.catch(()=>{});return {...base.value,readFailed:true,diagnostic:diagnostic(key,'PREPARING',now()-job.startedAt>=jobDeadlineMs?'META_TIMEOUT':'ADS_REPORT_PREPARING',job)};}
    if(now()-job.startedAt>=jobDeadlineMs)throw new ReportReadError(diagnostic(key,'FAILED','META_TIMEOUT',job));
    let timer;
    try{base=await Promise.race([job.task,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('WAIT_EXPIRED')),waitMs);})]);}
    catch{
     const pending=jobs.has(key),code=pending?'ADS_REPORT_PREPARING':failures.get(key)?.code||'META_SOURCE_UNAVAILABLE';
     if(!base)throw new ReportReadError(diagnostic(key,pending?'PREPARING':'FAILED',code,job));failed=true;
    }finally{clearTimeout(timer);}
   }
  }
  const stale=failed||base.value.readFailed||now()-Date.parse(base.value.observedAt)>=maxAgeMs;
  return {...base.value,readFailed:stale,diagnostic:stale?diagnostic(key,jobs.has(key)?'PREPARING':'FAILED',jobs.has(key)?'ADS_REPORT_PREPARING':failures.get(key)?.code||'META_SOURCE_UNAVAILABLE',jobs.get(key)):null};
 },status(){const failure=[...failures.values()].at(-1);return {source:'META_MARKETING_API',activeJobs:jobs.size,retainedReports:cache.size,lastSuccessfulReadAt:lastSuccessAt,lastLatencyMs,lastFailure:failure?{code:failure.code,at:failure.at,id:failure.id}:null,alert:failure?{severity:['META_HTTP_401','META_HTTP_403'].includes(failure.code)?'CRITICAL':'WARNING',code:failure.code,notificationsEnabled:false}:null};}};
}
