import test from 'node:test';import assert from 'node:assert/strict';import crypto from 'node:crypto';
import {runAddressCapability,refreshAddressCapabilities} from './address-capabilities.mjs';
import {addressResponseDecision,ADDRESS_POLICY,addressRuntimeStatus} from './address-response-policy.mjs';
import {addressPromotionAllowed,addressEffectiveMode} from './address-capability-policy.mjs';
const now=Date.now(),at=x=>new Date(x).toISOString();
const incident={incidenceId:'11',orderId:'22',incidentType:'address',phone:'600000000',chatbyUserNs:'fixture',chatbyReadVerified:true,chatbyOrderAssociation:'EXACT_ORDER',incidenceDate:at(now-4*3600000)};
const issue={id:11,order_id:22,market:'ES',carrier:'GLS',type:'ADDRESS_INCORRECT',initial_carrier_code:'-30',initial_carrier_substatus_code:'13',initial_carrier_description:'DIRECCION INCORRECTA',status:'PENDING',is_active:true,created_at:incident.incidenceDate,updated_at:at(now-3*3600000),allowed_resolution_options:['CHANGE_ADDRESS']};
const order={orderId:'22',status:'ERROR',customerPhone:'600000000',raw:{shipping_address:{city:'Bilbao',postal_code:'48012',state:'Bizkaia',country:'ES'}}};
const notice={type:'out',mid:'wamid.initial',ts:(now-2*3600000)/1000,payload:{name:'dropea_incidencia_direccion_v1'}};
const reply={type:'in',mid:'wamid.reply',ts:(now-3600000)/1000,text:'Calle Mayor 25, 48012 Bilbao'};
const messages=[notice,reply],item={incident,issue,order,messages};
const expected=addressResponseDecision({...item,now});
const env={ADDRESS_AUTOMATION_ENABLED:'true',ADDRESS_CHANGE_MODE:'CANARY',ADDRESS_INTERPRETATION_MODE:'CANARY',ADDRESS_DETAILS_MODE:'CANARY',ADDRESS_DISCOUNT_OFFER_MODE:'CANARY',ADDRESS_SOLUTION_MODE:'CANARY',ADDRESS_RETURN_MODE:'SHADOW',ADDRESS_RETURN_BREAKER:'OPEN',ADDRESS_ACTIVATION_AT:at(now-24*3600000),RENDER_GIT_COMMIT:'a'.repeat(40),ADDRESS_REGRESSION_GATE_REVISION:'a'.repeat(40),ADDRESS_POLICY_REGISTRY_HASH:crypto.createHash('sha256').update(JSON.stringify(ADDRESS_POLICY)).digest('hex')};
function memory(){const rows=new Map();let n=0;return {rows,async get(k){return structuredClone(rows.get(k)||null);},async initialize(k,value){if(!rows.has(k))rows.set(k,{value:structuredClone(value),updated_at:String(++n)});return this.get(k);},async cas(k,row,value){if(rows.get(k)?.value.revision!==row.value.revision)return null;rows.set(k,{value:structuredClone(value),updated_at:String(++n)});return this.get(k);}};}
async function setup(){const store=memory();await refreshAddressCapabilities({store,env});const audit=[],claims=new Map();return {store,audit,claims,deps:{env,store,now:()=>now,readCurrent:async()=>({issue,order}),readMessages:async()=>messages,claim:async args=>{if(claims.has(args.templateName))return {acquired:false,persistent:true,existing:claims.get(args.templateName)};claims.set(args.templateName,{status:'claimed'});return {acquired:true,persistent:true,templateKey:args.templateName};},finish:async data=>{audit.push(data);claims.set(data.templateName,{status:data.status,raw:data.raw});},execute:async({onWrite})=>{onWrite();return {status:'ADDRESS_SOLUTION_VERIFIED',verified:true,provider_receipt:true};}}};}
test('one real canary reserves atomically and promotes only after verified provider result',async()=>{
 const {store,audit,deps}=await setup();const results=await Promise.all([runAddressCapability(item,expected,deps),runAddressCapability(item,expected,deps)]);
 assert.equal(results.filter(x=>x.promoted).length,1);assert.equal(audit.filter(x=>x.status==='verified').length,1);
 assert.equal((await store.get('CHANGE_ADDRESS')).value.mode,'LIVE');assert.equal(audit.at(-1).raw.intended_writes,1);assert.equal(audit[0].raw.snapshot_status,'PERSISTED');
 const again=await runAddressCapability(item,expected,deps);assert.equal(again.status,'ALREADY_VERIFIED');assert.equal((await store.get('CHANGE_ADDRESS')).value.breaker,'CLOSED');
});
test('unknown provider result opens only the affected capability and never promotes',async()=>{
 const {store,deps}=await setup();const r=await runAddressCapability(item,expected,{...deps,execute:async({onWrite})=>{onWrite();throw Error('timeout');}});
 assert.equal(r.verified,false);assert.equal((await store.get('CHANGE_ADDRESS')).value.breaker,'OPEN');assert.equal((await store.get('SOLUTION')).value.breaker,'CLOSED');assert.equal((await store.get('CHANGE_ADDRESS')).value.mode,'CANARY');
 assert.equal((await runAddressCapability(item,expected,deps)).status,'CAPABILITY_BLOCKED');
});
test('no promotion by synthetic PASS, duplicate send or mismatched identity',()=>{
 for(const x of [{writes:0,regressionPassed:true,breaker:'CLOSED'},{writes:2,regressionPassed:true,breaker:'CLOSED'},{writes:1,regressionPassed:false,breaker:'CLOSED'},{writes:1,regressionPassed:true,breaker:'OPEN'}])assert.equal(addressPromotionAllowed('OFFER',{verified:true,post_write_verified:true,identity_verified:true},x),false);
 assert.equal(addressPromotionAllowed('OFFER',{verified:true,post_write_verified:true,identity_verified:false},{writes:1,regressionPassed:true,breaker:'CLOSED'}),false);
});
test('hard exclusion, historical actions, unknown mapping and stale release fail closed',async()=>{
 const {deps}=await setup();let called=0;const d={...deps,execute:async()=>{called++;}};
 assert.equal((await runAddressCapability({...item,incident:{...incident,incidenceId:'1309433'}},expected,d)).status,'PROVIDER_RECONCILIATION_REQUIRED');
 assert.equal((await runAddressCapability(item,expected,{...d,readCurrent:async()=>({issue:{...issue,created_at:at(now-48*3600000)},order})})).status,'HISTORICAL_ACTION_EXCLUDED');
 assert.equal((await runAddressCapability(item,expected,{...d,readCurrent:async()=>({issue:{...issue,initial_carrier_substatus_code:'other'},order})})).status,'BLOCKED_CURRENT_IDENTITY_OR_MAPPING');
 assert.equal((await runAddressCapability(item,expected,{...d,env:{...env,RENDER_GIT_COMMIT:'b'.repeat(40)}})).status,'CAPABILITY_RELEASE_GATE');assert.equal(called,0);
});
test('late reply and cross-order provider identity block before claim',async()=>{
 const {deps,audit}=await setup();
 assert.equal((await runAddressCapability(item,expected,{...deps,readMessages:async()=>[...messages,{...reply,mid:'late',ts:now/1000,text:'No quiero el pedido'}]})).status,'DECISION_SUPERSEDED');
 assert.equal((await runAddressCapability(item,expected,{...deps,readCurrent:async()=>({issue,order:{...order,orderId:'another'}})})).status,'BLOCKED_CURRENT_IDENTITY_OR_MAPPING');assert.equal(audit.length,0);
});
test('interpretation canary uses a real exact conversation, zero external writes',async()=>{
 const {deps,store}=await setup();const r=await runAddressCapability(item,expected,{...deps,stage:'INTERPRETATION'});assert.equal(r.promoted,true);assert.equal(r.intended_writes,0);assert.equal((await store.get('INTERPRETATION')).value.mode,'LIVE');
});
test('return, pickup and retry stay shadow independently of recovery promotion',async()=>{
 const {deps}=await setup();for(const stage of ['PICKUP','RETRY'])assert.equal((await runAddressCapability(item,expected,{...deps,stage})).status,'CAPABILITY_SHADOW');
 assert.equal((await runAddressCapability(item,expected,{...deps,stage:'RETURN'})).status,'CAPABILITY_BLOCKED');
 assert.equal(addressEffectiveMode('CHANGE_ADDRESS',{mode:'LIVE',promotion:{verified:true}},env),'LIVE');
 assert.equal(addressEffectiveMode('CHANGE_ADDRESS',{mode:'LIVE',promotion:{verified:true}},{...env,ADDRESS_CHANGE_MODE:'SHADOW'}),'SHADOW');
});

