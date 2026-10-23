import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createOperationsServer,loadOperationsConfig} from './server.mjs';
import {signAdsBridge} from '../../services/meta-ads/bridge-auth.mjs';
import {ReportReadError} from '../../services/meta-ads/report-cache.mjs';
const token='test-only-bridge-credential-0000000000000000000';
test('cold read returns authenticated 202 with retry guidance; Meta credential failure is 503, not a user sign-out',async()=>{
 const diagnostic={source:'META_MARKETING_API',id:'fixture-error-id',state:'PREPARING',code:'ADS_REPORT_PREPARING',retryable:true,retryAfterSeconds:2};
 const runtime={engine:{mode:'SHADOW'},overview:async()=>{throw new ReportReadError(diagnostic);}};
 await fixture(async base=>{const path=base+'/api/operations/ads-intelligence';assert.equal((await fetch(path)).status,401);let r=await fetch(path,{headers:{Authorization:'Bearer read-test'}});assert.equal(r.status,202);assert.equal(r.headers.get('Retry-After'),'2');assert.equal((await r.json()).diagnostic.id,'fixture-error-id');diagnostic.state='FAILED';diagnostic.code='META_HTTP_401';diagnostic.retryable=false;r=await fetch(path,{headers:{Authorization:'Bearer read-test'}});assert.equal(r.status,503);assert.equal((await r.json()).diagnostic.code,'META_HTTP_401');},runtime);
});
async function fixture(fn,runtime={engine:{authorize(actor){if(actor.user!=='1'||actor.chat!=='1')throw Error('ACTOR_UNAUTHORIZED');},mode:'SIMULATION',policy:{maxBudgetCents:10000,maxChangePercent:10}},ledger:{history:async()=>[]},overview:async()=>({liveEnabled:false})},options={}){
  const server=createOperationsServer({config:loadOperationsConfig({privateDataKey:'fixture-private-key-longer-than-thirty-two-characters',databaseUrl:'postgres://unused',oauthIssuer:'https://issuer.test',oauthAudience:'test',oauthClientId:'test',oauthJwksUrl:'https://issuer.test/keys'}),repository:{},authenticate:async req=>{if(req.headers.authorization!=='Bearer read-test')throw Error('UNAUTHORIZED');return {principal_hash:'test'};},adsRuntime:runtime,adsBridgeToken:token,adsBridgeSecret:'existing-test-only-bot-secret',...options});
  server.listen(0,'127.0.0.1');await once(server,'listening');try{await fn('http://127.0.0.1:'+server.address().port);}finally{await new Promise(r=>server.close(r));}
}
test('Ads bridge rejects missing/incorrect credentials and unapproved actors',async()=>fixture(async base=>{
  const path=base+'/api/internal/ads-intelligence/command';
  for(const auth of ['', 'Bearer read-test','Bearer wrong']){const r=await fetch(path,{method:'POST',headers:{Authorization:auth},body:'{}'});assert.equal(r.status,401);}
  const r=await fetch(path,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({action:'status',actor:{user:'2',chat:'2'}})});assert.equal(r.status,403);
}));

test('existing bot secret authenticates a body-bound timely signature; OAuth cannot spoof actors',async()=>fixture(async base=>{
 const path=base+'/api/internal/ads-intelligence/command',body=JSON.stringify({action:'status',actor:{user:'1',chat:'1'}}),at=String(Date.now()),signature=signAdsBridge('existing-test-only-bot-secret',at,body);
 const headers={'X-Suleia-Ads-Timestamp':at,'X-Suleia-Ads-Signature':signature};assert.equal((await fetch(path,{method:'POST',headers,body})).status,200);assert.equal((await fetch(path,{method:'POST',headers,body:body+' '})).status,401);
 assert.equal((await fetch(path,{method:'POST',headers:{Authorization:'Bearer read-test'},body})).status,401);
}));

test('panel proposals save/review internal recommendations only under existing auth',async()=>{
 const calls=[],runtime={engine:{mode:'SHADOW'},saveRecommendation:async p=>{calls.push(p);return {state:p.state||'DRAFT',execution:'REVIEW_ONLY'};}};
 await fixture(async base=>{const path=base+'/api/operations/ads-intelligence/proposals';assert.equal((await fetch(path,{method:'POST',body:'{}'})).status,401);for(const method of['POST','PATCH']){const r=await fetch(path,{method,headers:{Authorization:'Bearer read-test'},body:JSON.stringify({actionId:'test',id:'test',state:'APPROVED_FOR_REVIEW'})});assert.equal(r.status,200);assert.equal((await r.json()).meta_budget_writes,0);}assert.equal(calls[0].principal,'test');assert.equal(calls[0].state,null);assert.equal(calls[1].state,'APPROVED_FOR_REVIEW');},runtime);
});

