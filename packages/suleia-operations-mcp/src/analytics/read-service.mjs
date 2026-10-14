import { buildAnalyticsReport } from '../../../platform-core/src/analytics/report.mjs';
// Only analytics projections are reachable through this service. No provider,
// event-store, private message or plaintext customer query is permitted.
const caches=new WeakMap();
export function createAnalyticsReader(query,{enabled=true,ttl=30000}={}){
 let cached=null,pending=null;const reports=new Map();
 async function snapshot(){if(cached&&Date.now()-cached.at<ttl)return cached.value;if(pending)return pending;pending=(async()=>{const [cells,days,state]=await Promise.all([query('SELECT cell FROM analytics.order_cells ORDER BY business_date,cell_key'),query('SELECT body FROM analytics.finance_days ORDER BY business_date'),query("SELECT body FROM analytics.runtime_state WHERE state_key='materializer'")]);const value={cells:cells.map(r=>r.cell),financeDays:days.map(r=>r.body),runtime:state[0]?.body||{}};cached={at:Date.now(),value};return value;})().finally(()=>{pending=null;});return pending;}
 return async(tool,filters)=>{if(!enabled||process.env.ORDER_INTELLIGENCE_ENABLED==='false')throw Object.assign(new Error('analytics_disabled'),{status:503});const snap=await snapshot();const normalized=filters instanceof URLSearchParams?Object.fromEntries(filters):filters;const key=JSON.stringify([cached.at,tool,normalized]);if(reports.has(key))return reports.get(key);const result=buildAnalyticsReport({...snap,tool,filters});if(reports.size>=64)reports.delete(reports.keys().next().value);reports.set(key,result);return result;};
}
export function analyticsForPool(pool){if(!caches.has(pool))caches.set(pool,createAnalyticsReader(async(sql,args)=>(await pool.query(sql,args)).rows));return caches.get(pool);}
