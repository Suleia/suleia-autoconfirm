import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdsGateway,formatAdsResult} from './ads-gateway.mjs';
import {verifyAdsBridge} from '../../services/meta-ads/bridge-auth.mjs';

test('ordinary campaign questions stay compact despite canonical diagnosis focus; detail remains explicit',async()=>{
 const data={focus:'diagnosis',analysis:{version:3,range:{since:'2026-10-22',until:'2026-10-22'},level:'campaign',facts:Array.from({length:5},(_,i)=>({entityId:String(i),name:'Campaign '+i,delivery:'ACTIVE',roas:5-i,roasStatus:'VALID',spend:30,purchases:6,impressions:2000,linkCtr:2,cpa:5,diagnoses:[{recommendedAction:'Review the offer'}]})),totals:{spend:150,purchases:30,roas:3},observedAt:'2026-10-21T22:28:00Z',actions:[]}};
 const gateway=createAdsGateway({adsApiUrl:'https://operations.test',botToken:'fixture'},async()=>({ok:true,json:async()=>({ok:true,data})}));
 const actor={user:'1',chat:'1'};
 const summary=await gateway.handle('¿Cómo van las campañas hoy?',actor,1);
 assert.doesNotMatch(summary.text,/CTR:|CPC:|CPA:/);assert.match(summary.text,/Campaign 3/);assert.doesNotMatch(summary.text,/Campaign 4/);
 assert.equal(summary.navigation.find(b=>b.label==='Ver más →').view,'summary');
 const diagnosis=summary.navigation.find(b=>b.label==='🔍 Ver diagnóstico');
 assert.match((await gateway.read(diagnosis.request,actor,diagnosis)).text,/CTR:/);
 assert.match((await gateway.handle('Analiza las campañas en detalle',actor,2)).text,/CTR:/);
 assert.match((await gateway.handle('Diagnóstico de las campañas',actor,3)).text,/CTR:/);
 assert.doesNotMatch((await gateway.handle('Analiza las campañas',actor,4)).text,/CTR:/);
});
test('gateway sends one idempotent request to shared service, never Meta',async()=>{
  const requests=[];const gateway=createAdsGateway({adsApiUrl:'https://operations.test/api/internal/ads-intelligence/command',adsApiToken:'test-credential'},async(url,opts)=>{requests.push({url:String(url),opts});return {ok:true,json:async()=>({ok:true,data:{proposal:{state:'CLARIFICATION',question:'Indica periodo'}}})};});
  assert.equal((await gateway.handle('Baja 5 € a las campañas con ROAS inferior a 2',{user:'1',chat:'1'},42)).text,'Indica periodo');
  assert.equal(requests[0].opts.method,'POST');assert.equal(JSON.parse(requests[0].opts.body).requestKey,'telegram:42');assert.ok(!requests[0].url.includes('facebook'));assert.equal(requests[0].opts.redirect,'error');
});
test('gateway only accepts HTTPS and never follows credential-bearing redirects',()=>{
  assert.throws(()=>createAdsGateway({adsApiUrl:'http://operations.test',adsApiToken:'x'}),/URL_INVALID/);
  assert.throws(()=>createAdsGateway({adsApiUrl:'https://user:secret@operations.test',adsApiToken:'x'}),/URL_INVALID/);
});

test('gateway can reuse the existing bot secret with body-bound signatures, without a new bridge credential',async()=>{
 const secret='existing-test-only-bot-secret';let request;
 const gateway=createAdsGateway({adsApiUrl:'https://operations.test/api/internal/ads-intelligence/command',botToken:secret},async(url,opts)=>{request=opts;return {ok:true,json:async()=>({ok:true,data:{text:'ok'}})};});
 await gateway.handle('Analízame todas las campañas de hoy',{user:'1',chat:'1'},44);
 assert.equal(verifyAdsBridge(secret,request.headers['X-Suleia-Ads-Timestamp'],request.body,request.headers['X-Suleia-Ads-Signature']),true);assert.equal(request.headers.Authorization,undefined);assert.ok(!request.body.includes(secret));
});
test('proposal has CONFIRMAR/CANCELAR buttons and clear blocked/unknown results',()=>{
  const result=formatAdsResult({proposal:{id:'0123456789abcdef',state:'PENDING',mode:'SHADOW',request:'Fixture request',expiresAt:Date.now()+300000,intent:{period:'hoy'},items:[{name:'Fixture campaign',campaignId:'1',before:5000,after:6000,reasons:['MAX_CHANGE_PERCENT'],metric:null}]}});
  assert.match(result.text,/supera el porcentaje/);assert.equal(result.markup.inline_keyboard[0][0].callback_data,'confirm:0123456789abcdef');
});

test('2.0 help and daily summary use existing shared gateway, not a second interpreter',async()=>{
 const requests=[];const gateway=createAdsGateway({commandCenterEnabled:true,adsApiUrl:'https://operations.test/api/internal/ads-intelligence/command',botToken:'fixture-bot-secret'},async(url,opts)=>{requests.push(JSON.parse(opts.body));return {ok:true,json:async()=>({ok:true,data:{text:'fixture brief'}})};});
 const help=await gateway.handle('/help',{user:'1',chat:'1'},1);assert.match(help.text,/contexto de campaña caduca/);assert.equal(requests.length,0);
 assert.equal((await gateway.handle('/resumen hoy',{user:'2',chat:'2'},2)).text,'fixture brief');assert.equal(requests[0].text,'¿Cómo va Suleia hoy?');assert.equal(requests[0].actor.user,'2');assert.equal(requests[0].requestKey,'telegram:2');
});
test('V3 gateway preserves explicit funnel and selected improvement content through read navigation',async()=>{
 const analysis={version:3,range:{since:'2026-10-21',until:'2026-10-21'},level:'campaign',facts:[{entityId:'generic',name:'GENERIC_CAMPAIGN',delivery:'ACTIVE',roas:9,roasStatus:'VALID'}],totals:{spend:60,purchases:12,roas:4},observedAt:'2026-10-21T19:00:00Z',actions:[],improveAds:[{entityId:'weak',name:'WEAK_AD',delivery:'ACTIVE',roas:.4,roasStatus:'VALID',spend:30,purchases:1,impressions:2000}],funnel:{stages:[{label:'Checkout',value:40,rate:50}],note:'Eventos agregados, no usuarios únicos.'}};
 const requests=[];const gateway=createAdsGateway({adsApiUrl:'https://operations.test/api/internal/ads-intelligence/command',botToken:'fixture'},async(url,opts)=>{
  const body=JSON.parse(opts.body);requests.push(body);return {ok:true,json:async()=>({ok:true,data:{analysis,focus:body.focus||'funnel'}})};
 });
 const funnel=await gateway.handle('Dónde se pierde la conversión',{user:'1',chat:'1'},8);
 assert.match(funnel.text,/EMBUDO DE CONVERSIÓN/);assert.match(funnel.text,/Checkout: <b>40<\/b>/);assert.match(funnel.text,/no usuarios únicos/);
 const improved=await gateway.read({action:'analyze',query:{level:'ad'},focus:'improve'},{user:'1',chat:'1'});
 assert.match(improved.text,/WEAK_AD/);assert.doesNotMatch(improved.text,/GENERIC_CAMPAIGN/);
 assert.deepEqual(requests[1].actor,{user:'1',chat:'1'});assert.equal(requests[1].focus,'improve');
});