test('return cannot open its own persisted breaker even when its configured mode is changed',async()=>{
 const {deps,store}=await setup();
 const r=await runAddressCapability(item,expected,{...deps,stage:'RETURN',env:{...env,ADDRESS_RETURN_MODE:'CANARY',ADDRESS_RETURN_BREAKER:'CLOSED'}});
 assert.equal(r.status,'CAPABILITY_BLOCKED');assert.equal((await store.get('RETURN')).value.breaker,'OPEN');
});

test('discount canary requires one accepted send and persists a promotion; no receipt opens only OFFER',async()=>{
 for(const verified of [true,false]){
  const {deps,store}=await setup();
  const offerNotice={...notice,ts:(now-25*3600000)/1000};
  const offerIncident={...incident,incidenceDate:at(now-26*3600000)};
  const offerIssue={...issue,created_at:offerIncident.incidenceDate};
  const offerItem={...item,incident:offerIncident,issue:offerIssue,messages:[offerNotice]};
  const d=addressResponseDecision({...offerItem,now});assert.equal(d.action,'OFFER_5_EURO_DISCOUNT');
  const offerRow=await store.get('OFFER');await store.cas('OFFER',offerRow,{...offerRow.value,activated_at:at(now-48*3600000)});
  const r=await runAddressCapability(offerItem,d,{...deps,readCurrent:async()=>({issue:offerIssue,order}),readMessages:async()=>[offerNotice],execute:async({onWrite})=>{onWrite();return {status:verified?'sent':'delivery_unverified',verified};}});
  assert.equal(r.promoted,verified);assert.equal(r.intended_writes,1);assert.equal((await store.get('OFFER')).value.breaker,verified?'CLOSED':'OPEN');
  assert.equal((await store.get('CHANGE_ADDRESS')).value.breaker,'CLOSED');
 }
});
test('health panel distinguishes armed canary from verified live capability',()=>{
 const h=addressRuntimeStatus({lastAddressWorkflowAt:at(now),addressWorkflowSummary:{observed:1},addressCapabilities:{CHANGE_ADDRESS:{effective_mode:'LIVE',effective_breaker:'CLOSED',promotion:{verified:true}},DETAILS:{effective_mode:'CANARY',phase:'WAITING_ELIGIBLE_CASE'}}},env);
 assert.equal(h.stages.change_address,'LIVE');assert.equal(h.stages.details,'CANARY');assert.equal(h.stages.return,'SHADOW');assert.equal(h.breakers.return,'OPEN');
});


