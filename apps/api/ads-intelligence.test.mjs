import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createOperationsServer,loadOperationsConfig} from './server.mjs';
const token='test-only-bridge-credential-0000000000000000000';
async function fixture(fn,runtime={engine:{authorize(actor){if(actor.user!=='1'||actor.chat!=='1')throw Error('ACTOR_UNAUTHORIZED');},mode:'SIMULATION',policy:{maxBudgetCents:10000,maxChangePercent:10}},ledger:{history:async()=>[]},overview:async()=>({liveEnabled:false})}){
  const server=createOperationsServer({config:loadOperationsConfig({privateDataKey:'fixture-private-key-longer-than-thirty-two-characters',databaseUrl:'postgres://unused',oauthIssuer:'https://issuer.test',oauthAudience:'test',oauthClientId:'test',oauthJwksUrl:'https://issuer.test/keys'}),repository:{},authenticate:async req=>{if(req.headers.authorization!=='Bearer read-test')throw Error('UNAUTHORIZED');return {principal_hash:'test'};},adsRuntime:runtime,adsBridgeToken:token});
  server.listen(0,'127.0.0.1');await once(server,'listening');try{await fn('http://127.0.0.1:'+server.address().port);}finally{await new Promise(r=>server.close(r));}
}
test('Ads bridge rejects missing/incorrect credentials and unapproved actors',async()=>fixture(async base=>{
  const path=base+'/api/internal/ads-intelligence/command';
  for(const auth of ['', 'Bearer read-test','Bearer wrong']){const r=await fetch(path,{method:'POST',headers:{Authorization:auth},body:'{}'});assert.equal(r.status,401);}
  const r=await fetch(path,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({action:'status',actor:{user:'2',chat:'2'}})});assert.equal(r.status,403);
}));
test('Ads bridge accepts only POST; status remains simulation and exposes no secrets',async()=>fixture(async base=>{
  const path=base+'/api/internal/ads-intelligence/command';assert.equal((await fetch(path)).status,405);
  const r=await fetch(path,{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify({action:'status',actor:{user:'1',chat:'1'}})});const b=await r.json();assert.equal(r.status,200);assert.match(b.data.text,/SIMULATION/);assert.equal(b.meta_budget_writes,0);assert.ok(!JSON.stringify(b).includes(token));
}));
test('Ads overview uses existing panel auth and is GET only',async()=>fixture(async base=>{
  const path=base+'/api/operations/ads-intelligence';assert.equal((await fetch(path)).status,401);const r=await fetch(path,{headers:{Authorization:'Bearer read-test'}});assert.equal(r.status,200);assert.equal((await r.json()).data.liveEnabled,false);assert.equal((await fetch(path,{method:'POST',headers:{Authorization:'Bearer read-test'}})).status,405);
}));