test('V6 review endpoints retain OAuth and explicit zero budget writes even alongside LIVE',async()=>{
 const calls=[],runtime={engine:{mode:'LIVE',authorize(a){if(a.user!=='1'||a.chat!=='1')throw Error('ACTOR_UNAUTHORIZED');}},review:{report:async q=>{calls.push(q);return {version:'v6',externalWrites:0};},answer:async text=>text==='Ambigua'?{text:'Indica un ID exacto'}:({text:'same shared analysis',review:{version:'v6'},externalWrites:0}),history:async()=>({entries:[],nextCursor:null}),alerts:async()=>({notificationsEnabled:false}),audit:async()=>({profile:{scheduled:false}}),record:async b=>{calls.push(b);return {execution:'REVIEW_ONLY'};}}};
 await fixture(async base=>{
  for(const suffix of ['', '/query?question=Auditoria+de+campanas','/records','/alerts','/audit?profile=daily']){
   const url=base+'/api/operations/ads-intelligence/review'+suffix;
   assert.equal((await fetch(url)).status,401);const r=await fetch(url,{headers:{Authorization:'Bearer read-test'}});assert.equal(r.status,200);assert.equal((await r.json()).meta_budget_writes,0);
  }
  const url=base+'/api/operations/ads-intelligence/review/records';assert.equal((await fetch(url,{method:'POST',body:'{}'})).status,401);
  const r=await fetch(url,{method:'POST',headers:{Authorization:'Bearer read-test'},body:JSON.stringify({kind:'REVIEW',principal:'spoofed'})});assert.equal(r.status,200);assert.equal((await r.json()).meta_budget_writes,0);assert.equal(calls.at(-1).principal,'test');const bridge=await fetch(base+'/api/internal/ads-intelligence/command',{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify({action:'review',text:'Ambigua',actor:{user:'1',chat:'1'}})});assert.equal(bridge.status,200);assert.equal((await bridge.json()).meta_budget_writes,0);
  assert.equal((await fetch(url,{method:'DELETE',headers:{Authorization:'Bearer read-test'}})).status,405);
  assert.equal((await fetch(base+'/api/operations/ads-intelligence/review/unknown',{headers:{Authorization:'Bearer read-test'}})).status,404);
 },runtime);
});

test('V6 disabled deployment does not expose records or change existing Ads endpoints',async()=>fixture(async base=>{
 const r=await fetch(base+'/api/operations/ads-intelligence/review',{headers:{Authorization:'Bearer read-test'}});assert.equal(r.status,503);assert.equal((await r.json()).error,'ads_review_disabled');
 assert.equal((await fetch(base+'/api/operations/ads-intelligence',{headers:{Authorization:'Bearer read-test'}})).status,200);
}));
test('Ads bridge accepts only POST; status remains simulation and exposes no secrets',async()=>fixture(async base=>{
  const path=base+'/api/internal/ads-intelligence/command';assert.equal((await fetch(path)).status,405);
  const r=await fetch(path,{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify({action:'status',actor:{user:'1',chat:'1'}})});const b=await r.json();assert.equal(r.status,200);assert.match(b.data.text,/SIMULATION/);assert.equal(b.meta_budget_writes,0);assert.ok(!JSON.stringify(b).includes(token));
}));
test('Ads overview uses existing panel auth and is GET only',async()=>fixture(async base=>{
  const path=base+'/api/operations/ads-intelligence';assert.equal((await fetch(path)).status,401);const r=await fetch(path,{headers:{Authorization:'Bearer read-test'}});assert.equal(r.status,200);assert.equal((await r.json()).data.liveEnabled,false);assert.equal((await fetch(path,{method:'POST',headers:{Authorization:'Bearer read-test'}})).status,405);
}));
test('Budget Autopilot overview retains OAuth GET-only boundary and zero writes',async()=>{
 const runtime={engine:{mode:'SHADOW'},autopilot:{overview:async()=>({mode:'SHADOW',liveEnabled:false,externalWrites:0,policy:{maxBudgetCents:7000}}),audit:async()=>({entries:[],nextCursor:null})}};
 await fixture(async base=>{const path=base+'/api/operations/ads-intelligence/autopilot';assert.equal((await fetch(path)).status,401);assert.equal((await fetch(path,{method:'POST',headers:{Authorization:'Bearer read-test'},body:'{}'})).status,405);const r=await fetch(path,{headers:{Authorization:'Bearer read-test'}});assert.equal(r.status,200);const body=await r.json();assert.equal(body.data.policy.maxBudgetCents,7000);assert.equal(body.meta_budget_writes,0);},runtime);
 await fixture(async base=>{const path=base+'/api/operations/ads-intelligence/autopilot/history';assert.equal((await fetch(path)).status,401);const r=await fetch(path,{headers:{Authorization:'Bearer read-test'}});assert.equal(r.status,200);assert.deepEqual((await r.json()).data.entries,[]);assert.equal((await fetch(path,{method:'POST'})).status,405);},runtime);
});
test('V4 analysis, mechanical simulation and journal retain auth and zero Meta writes',async()=>{
 const calls=[],runtime={engine:{mode:'SHADOW'},algorithm:async()=>({version:'ADS_ALGORITHM_V4',liveEnabled:false}),journalHistory:async()=>[],simulate:async q=>{calls.push(q);return {externalWrites:0,mode:'SHADOW'};},journal:async q=>{calls.push(q);return {execution:'REVIEW_ONLY'};}};
 await fixture(async base=>{
  const path=base+'/api/operations/ads-intelligence/algorithm';
  for(const suffix of ['', '/simulate?campaignId=1&newBudgetCents=6000&days=7']){
   assert.equal((await fetch(path+suffix)).status,401);
   const r=await fetch(path+suffix,{headers:{Authorization:'Bearer read-test'}});assert.equal(r.status,200);assert.equal((await r.json()).meta_budget_writes,0);
   assert.equal((await fetch(path+suffix,{method:'POST',headers:{Authorization:'Bearer read-test'}})).status,405);
  }
  assert.equal((await fetch(path+'/journal',{method:'POST',body:'{}'})).status,401);
  assert.equal((await fetch(path+'/journal')).status,401);
  assert.equal((await fetch(path+'/journal',{headers:{Authorization:'Bearer read-test'}})).status,200);
  const r=await fetch(path+'/journal',{method:'POST',headers:{Authorization:'Bearer read-test'},body:JSON.stringify({eventType:'DIAGNOSIS',reference:'ACCOUNT',principal:'spoofed'})});assert.equal(r.status,200);assert.equal(calls[1].principal,'test');assert.equal((await r.json()).internal_configuration_writes,1);
 },runtime);
});

