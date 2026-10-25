// CPU-only synthetic benchmark; no network, secrets or production records.
import {fixture,now} from './business-v2-fixtures.mjs';
import {aggregateFacts} from '../packages/platform-core/src/analytics/order-intelligence.mjs';
import {buildAnalyticsReport as current} from '../packages/platform-core/src/analytics/report.mjs';
import {pathToFileURL} from 'node:url';
const source=fixture(),facts=Array.from({length:2000},(_,i)=>({...source[i%source.length],canonical_order_id:'PERF-DEMO-'+i,created_local_date:'2026-08-'+String(i%28+1).padStart(2,'0'),maturity:'MATURE'})),cells=aggregateFacts(facts),filters={date_from:'2026-08-01',date_to:'2026-08-31'};
const build=process.argv[2]?(await import(pathToFileURL(process.argv[2]).href)).buildAnalyticsReport:current;
const results=[];
for(const[tool,target]of [['get_order_intelligence_overview',1000],['get_geographic_performance',1500],['get_hourly_performance',1500],['get_detected_patterns',2000]]){const times=[];for(let i=0;i<23;i++){const start=performance.now();const r=build({cells,filters,tool,now});JSON.stringify(r);if(i>=3)times.push(performance.now()-start);}times.sort((a,b)=>a-b);results.push({tool,warmup:3,samples:20,p50Ms:+times[9].toFixed(2),p95Ms:+times[18].toFixed(2),maxMs:+times[19].toFixed(2),targetMs:target,pass:times[18]<target});}
console.log(JSON.stringify({scope:'Synthetic engine plus JSON serialization; not HTTP/SQL SLA',orders:facts.length,cells:cells.length,results}));
if(results.some(r=>!r.pass))process.exitCode=1;
