// Reporting shares completed GET results; the budget engine keeps its original
// uncached reader and every required fresh financial revalidation.
const observed=new WeakMap();
export const sourceReadAt=value=>value&&typeof value==='object'&&observed.has(value)?observed.get(value):null;
export function reportReader(reader,{now=()=>Date.now(),ttlMs=60000,maxEntries=96,maxRows=60000}={}){
 const cache=new Map(),jobs=new Map();let hits=0,misses=0,coalesced=0;
 const methods=new Set(['readAccount','readAccountInsights','readEntities','readCreatives','readRules','readInsights','readAuditDetails','readActivityHistory','readHourlyTraffic','readHourlyReportedActions','readReviewBreakdown','readReviewVideos','readAdRankings']);
 const stats=()=>({hits,misses,coalesced,entries:cache.size,activeJobs:jobs.size,retainedRows:[...cache.values()].reduce((n,e)=>n+e.rows,0)});
 return new Proxy(Object.create(null),{get(_target,key){
  if(key==='cacheStatus')return stats;
  if(key==='invalidateInsights')return ({ranges,levels})=>{for(const id of cache.keys())if(id.startsWith('readInsights:')||id.startsWith('readAccountInsights:')){const q=JSON.parse(id.slice(id.indexOf(':')+1))[0];if((!q.level||levels.includes(q.level))&&ranges.some(r=>r.since===q.since&&r.until===q.until))cache.delete(id);}};
  const value=reader[key];if(typeof value!=='function')return value;
  if(!methods.has(key))return value.bind(reader);
  return async(...args)=>{
   const canonical=['readInsights','readAccountInsights'].includes(key)&&args[0]?.since?[{since:args[0].since,until:args[0].until,level:args[0].level,daily:Boolean(args[0].daily),extended:Boolean(args[0].extended)}]:args;
   const id=key+':'+JSON.stringify(canonical),entry=cache.get(id),ttl=['readInsights','readAccountInsights'].includes(key)?ttlMs:Math.max(ttlMs,300000);
   if(entry&&now()-entry.at<ttl){hits++;return entry.value;}
   if(jobs.has(id)){coalesced++;return jobs.get(id);}
   misses++;const at=now();
   const task=Promise.resolve().then(()=>value.apply(reader,args)).then(result=>{
    if(result&&typeof result==='object')observed.set(result,at);
    const rows=Array.isArray(result)?result.length:1;
    if(rows<=maxRows){cache.delete(id);cache.set(id,{at,value:result,rows});while(cache.size>maxEntries||(cache.size>1&&[...cache.values()].reduce((n,e)=>n+e.rows,0)>maxRows))cache.delete(cache.keys().next().value);}
    return result;
   }).finally(()=>jobs.delete(id));jobs.set(id,task);return task;
  };
 }});
}