test('V8 history/details require OAuth, manual audit cannot masquerade as a daily send',async()=>{
 const calls=[],id='a'.repeat(64),runtime={engine:{mode:'LIVE'},executive:{history:async()=>({entries:[],nextCursor:null}),detail:async id=>({id,body:{metaWrites:0}}),prepare:async b=>{calls.push(b);return {id,state:'PREPARING'};}}};
 await fixture(async base=>{
  for(const suffix of ['/history','/'+id]){const path=base+'/api/operations/ads-intelligence/executive'+suffix;assert.equal((await fetch(path)).status,401);const r=await fetch(path,{headers:{Authorization:'Bearer read-test'}});assert.equal(r.status,200);assert.equal((await r.json()).meta_budget_writes,0);}
  const path=base+'/api/operations/ads-intelligence/executive/generate';assert.equal((await fetch(path,{method:'POST',body:'{}'})).status,401);
  const r=await fetch(path,{method:'POST',headers:{Authorization:'Bearer read-test'},body:JSON.stringify({kind:'DAILY',principal:'forged',query:{period:'7d'}})});assert.equal(r.status,200);assert.equal(calls[0].kind,'MANUAL');assert.equal(calls[0].principal,'test');assert.equal((await r.json()).meta_budget_writes,0);
  assert.equal((await fetch(base+'/api/operations/ads-intelligence/executive/unknown',{headers:{Authorization:'Bearer read-test'}})).status,404);
 },runtime);
});
test('V8 signed bridge cannot bypass the existing role service or private numeric authorization',async()=>{
 const runtime={engine:{mode:'LIVE',authorize(){throw Error('ACTOR_UNAUTHORIZED');}},executive:{command(){throw Error('MUST_NOT_RUN');}}};
 await fixture(async base=>{const r=await fetch(base+'/api/internal/ads-intelligence/command',{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify({action:'executive-report',operation:'due',actor:{user:'2',chat:'2'}})});assert.equal(r.status,403);},runtime);
});

test('V8 delivery uses existing verified Ads+finance roles; an operator cannot receive financial reports',async()=>{
 const calls=[],runtime={engine:{mode:'LIVE',authorize(a){if(!['1','2'].includes(a.user)||a.chat!==a.user)throw Error('ACTOR_UNAUTHORIZED');}},executive:{command:async b=>{calls.push(b);return {executive:{state:'NOT_DUE'}};}}};
 await fixture(async base=>{
  const path=base+'/api/internal/ads-intelligence/command',request=user=>fetch(path,{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify({action:'executive-report',operation:'due',actor:{user,chat:user}})});
  const good=await request('1');assert.equal(good.status,200);assert.equal((await good.json()).meta_budget_writes,0);assert.equal((await request('2')).status,403);assert.equal(calls.length,1);
 },runtime,{commandLedger:{},commandRoles:{'1':'admin','2':'operator'}});
});