test('per-stage release gate repairs one tested stage without opening unrelated actions',async()=>{
 const {deps}=await setup();const stageEnv={...env,ADDRESS_REGRESSION_GATE_REVISION:'b'.repeat(40),ADDRESS_INTERPRETATION_REGRESSION_GATE_REVISION:env.RENDER_GIT_COMMIT};
 assert.equal((await runAddressCapability(item,expected,{...deps,env:stageEnv,stage:'INTERPRETATION'})).verified,true);
 assert.equal((await runAddressCapability(item,expected,{...deps,env:stageEnv})).status,'CAPABILITY_RELEASE_GATE');
});

test('a proven already-solved conflict releases capability for unrelated cases without promotion',async()=>{
 const {store,deps,audit}=await setup();const r=await runAddressCapability(item,expected,{...deps,execute:async({onWrite})=>{onWrite();return {status:'PROVIDER_ALREADY_SOLVED',verified:false,operation_status:'failed',provider_error_code:'GLS_INCIDENCE_ALREADY_SOLVED'};}});
 assert.equal(r.promoted,false);assert.equal((await store.get('CHANGE_ADDRESS')).value.breaker,'CLOSED');assert.equal((await store.get('CHANGE_ADDRESS')).value.phase,'WAITING_ELIGIBLE_CASE');assert.equal(audit.at(-1).status,'provider_already_solved');
});
