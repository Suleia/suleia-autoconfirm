// Local, synthetic acceptance harness. Never imported by API/runtime or deployed.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {growthFixtureDataset,growthFixtureGoals,GROWTH_FIXTURE_NOW} from '../services/meta-ads/review/growth-fixtures.mjs';
import {createReviewService} from '../services/meta-ads/review/service.mjs';
import {buildAnalyticsReport} from '../packages/platform-core/src/analytics/report.mjs';
import {buildResultsFinanceReport} from '../packages/platform-core/src/finance/results-report.mjs';
const root=resolve('apps/review-panel'),port=Number(process.env.V10_PREVIEW_PORT||4410),entries=[],calls=[];
const ledger={reviewById:async id=>entries.find(r=>r.id===id)||null,autopilotAudit:async()=>({entries:[],nextCursor:null}),reviewHistory:async()=>({entries,nextCursor:null}),appendReviewRecord:async x=>{
 const id=createHash('sha256').update(JSON.stringify(x)).digest('hex');if(!entries.some(r=>r.id===id))entries.push({id,created_at:new Date(GROWTH_FIXTURE_NOW).toISOString(),reference:x.reference,body:{...x}});return {id,execution:'REVIEW_ONLY'};
}};
const review=createReviewService({snapshot:async range=>({dataset:growthFixtureDataset(range)}),extras:async range=>({metadata:growthFixtureDataset(range).entities}),ledger,readGrowthGoals:async()=>growthFixtureGoals(),now:()=>GROWTH_FIXTURE_NOW});
const growth={get:review.growth};
const send=(res,data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({ok:status<400,data}));};
const banner=`<div class="fixture-banner" role="status">DEMOSTRACIÓN V10 · DATOS SIMULADOS · SIN CONEXIONES EXTERNAS</div><style>.fixture-banner{position:sticky;top:0;z-index:99;background:#e1f6ed;color:#086b60;font:700 11px/24px system-ui;text-align:center;letter-spacing:.6px;border-bottom:1px solid #a8dfd1}body{padding-top:0!important}</style>`;
const server=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://127.0.0.1:'+port),path=url.pathname,q=Object.fromEntries(url.searchParams);calls.push({method:req.method,path});
 if(path==='/api/config'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({oauth:{issuer:'http://127.0.0.1:'+port+'/__demo-oauth',client_id:'fixture',scope:'openid operations:read',audience:'fixture'},ads_review_v7_enabled:true,ads_review_v8_enabled:true,refresh_interval_seconds:45,finance_refresh_interval_seconds:120,analytics_enabled:true}));return;}
 if(path==='/__demo-oauth/protocol/openid-connect/auth'){const state=q.state,back=new URL(q.redirect_uri);back.searchParams.set('code','synthetic-local-code');back.searchParams.set('state',state);res.writeHead(302,{Location:back.href});res.end();return;}
 if(path==='/__demo-oauth/protocol/openid-connect/token'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({access_token:'synthetic-development-only',expires_in:3600}));return;}
 if(path.startsWith('/api/')){
  if(req.headers.authorization!=='Bearer synthetic-development-only')return send(res,{error:'unauthorized'},401);
  if(path.endsWith('/review/growth'))return send(res,await growth.get(q));
  if(path.endsWith('/review/records')){if(req.method==='POST'){let body='';for await(const chunk of req)body+=chunk;return send(res,await review.record({...JSON.parse(body),principal:'LOCAL_DEMO_OWNER'}));}return send(res,await ledger.reviewHistory());}
  if(path.endsWith('/review'))return send(res,await review.report(q));
  if(path.endsWith('/review/query'))return send(res,{text:'DEMO · Respuesta determinista. No se ejecutan acciones.',externalWrites:0});
  if(path.endsWith('/executive/history'))return send(res,{entries:[],nextCursor:null});
  if(path.endsWith('/executive/schedule'))return send(res,{enabled:false,timezone:'Europe/Madrid',recipients:0,nextExecution:null});
  if(path.endsWith('/autopilot/history'))return send(res,{entries:[],nextCursor:null});
  if(path.endsWith('/autopilot'))return send(res,{mode:'SHADOW',enabled:false,liveEnabled:false,observedAt:new Date(GROWTH_FIXTURE_NOW).toISOString(),nextReviewAt:null,lastExecutionAt:null,writesEnabled:false,policy:{minCampaignBudgetCents:1500,maxCampaignBudgetCents:7000},campaigns:[],timeline:[],alerts:[],reviewTimes:['07:00','12:00','19:00','22:30','23:59'],policyConflicts:[],legacyLimits:{maxChangePercent:10,maxAggregateIncreaseCents:3000,campaignCooldownMs:86400000},externalWrites:0});
  if(path.endsWith('/summary'))return send(res,{orders:{},incidents:{},protections:{},connectors:[]});
  if(path.includes('/incidents/overview'))return send(res,{total:0,items:[],summary:{scope:'ACTIVE',counters:{},type_counts:[],attempt_counts:[],flow_counts:[]},last_sync_at:new Date(GROWTH_FIXTURE_NOW).toISOString()});
  if(path.endsWith('/orders'))return send(res,{total:0,items:[],last_sync_at:new Date(GROWTH_FIXTURE_NOW).toISOString()});
  if(path.includes('/automation/overview'))return send(res,{summary:{active:0,live:0,canary:0,shadow:0,breakers:0,human_today:null},available_workflows:[],workflows:[],metrics:[],actions:[],alerts:[],definitions:{period:'DEMO',coverage:'Sin operaciones reales'},checked_at:new Date(GROWTH_FIXTURE_NOW).toISOString()});
  if(path.endsWith('/analytics'))return send(res,buildAnalyticsReport({cells:[],now:new Date(GROWTH_FIXTURE_NOW)}));
  if(path.endsWith('/finance'))return send(res,{...buildResultsFinanceReport({month:q.month||'2026-09',orders:[],rates:[],fixedExpenses:[],adSpend:[],now:new Date(GROWTH_FIXTURE_NOW)}),available_months:['2026-09']});
  if(path.endsWith('/product-costs'))return send(res,{rates:[],findings:[],revision:'0'});
  return send(res,{error:'DEMO_ENDPOINT_NOT_CONFIGURED'},404);
 }
 if(path.startsWith('/__fixture-creative/')){res.setHeader('Content-Type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240"><defs><linearGradient id="b"><stop stop-color="#e3f8f4"/><stop offset="1" stop-color="#e5edff"/></linearGradient></defs><rect width="400" height="240" fill="url(#b)"/><rect x="165" y="45" width="70" height="25" rx="5" fill="#d7c4aa"/><rect x="150" y="65" width="100" height="135" rx="20" fill="#fffaf4" stroke="#d9d7d2"/><text x="200" y="117" text-anchor="middle" fill="#1a6c64" font-family="sans-serif" font-size="16">AQUA</text><text x="200" y="140" text-anchor="middle" fill="#687a8e" font-family="sans-serif" font-size="10">CREATIVIDAD DEMO</text></svg>');return;}
 if(path==='/__qa'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({calls,entries,externalConnections:0,metaWrites:0}));return;}
 const file=resolve(root,path==='/'?'index.html':decodeURIComponent(path).replace(/^\//,''));if(file!==root&&!file.startsWith(root+sep))return send(res,{},403);
 const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml'};res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');res.setHeader('Cache-Control','no-store');
 let content=await readFile(file);if(file.endsWith('ads-review-v6.js'))content=content.toString().replace('}catch(error){if(current!==generation',"}catch(error){console.error('LOCAL_RENDER_ERROR',error.stack);if(current!==generation");
 if(extname(file)==='.html')content=content.toString().replace('<body>','<body>'+banner).replace(/content="https:\/\/mcp\.suleia\.com\/operations"/g,'content=""');res.end(content);
 }catch(error){if(error.status===202){res.writeHead(202,{'Content-Type':'application/json','Retry-After':'1'});res.end(JSON.stringify({ok:false,diagnostic:error.diagnostic}));}else{console.error(error.message);send(res,{error:'LOCAL_FIXTURE_ERROR'},500);}}});
server.listen(port,'127.0.0.1',()=>console.log('Synthetic-only V10 preview http://127.0.0.1:'+port+'/#ads'));
