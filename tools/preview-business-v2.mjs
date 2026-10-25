// Local, synthetic acceptance harness. Never imported by API/runtime or deployed.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {growthFixtureDataset,growthFixtureGoals,GROWTH_FIXTURE_NOW} from '../services/meta-ads/review/growth-fixtures.mjs';
import {createReviewService} from '../services/meta-ads/review/service.mjs';
import {buildAnalyticsReport} from '../packages/platform-core/src/analytics/report.mjs';
import {buildResultsFinanceReport} from '../packages/platform-core/src/finance/results-report.mjs';
import * as demo from './operations-v11-fixtures.mjs';
import * as bi from './business-v2-fixtures.mjs';
import {ReportReadError} from '../services/meta-ads/report-cache.mjs';
const root=resolve('apps/review-panel'),port=Number(process.env.BI_PREVIEW_PORT||4412),entries=[],calls=[];
const ledger={reviewById:async id=>entries.find(r=>r.id===id)||null,autopilotAudit:async()=>({entries:[],nextCursor:null}),reviewHistory:async()=>({entries,nextCursor:null}),appendReviewRecord:async x=>{
 const id=createHash('sha256').update(JSON.stringify(x)).digest('hex');if(!entries.some(r=>r.id===id))entries.push({id,created_at:new Date(GROWTH_FIXTURE_NOW).toISOString(),reference:x.reference,body:{...x}});return {id,execution:'REVIEW_ONLY'};
}};
let scenario='normal';
function service(){return createReviewService({snapshot:async range=>{
 if(['rate','auth'].includes(scenario))throw new ReportReadError({source:'META_MARKETING_API',state:'FAILED',code:scenario==='rate'?'META_RATE_LIMITED':'META_HTTP_401',providerCode:scenario==='rate'?17:190,retryable:false,retryAfterSeconds:180,connection:scenario==='rate'?'RATE_LIMITED':'AUTH_REQUIRED',checkedAt:new Date().toISOString()});
 if(range.since<'2026-10-01'&&scenario==='slow')await new Promise(r=>setTimeout(r,7000));
 if(range.since<'2026-10-01'&&scenario==='optional')throw Error('META_OPTIONAL_SOURCE_UNAVAILABLE');
 const dataset=growthFixtureDataset(range);if(scenario==='stale'){dataset.observedAt='2026-10-23T18:00:00Z';dataset.readFailed=true;}return {dataset,readFailed:scenario==='stale'};
 },extras:async range=>({metadata:growthFixtureDataset(range).entities}),ledger,readGrowthGoals:async()=>growthFixtureGoals(),now:()=>GROWTH_FIXTURE_NOW});}
