import { buildAnalyticsReport } from '../../../platform-core/src/analytics/report.mjs';
import { overviewCacheKey, validateFilters } from '../../../platform-core/src/analytics/order-intelligence.mjs';
// Only analytics projections are reachable through this service. No provider,
// event-store, private message or plaintext customer query is permitted.
const caches=new WeakMap();
export function createAnalyticsReader(query,{enabled=true,ttl=30000}={}){
 let cached=null,pending=null;const reports=new Map(),prepared=new Map();
 async function snapshot(){if(cached&&Date.now()-cached.at<ttl)return cached.value;if(pending)return pending;pending=(async()=>{const [cells,days,state]=await Promise.all([query('SELECT cell FROM analytics.order_cells ORDER BY business_date,cell_key'),query('SELECT body FROM analytics.finance_days ORDER BY business_date'),query("SELECT body FROM analytics.runtime_state WHERE state_key='materializer'")]);const value={cells:cells.map(r=>r.cell),financeDays:days.map(r=>r.body),runtime:state[0]?.body||{}};cached={at:Date.now(),value};return value;})().finally(()=>{pending=null;});return pending;}
 return async(tool,filters)=>{
  if(!enabled||process.env.ORDER_INTELLIGENCE_ENABLED==='false')throw Object.assign(new Error('analytics_disabled'),{status:503});
  if(tool==='get_order_intelligence_overview'){
   const f=validateFilters(filters),key=overviewCacheKey(f);let entry=prepared.get(key);
   if(!entry||Date.now()-entry.at>=ttl){const rows=await query("SELECT s.body,r.body AS runtime FROM analytics.overview_snapshots s LEFT JOIN analytics.runtime_state r ON r.state_key='materializer' WHERE s.cache_key=$1",[key]);entry={at:Date.now(),body:rows[0]?.body||null,runtime:rows[0]?.runtime||{}};if(prepared.size>=32)prepared.delete(prepared.keys().next().value);prepared.set(key,entry);}
   if(entry.body){const r=structuredClone(entry.body),fresh=r.meta.freshness,t=Date.now();fresh.age_seconds=fresh.source_updated_at?Math.max(0,(t-Date.parse(fresh.source_updated_at))/1000):null;fresh.analytics_age_seconds=fresh.analytics_updated_at?Math.max(0,(t-Date.parse(fresh.analytics_updated_at))/1000):null;fresh.finance_age_seconds=fresh.finance_updated_at?Math.max(0,(t-Date.parse(fresh.finance_updated_at))/1000):null;if(entry.runtime.last_error||fresh.age_seconds===null||fresh.analytics_age_seconds===null)fresh.freshness_status='DEGRADED';else if(fresh.age_seconds>3600||fresh.analytics_age_seconds>1800)fresh.freshness_status='STALE';else if(fresh.finance_age_seconds===null||fresh.finance_age_seconds>3600)fresh.freshness_status='DEGRADED';r.meta.runtime.last_error=entry.runtime.last_error||null;r.meta.filters=f;r.meta.precomputed=true;return r;}
  }
  const snap=await snapshot();const normalized=filters instanceof URLSearchParams?Object.fromEntries(filters):filters;const key=JSON.stringify([cached.at,tool,normalized]);if(reports.has(key))return reports.get(key);const result=buildAnalyticsReport({...snap,tool,filters});if(reports.size>=64)reports.delete(reports.keys().next().value);reports.set(key,result);return result;
 };
}
export function analyticsForPool(pool){if(!caches.has(pool))caches.set(pool,createAnalyticsReader(async(sql,args)=>(await pool.query(sql,args)).rows));return caches.get(pool);}
