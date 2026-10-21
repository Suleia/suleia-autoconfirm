import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createOperationsServer,loadOperationsConfig} from './server.mjs';
import {signAdsBridge} from '../../services/meta-ads/bridge-auth.mjs';

async function fixture(fn,enabled=true){
 const history=[],secret='fixture-existing-bot-secret',summary={incidents:{pending:3,responded:1},orders:{pending:2},connectors:[]};
 const runtime={engine:{mode:'SHADOW',policy:{maxBudgetCents:10000,maxChangePercent:10},authorize(a){if(!['1','2'].includes(a.user)||a.chat!==a.user)throw Error('ACTOR_UNAUTHORIZED');}},ledger:{history:async()=>[]},overview:async()=>({observedAt:'2026-10-21T10:00:00Z',totals:{spend:10,purchases:null,roas:null},actions:[]})};
 const ledger={context:async()=>null,saveContext:async()=>{},remember:async r=>history.push(r),latest:async()=>null,history:async actor=>history.filter(h=>h.actor===actor)};
 const server=createOperationsServer({config:loadOperationsConfig({databaseUrl:'postgres://unused',privateDataKey:'test-only-private-key-longer-than-thirty-two-characters'}),authenticate:async req=>{if(req.headers.authorization!=='Bearer fixture-read')throw Error('UNAUTHORIZED');return {principal_hash:'fixture-reader'};},repository:{summary:async()=>summary},adsRuntime:runtime,commandLedger:enabled?ledger:null,adsBridgeSecret:secret});
 server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 const command=async(body,valid=true)=>{const raw=JSON.stringify(body),at=String(Date.now());return fetch(base+'/api/internal/ads-intelligence/command',{method:'POST',headers:{'X-Suleia-Ads-Timestamp':at,'X-Suleia-Ads-Signature':valid?signAdsBridge(secret,at,raw):'invalid'},body:raw});};
 try{await fn({base,command,history});}finally{await new Promise(r=>server.close(r));}
}
test('Command Center panel uses existing OAuth, read-only route and disabled-by-default gate',async()=>{
 await fixture(async({base})=>{
  assert.equal((await fetch(base+'/api/operations/command-center')).status,401);
  const r=await fetch(base+'/api/operations/command-center',{headers:{Authorization:'Bearer fixture-read'}});assert.equal(r.status,200);const d=(await r.json()).data;assert.equal(d.metaWritesEnabled,false);assert.equal(d.notificationsEnabled,false);assert.equal(d.trendtrack.connected,false);
  assert.equal((await fetch(base+'/api/operations/command-center',{method:'POST',headers:{Authorization:'Bearer fixture-read'}})).status,405);
  assert.equal((await (await fetch(base+'/api/config')).json()).command_center_enabled,true);
 });
 await fixture(async({base})=>assert.equal((await fetch(base+'/api/operations/command-center',{headers:{Authorization:'Bearer fixture-read'}})).status,503),false);
});
test('business tools use the same body-bound bot signature and numeric private actor gate',async()=>fixture(async({command,history})=>{
 const body={action:'request',text:'Consulta incidencias',actor:{user:'2',chat:'2'},requestKey:'telegram:1'};
 assert.equal((await command(body,false)).status,401);
 assert.equal((await command({...body,actor:{user:'3',chat:'3'}})).status,403);
 const r=await command(body);assert.equal(r.status,200);const data=await r.json();assert.match(data.data.text,/Pendientes: 3/);assert.equal(data.meta_budget_writes,0);assert.equal(history[0].actor,'2');
}));
test('malformed business requests fail closed and do not record decisions',async()=>fixture(async({command,history})=>{
 assert.equal((await command({action:'request',actor:{user:'1',chat:'1'},text:'x'.repeat(1001),requestKey:'x'})).status,503);assert.equal(history.length,0);
}));