let review=service();const growth={get:q=>review.growth(q)};
const send=(res,data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({ok:status<400,data}));};
const banner=`<div class="fixture-banner" role="status">DEMO BI V2 · DATOS SIMULADOS · SIN CONEXIONES EXTERNAS<details class="qa-scenarios"><summary>Escenarios QA</summary><form action="/__scenario"><select name="state" aria-label="Escenario de prueba"><option value="normal">Normal</option><option value="slow">Histórico lento</option><option value="rate">Meta código 17</option><option value="stale">Lectura histórica</option><option value="optional">Fallo opcional</option><option value="auth">Meta sin acceso</option></select><button>Aplicar escenario</button></form></details></div><style>.fixture-banner{position:sticky;top:0;z-index:99;background:#e1f6ed;color:#086b60;font:700 11px/24px system-ui;text-align:center;letter-spacing:.6px;border-bottom:1px solid #a8dfd1}.qa-scenarios{position:absolute;right:12px;top:0;font-size:10px;letter-spacing:0}.qa-scenarios form{background:white;padding:8px;border:1px solid #a8dfd1}.qa-scenarios summary{cursor:pointer}body{padding-top:0!important}</style>`;
const metrics=`<details id="v11-perf" style="position:fixed;bottom:5px;right:8px;z-index:1000;background:#fff;border:1px solid #d4e7f4;border-radius:6px;padding:4px 8px;font:10px system-ui;max-width:360px"><summary>Mediciones DEMO</summary><pre></pre></details><script>let lcp=null,cls=0;try{new PerformanceObserver(list=>{lcp=list.getEntries().at(-1).startTime;}).observe({type:'largest-contentful-paint',buffered:true});new PerformanceObserver(list=>{for(const e of list.getEntries())if(!e.hadRecentInput)cls+=e.value;}).observe({type:'layout-shift',buffered:true});}catch{}setInterval(()=>{const n=performance.getEntriesByType('navigation')[0],r=performance.getEntriesByType('resource').filter(x=>x.name.includes('/api/'));document.querySelector('#v11-perf pre').textContent=JSON.stringify({scenario:'DEMO localhost',ttfbMs:n?Math.round(n.responseStart):null,lcpMs:lcp?Math.round(lcp):null,cls:Number(cls.toFixed(4)),apiRequests:r.length,apiP95Ms:r.length?Math.round(r.map(x=>x.duration).sort((a,b)=>a-b)[Math.ceil(r.length*.95)-1]):null},null,2);},1000);</script>`;
const server=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://127.0.0.1:'+port),path=url.pathname,q=Object.fromEntries(url.searchParams);calls.push({method:req.method,path});
 if(path==='/__responsive'){
  const sizes={'1920':[1920,1080],'1440':[1440,900],'1366':[1366,768],'tablet':[820,1180],'mobile':[390,844]},[w,h]=sizes[q.size]||sizes.mobile;
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>DEMO BI V2 · Responsive QA</title><style>body{margin:0;background:#dce8f3;color:#143357;font:12px system-ui}header{padding:8px 12px;display:flex;gap:16px;align-items:center;background:white;position:sticky;top:0;z-index:10}iframe{display:block;border:1px solid #b7cddd;margin:12px;width:${w}px;height:${h}px}button,select{font:inherit;padding:5px}p{margin:0}</style></head><body><header><strong>DEMO BI V2 · viewport de iframe real ${w} × ${h}</strong><form action="/__responsive"><label>Tamaño de prueba <select name="size">${Object.entries(sizes).map(([k,[w,h]])=>`<option value="${k}" ${q.size===k?'selected':''}>${w} × ${h}</option>`).join('')}</select></label><button>Probar tamaño</button></form><p>Sin conexión con producción · pruebas de CSS y navegación</p></header><iframe id="qa-frame" title="Suleia DEMO responsive ${w}x${h}" src="/#analytics"></iframe></body></html>`);return;
 }
 if(path==='/__scenario'){if(!['normal','slow','rate','stale','optional','auth'].includes(q.state))return send(res,{},400);scenario=q.state;review=service();res.writeHead(302,{Location:'/#analytics'});res.end();return;}
 if(path==='/favicon.ico'){res.writeHead(204);res.end();return;}
 if(path==='/api/config'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({oauth:{issuer:'http://127.0.0.1:'+port+'/__demo-oauth',client_id:'fixture',scope:'openid operations:read',audience:'fixture'},ads_review_v7_enabled:true,ads_review_v8_enabled:true,refresh_interval_seconds:45,finance_refresh_interval_seconds:120,analytics_enabled:true}));return;}
 if(path==='/__demo-oauth/protocol/openid-connect/auth'){const state=q.state,back=new URL(q.redirect_uri);back.searchParams.set('code','synthetic-local-code');back.searchParams.set('state',state);res.writeHead(302,{Location:back.href});res.end();return;}
 if(path==='/__demo-oauth/protocol/openid-connect/token'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({access_token:'synthetic-development-only',expires_in:3600}));return;}
 if(path.startsWith('/api/')){
  if(req.headers.authorization!=='Bearer synthetic-development-only')return send(res,{error:'unauthorized'},401);
  if(path.endsWith('/ads-intelligence/status'))return send(res,{source:'LOCAL_DEMO_NO_META_CONNECTION',activeJobs:0,retainedReports:0,requests:{queued:0,circuit:'CLOSED',requests:0,latencyMs:{p50:null,p95:null,p99:null}},reportCache:{hits:0}});
  if(path.endsWith('/review/growth'))return send(res,await growth.get(q));
  if(path.endsWith('/review/records')){if(req.method==='POST'){let body='';for await(const chunk of req)body+=chunk;return send(res,await review.record({...JSON.parse(body),principal:'LOCAL_DEMO_OWNER'}));}return send(res,await ledger.reviewHistory());}
  if(path.endsWith('/review'))return send(res,await review.report(q));
  if(path.endsWith('/review/query'))return send(res,{text:'DEMO · Respuesta determinista. No se ejecutan acciones.',externalWrites:0});
  if(path.endsWith('/executive/history'))return send(res,{entries:[],nextCursor:null});
  if(path.endsWith('/executive/schedule'))return send(res,{enabled:false,timezone:'Europe/Madrid',recipients:0,nextExecution:null});
  if(path.endsWith('/autopilot/history'))return send(res,{entries:[],nextCursor:null});
  if(path.endsWith('/autopilot'))return send(res,{mode:'SHADOW',enabled:false,liveEnabled:false,observedAt:new Date(GROWTH_FIXTURE_NOW).toISOString(),nextReviewAt:null,lastExecutionAt:null,writesEnabled:false,policy:{minCampaignBudgetCents:1500,maxCampaignBudgetCents:7000},campaigns:[],timeline:[],alerts:[],reviewTimes:['07:00','12:00','19:00','22:30','23:59'],policyConflicts:[],legacyLimits:{maxChangePercent:10,maxAggregateIncreaseCents:3000,campaignCooldownMs:86400000},externalWrites:0});
  if(path.endsWith('/summary'))return send(res,demo.summary());
  if(path.includes('/incidents/overview'))return send(res,demo.incidents(q));
  if(path.endsWith('/orders'))return send(res,demo.orderQueue());
  if(path.includes('/automation/overview'))return send(res,demo.automation());
  if(path.endsWith('/analytics')){if(scenario==='auth')return send(res,{error:'DEMO_ANALYTICS_UNAVAILABLE'},503);return send(res,bi.analytics(q));}
  if(path.endsWith('/finance'))return send(res,demo.finance(q));
  if(path.endsWith('/product-costs'))return send(res,{rates:[],findings:[],revision:'0'});
  return send(res,{error:'DEMO_ENDPOINT_NOT_CONFIGURED'},404);
 }
 if(path.startsWith('/__fixture-creative/')){res.setHeader('Content-Type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240"><defs><linearGradient id="b"><stop stop-color="#e3f8f4"/><stop offset="1" stop-color="#e5edff"/></linearGradient></defs><rect width="400" height="240" fill="url(#b)"/><rect x="165" y="45" width="70" height="25" rx="5" fill="#d7c4aa"/><rect x="150" y="65" width="100" height="135" rx="20" fill="#fffaf4" stroke="#d9d7d2"/><text x="200" y="117" text-anchor="middle" fill="#1a6c64" font-family="sans-serif" font-size="16">AQUA</text><text x="200" y="140" text-anchor="middle" fill="#687a8e" font-family="sans-serif" font-size="10">CREATIVIDAD DEMO</text></svg>');return;}
 if(path==='/__qa'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({calls,entries,externalConnections:0,metaWrites:0}));return;}
 const file=resolve(root,path==='/'?'index.html':decodeURIComponent(path).replace(/^\//,''));if(file!==root&&!file.startsWith(root+sep))return send(res,{},403);
 const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml'};res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');res.setHeader('Cache-Control','no-store');
 let content=await readFile(file);if(file.endsWith('ads-review-v6.js'))content=content.toString().replace('}catch(error){if(current!==generation',"}catch(error){console.error('LOCAL_RENDER_ERROR',error.stack);if(current!==generation");
 if(extname(file)==='.html')content=content.toString().replace('<body>','<body>'+banner.replace('value="'+scenario+'">','value="'+scenario+'" selected>')).replace('</body>',metrics+'</body>').replace(/content="https:\/\/mcp\.suleia\.com\/operations"/g,'content=""');res.end(content);
 }catch(error){if(error.diagnostic){res.writeHead(error.status||503,{'Content-Type':'application/json','Retry-After':String(error.diagnostic.retryAfterSeconds||1)});res.end(JSON.stringify({ok:false,diagnostic:error.diagnostic}));}else{console.error(error.message);send(res,{error:'LOCAL_FIXTURE_ERROR'},500);}}});
server.listen(port,'127.0.0.1',()=>console.log('Synthetic-only BI V2 preview http://127.0.0.1:'+port+'/#analytics'));
