import {performance} from 'node:perf_hooks';
import {writeFile,mkdir} from 'node:fs/promises';
import {createAdsRuntime} from '../services/meta-ads/runtime.mjs';
import {createV11GraphFixture} from './ads-v11-fixtures.mjs';
const graph=createV11GraphFixture({delayMs:Number(process.env.V11_BENCH_DELAY_MS||20)});
const sql=async()=>({rows:[],rowCount:0}),pool={query:sql,connect:async()=>({query:sql,release(){}})};
const runtime=createAdsRuntime({env:{ADS_INTELLIGENCE_READ_ENABLED:'true',ADS_REVIEW_V8_ENABLED:'true',META_ACCESS_TOKEN:'DEMO_NON_SECRET',META_AD_ACCOUNT_ID:'9',TELEGRAM_ALLOWED_USER_IDS:'1'},pool,fetchImpl:graph.fetchImpl});
const observations=[];
async function measure(name,fn){const before=graph.calls.length,start=performance.now();let value;for(let attempt=0;attempt<40;attempt++){try{value=await fn();break;}catch(error){if(error.status!==202)throw error;await new Promise(r=>setTimeout(r,30));}}
 if(!value)throw Error('BENCH_NOT_COMPLETED');observations.push({name,ms:Number((performance.now()-start).toFixed(2)),requests:graph.calls.length-before,scope:value.analysis?.entity?.level||value.level,rows:value.rows?.length,partial:value.progress?.pending===true});return value;}
await measure('cold_overview',()=>runtime.review.report({period:'7d',level:'campaign'}));
// The cold core can now precede optional metadata. Account for that interval
// explicitly before measuring truly warm reads, rather than mixing warm-up.
{const start=performance.now(),before=graph.calls.length;while(runtime.reportStatus().requests.active||runtime.reportStatus().requests.queued){if(performance.now()-start>10000)throw Error('OPTIONAL_SETTLE_TIMEOUT');await new Promise(r=>setTimeout(r,20));}observations.push({name:'optional_metadata_settle',ms:Number((performance.now()-start).toFixed(2)),requests:graph.calls.length-before});}
const warm=[];for(let i=0;i<20;i++){const start=performance.now();await measure('warm_'+i,()=>runtime.review.report({period:'7d',level:'campaign'}));warm.push(performance.now()-start);}
await measure('cold_growth',()=>runtime.review.growth({period:'7d',level:'campaign'}));
for(let i=0;i<5;i++)await measure('entity_'+i,()=>runtime.review.growth({period:'7d',level:'campaign',campaignId:String(101+i),analysis:'true'}));
const sorted=warm.toSorted((a,b)=>a-b),percentile=p=>Number(sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1)].toFixed(2));
const result={scenario:'DEMO controlled latency; not production p95/TTFB/LCP',delayMs:Number(process.env.V11_BENCH_DELAY_MS||20),observations,warmMs:{p50:percentile(.5),p95:percentile(.95),p99:percentile(.99)},provider:graph.stats(),policy:'No budget executor called; no external network, no production credentials'};
const output=process.argv[2];if(output){await mkdir(new URL('.',new URL('file:///'+output.replaceAll('\\','/'))),{recursive:true}).catch(()=>{});await writeFile(output,JSON.stringify(result,null,2)+'\n');}
console.log(JSON.stringify(result,null,2));
