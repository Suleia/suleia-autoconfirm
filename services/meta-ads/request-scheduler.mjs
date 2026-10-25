// One account/token read queue shared by the existing client and its views.
// Priorities govern reads only; they never waive freshness or authorize writes.
const rateCodes=new Set(['META_RATE_LIMITED','META_HTTP_429','META_QUOTA_RESERVED']);
const error=(code,retryAfterSeconds=1,extra={})=>Object.assign(new Error(code),{name:'MetaAdsReadError',code,retryAfterSeconds,...extra});
export function retryAfterMs(value,now=Date.now()){
 if(value==null||String(value).trim()==='')return 0;
 const seconds=Number(value);return Number.isFinite(seconds)&&seconds>=0?Math.ceil(seconds*1000):Math.max(0,Date.parse(value)-now)||0;
}
export function createMetaReadScheduler({now=Date.now,random=Math.random,maxConcurrent=2,maxAnalysisConcurrent=1,maxQueued=64,queueTimeoutMs=30000}={}){
 let active=0,analysis=0,sequence=0,cooldownUntil=0,cooldownCode=null,lastFailure=null,consecutiveRates=0,transientFailures=0,usage=null;
 const queue=[],latencies=[],counts={requests:0,succeeded:0,failed:0,quotaBlocked:0,queueRejected:0,peakConcurrent:0};
 const blocked=()=>cooldownUntil>now()?error(cooldownCode||'META_RATE_LIMITED',Math.max(1,Math.ceil((cooldownUntil-now())/1000)),lastFailure||{}):null;
 function observe(headers){
  const read=name=>{try{return JSON.parse(headers?.get?.(name)||'null');}catch{return null;}};
  const app=read('x-app-usage'),account=read('x-ad-account-usage'),business=read('x-business-use-case-usage');
  const safe=row=>Object.fromEntries(['call_count','total_cputime','total_time','estimated_time_to_regain_access'].filter(k=>Number.isFinite(Number(row?.[k]))).map(k=>[k,Number(row[k])]));
  const groups=Object.values(business||{}).flat().filter(r=>r&&typeof r==='object').map(r=>({...safe(r),type:['ads_insights','ads_management'].includes(r.type)?r.type:'other'}));
  if(app||account||groups.length)usage={at:new Date(now()).toISOString(),app:app?safe(app):null,account:account?{accIdUtilPct:Number(account.acc_id_util_pct)||0}:null,business:groups};
  return {retryAfterMs:retryAfterMs(headers?.get?.('retry-after'),now()),regainMs:Math.max(0,...groups.map(g=>(g.estimated_time_to_regain_access||0)*60000))};
 }
 function recordFailure(e){
  if(rateCodes.has(e?.code)){
   consecutiveRates++;const fallback=Math.min(900000,60000*2**Math.min(4,consecutiveRates-1));
   cooldownUntil=now()+Math.max((e.retryAfterSeconds||0)*1000,e.regainMs||0,fallback+Math.floor(random()*Math.min(10000,fallback*.1)));
   cooldownCode='META_RATE_LIMITED';lastFailure={providerCode:Number.isInteger(e.providerCode)?e.providerCode:null,providerSubcode:Number.isInteger(e.providerSubcode)?e.providerSubcode:null};
  }else if(['META_HTTP_500','META_HTTP_502','META_HTTP_503','META_HTTP_504','META_TIMEOUT'].includes(e?.code)||['AbortError','TimeoutError','TypeError'].includes(e?.name)){
   if(++transientFailures>=3){cooldownUntil=now()+30000;cooldownCode='META_CIRCUIT_OPEN';lastFailure=null;}
  }
 }
 function pump(){
  const block=blocked();if(block){for(const q of queue.splice(0)){clearTimeout(q.timer);counts.quotaBlocked++;q.reject(block);}return;}
  queue.sort((a,b)=>a.priority-b.priority||a.sequence-b.sequence);
  while(active<maxConcurrent){
   const i=queue.findIndex(q=>q.priority===0||analysis<maxAnalysisConcurrent);if(i<0)return;
   const q=queue.splice(i,1)[0];clearTimeout(q.timer);active++;if(q.priority>0)analysis++;
   counts.requests++;counts.peakConcurrent=Math.max(counts.peakConcurrent,active);const started=now();
   Promise.resolve().then(q.task).then(value=>{counts.succeeded++;transientFailures=0;consecutiveRates=0;q.resolve(value);},e=>{counts.failed++;recordFailure(e);q.reject(e);}).finally(()=>{
    latencies.push(Math.max(0,now()-started));if(latencies.length>256)latencies.shift();active--;if(q.priority>0)analysis--;pump();
   });
  }
 }
 function schedule(task,{priority=0}={}){
  const block=blocked();if(block){counts.quotaBlocked++;return Promise.reject(block);}
  const high=usage&&now()-Date.parse(usage.at)<30000&&Math.max(usage.account?.accIdUtilPct||0,usage.app?.call_count||0,usage.app?.total_cputime||0,usage.app?.total_time||0,...usage.business.flatMap(g=>[g.call_count||0,g.total_time||0,g.total_cputime||0]))>=95;
  if(priority>0&&high){counts.quotaBlocked++;return Promise.reject(error('META_QUOTA_RESERVED',Math.max(1,Math.ceil((30000-now()+Date.parse(usage.at))/1000))));}
  if(queue.length>=maxQueued){counts.queueRejected++;return Promise.reject(error('META_QUEUE_FULL',2));}
  return new Promise((resolve,reject)=>{
   const q={task,priority,resolve,reject,sequence:sequence++,timer:null};
   q.timer=setTimeout(()=>{const i=queue.indexOf(q);if(i>=0)queue.splice(i,1);counts.queueRejected++;reject(error('META_QUEUE_TIMEOUT',2));},queueTimeoutMs);
   queue.push(q);pump();
  });
 }
 return {schedule,observe,status(){const sorted=latencies.toSorted((a,b)=>a-b),p=v=>sorted.length?sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*v)-1)]:null;return {...counts,active,analysisActive:analysis,queued:queue.length,cooldownUntil:cooldownUntil>now()?new Date(cooldownUntil).toISOString():null,circuit:blocked()?'OPEN':'CLOSED',lastFailure,usage,latencyMs:{samples:sorted.length,p50:p(.5),p95:p(.95),p99:p(.99)}};}};
}
