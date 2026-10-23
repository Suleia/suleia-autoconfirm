import {randomUUID} from 'node:crypto';
const safeCode=e=>{
 const c=e?.code||e?.message;
 if(['42501','42P01','42703','53300','57P01','57014'].includes(c))return 'ADS_DATABASE_UNAVAILABLE';
 if(/^META_HTTP_(400|401|403|429|500|502|503|504)$/.test(c||''))return c;
 if(['META_RATE_LIMITED','ACCOUNT_NOT_ELIGIBLE','INSIGHTS_IDENTITY_INVALID','CONTRACT_MISMATCH','META_PAGINATION_INCOMPLETE','META_PAGINATION_BLOCKED','META_PAYLOAD_INVALID','META_API_ERROR'].includes(c))return c;
 return ['TimeoutError','AbortError'].includes(e?.name)?'META_TIMEOUT':'META_SOURCE_UNAVAILABLE';
};
export class ReportReadError extends Error{
 constructor(diagnostic){super(diagnostic.code);this.code=diagnostic.code;this.status=diagnostic.state==='PREPARING'?202:503;this.diagnostic=diagnostic;}
}
export function reportDependencyError(error){return new ReportReadError({id:randomUUID(),source:'POSTGRESQL',state:'FAILED',code:'ADS_DATABASE_UNAVAILABLE',connection:'UNAVAILABLE',failedAt:new Date().toISOString(),checkedAt:new Date().toISOString(),lastValidAt:null,retryable:!['42501','42P01','42703'].includes(error?.code),retryAfterSeconds:5});}
// One bounded cache and one coalesced GET job per canonical range. No writers,
// notifications, credentials or raw provider errors enter diagnostics.
export function createReportCache({read,now=()=>Date.now(),waitMs=4000,maxAgeMs=120000,maxConcurrent=2,maxEntries=8,maxRows=40000}){
 const cache=new Map(),jobs=new Map(),failures=new Map();let lastSuccessAt=null,lastLatencyMs=null,rateFailure=null;
 const diagnostic=(key,state,code,job=null)=>{const failure=failures.get(key)||rateFailure;return ({id:job?.id||failure?.id||randomUUID(),source:code==='ADS_DATABASE_UNAVAILABLE'?'POSTGRESQL':'META_MARKETING_API',state,code,connection:state==='PREPARING'?'READING':code==='META_HTTP_401'||code==='META_HTTP_403'?'AUTH_REQUIRED':['META_HTTP_429','META_RATE_LIMITED'].includes(code)?'RATE_LIMITED':'UNAVAILABLE',providerCode:failure?.providerCode??null,providerSubcode:failure?.providerSubcode??null,transient:failure?.transient===true,failedAt:failure?.at||null,checkedAt:new Date(now()).toISOString(),lastValidAt:cache.get(key)?.value.observedAt||null,lastSuccessfulReadAt:lastSuccessAt,latencyMs:job?now()-job.startedAt:failure?.latencyMs??null,retryable:!['META_HTTP_400','META_HTTP_401','META_HTTP_403','ACCOUNT_NOT_ELIGIBLE','CONTRACT_MISMATCH','INSIGHTS_IDENTITY_INVALID','ADS_DATABASE_UNAVAILABLE'].includes(code),retryAfterSeconds:['META_HTTP_429','META_RATE_LIMITED'].includes(code)?60:2,cache:cache.has(key)?'HISTORICAL':'EMPTY'});};
 return {async snapshot(key,query,maxRangeDays){
  let base=cache.get(key),job=jobs.get(key),failed=false;
  if(!job&&rateFailure&&now()-Date.parse(rateFailure.at)<60000){const d=diagnostic(key,'FAILED',rateFailure.code);if(!base)throw new ReportReadError(d);return {...base.value,readFailed:true,diagnostic:d};}
  if(query.force===true||!base||now()-Date.parse(base.value.observedAt)>=maxAgeMs){
   const failure=failures.get(key),cooldown=['META_HTTP_429','META_RATE_LIMITED'].includes(failure?.code)?60000:2000;
   if(!job&&failure&&now()-Date.parse(failure.at)<cooldown){
    if(!base)throw new ReportReadError(diagnostic(key,'FAILED',failure.code));failed=true;
   }else{
    if(!job){
     if(jobs.size>=maxConcurrent)throw new ReportReadError(diagnostic(key,'PREPARING','ADS_REPORT_BUSY'));
     job={id:randomUUID(),startedAt:now()};jobs.set(key,job);
     job.task=Promise.resolve().then(()=>read(query,maxRangeDays)).then(value=>{
      const rowCount=Object.values(value.dataset.current).flat().length+Object.values(value.dataset.prior).flat().length+Object.values(value.dataset.daily).flat().length;
      const entry={value,rowCount};cache.delete(key);cache.set(key,entry);failures.delete(key);lastSuccessAt=new Date(now()).toISOString();lastLatencyMs=now()-job.startedAt;
      while(cache.size>maxEntries||(cache.size>1&&[...cache.values()].reduce((n,r)=>n+r.rowCount,0)>maxRows))cache.delete(cache.keys().next().value);
      return entry;
     }).catch(error=>{failures.set(key,{id:job.id,code:safeCode(error),at:new Date(now()).toISOString(),latencyMs:now()-job.startedAt,providerCode:Number.isInteger(error?.providerCode)?error.providerCode:null,providerSubcode:Number.isInteger(error?.providerSubcode)?error.providerSubcode:null,transient:error?.transient===true});if(['META_RATE_LIMITED','META_HTTP_429'].includes(failures.get(key).code))rateFailure=failures.get(key);while(failures.size>maxEntries)failures.delete(failures.keys().next().value);throw error;}).finally(()=>jobs.delete(key));
    }
    let timer;
    try{base=await Promise.race([job.task,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('WAIT_EXPIRED')),waitMs);})]);}
    catch{
     const pending=jobs.has(key),code=pending?'ADS_REPORT_PREPARING':failures.get(key)?.code||'META_SOURCE_UNAVAILABLE';
     if(!base)throw new ReportReadError(diagnostic(key,pending?'PREPARING':'FAILED',code,job));failed=true;
    }finally{clearTimeout(timer);}
   }
  }
  const stale=failed||now()-Date.parse(base.value.observedAt)>=maxAgeMs;
  return {...base.value,readFailed:stale,diagnostic:stale?diagnostic(key,jobs.has(key)?'PREPARING':'FAILED',jobs.has(key)?'ADS_REPORT_PREPARING':failures.get(key)?.code||'META_SOURCE_UNAVAILABLE',jobs.get(key)):null};
 },status(){const failure=[...failures.values()].at(-1);return {source:'META_MARKETING_API',activeJobs:jobs.size,retainedReports:cache.size,lastSuccessfulReadAt:lastSuccessAt,lastLatencyMs,lastFailure:failure?{code:failure.code,at:failure.at,id:failure.id}:null,alert:failure?{severity:['META_HTTP_401','META_HTTP_403'].includes(failure.code)?'CRITICAL':'WARNING',code:failure.code,notificationsEnabled:false}:null};}};
}
