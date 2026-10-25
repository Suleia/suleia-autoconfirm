import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {RecoveryStore} from './store.mjs';
import {AddressRecoveryAgent} from './engine.mjs';
import {EVENT,POLICY,flags,classify,ADDRESS_CODES,digest,addressOf,candidateConfidence,claimKey} from './policy.mjs';
import {persistedLegacyFailures,markedFailureEligible} from './intake.mjs';
import {recoveryShopify,SHIPPING_MUTATION} from './shopify.mjs';

const NOW=Date.parse('2026-10-25T12:00:00Z'),at=new Date(NOW).toISOString();
const env={ADDRESS_IMPORT_RECOVERY_ENABLED:'true',ADDRESS_RECOVERY_SHOPIFY_WRITE:'true',ADDRESS_RECOVERY_CHATBY_SEND:'true',ADDRESS_RECOVERY_DROPEA_IMPORT:'true'};
const event=(patch={})=>({type:EVENT,persisted:true,evidenceId:'persisted-fixture-1',failureGeneration:'failed-1',at,shopifyOrderId:'123',externalReference:'#123',shop:'fixture.myshopify.com',storeId:10,source:'governed-import-event-v1',mappingVersion:POLICY,code:'POSTAL_CODE_INVALID',definitive:true,httpStatus:400,...patch});
const order=()=>({id:123,name:'#123',updated_at:at,currency:'EUR',total_price:'29.99',tags:'unchanged',payment_gateway_names:['COD'],line_items:[{variant_id:8,quantity:2}],shipping_address:{address1:'Calle Ejemplo 10',address2:'',zip:'40030',city:'Reus',province:'Tarragona',country_code:'ES',first_name:'Fixture',last_name:'Only',phone:'test-contact'}});
const lookup=(source,{score=.99,count=1,...patch}={})=>({candidates:Array.from({length:count},()=>({...source,postalCode:'43201'})),confidence:score,query:source,verified:true,evidenceId:'verified-fixture-address',...patch});
function fixture(t,{config=flags(env),...overrides}={}){
 const s=new RecoveryStore(':memory:',{privateKey:'fixture-key-no-production-use-1234567',now:()=>NOW});t.after(()=>s.close());
 const calls={read:0,patch:0,find:0,validate:0,send:0,post:0,reserve:0};let current=order(),existing=[],chat={verified:true,orderScoped:true,shopifyOrderId:'123',shop:'fixture.myshopify.com',externalReference:'#123',conversationId:'c1',observedAt:at,latestRelevantMessageId:'m1'};
 const ports={
  shopify:{readOrder:async()=>{calls.read++;return structuredClone(current);},updateShippingAddress:async(id,shop,a)=>{calls.patch++;current.shipping_address={...current.shipping_address,address1:a.street,address2:a.line2,zip:a.postalCode,city:a.city,province:a.province,country_code:a.country};}},
  address:{findCandidates:async a=>{calls.validate++;return lookup(a);}},
  chatby:{orderConversation:async()=>structuredClone(chat),reserveTemplate:async()=>({acquired:true,persistent:true}),sendTemplate:async()=>{calls.send++;return {verified:true,messageId:'request1'};}},
  dropea:{findExact:async()=>{calls.find++;return {complete:true,items:structuredClone(existing),storeId:10,externalReference:'#123',observedAt:at};},
   prepare:async o=>({eligible:true,sourceDigest:digest(o),expected:{externalReference:o.name,storeId:10,currency:o.currency,totalCents:2999,address:addressOf(o),units:[{variantId:8,quantity:2}]}}),
   reserveExistingImporter:async()=>{calls.reserve++;return {acquired:true,persistent:true,nativeRetryQuiescent:true};},
   importOnce:async p=>{calls.post++;existing=[{...p.expected,id:9}];}}
 };
 for(const[name,patch]of Object.entries(overrides))Object.assign(ports[name],patch);
 const a=new AddressRecoveryAgent({store:s,config,ports,now:()=>NOW});
 return {a,s,ports,calls,current,setExisting:rows=>{existing=rows;},chat,setChat:value=>{chat=value;},start:()=>a.ingest(event()).id};
}

test('healthy success/no failure is an absolute no-op, including no case/claim/provider request',async t=>{
 const f=fixture(t);for(const e of [{type:'SHOPIFY_TO_DROPEA_IMPORT_SUCCEEDED'},event({persisted:false}),event({evidenceId:null}),{},null])assert.equal(f.a.ingest(e).ignored,'NO_PERSISTED_IMPORT_FAILURE');
 assert.equal(f.s.overview().items.length,0);assert.deepEqual(f.calls,{read:0,patch:0,find:0,validate:0,send:0,post:0,reserve:0});assert.equal(f.s.db.prepare('SELECT count(*) n FROM recovery_effect').get().n,0);
});
test('master off returns before touching durable store or providers',async()=>{
 const a=new AddressRecoveryAgent({store:new Proxy({},{get(){throw Error('must not touch');}}),config:flags({})});
 assert.equal(a.ingest(event()).ignored,'DISABLED');assert.equal((await a.process('any')).ignored,'DISABLED');
});
test('SHADOW observes persisted failures only with zero external requests, claims and writes',async t=>{
 const f=fixture(t,{config:flags({ADDRESS_IMPORT_RECOVERY_ENABLED:'true'})}),id=f.start();assert.equal((await f.a.process(id)).mode,'SHADOW');assert.ok(Object.values(f.calls).every(n=>n===0));assert.equal(f.s.overview().metrics.pending,1);
});
test('eight explicit categories allowed; exclusions, HTTP failures, ungoverned codes and vague text denied',()=>{
 for(const code of ADDRESS_CODES)assert.equal(classify(event({code})).failureClass,'ADDRESS');
 for(const code of ['AUTH_ERROR','HTTP_5XX','RATE_LIMIT','TIMEOUT','DROPEA_UNAVAILABLE','PRODUCT_NOT_FOUND','PRICE_ERROR','STOCK_ERROR','INTEGRATION_ERROR','UNKNOWN_ERROR','DUPLICATE_ORDER','PAYMENT_ERROR','please fix postal code'])assert.equal(classify(event({code,originalError:'ADDRESS_INVALID'})).failureClass,'NON_ADDRESS');
 for(const patch of [{httpStatus:500},{httpStatus:429},{definitive:false},{source:'untrusted'}])assert.equal(classify(event(patch)).failureClass,'NON_ADDRESS');
 assert.equal(classify(event({source:'dropea-public-v2',failureType:'ValidationFailure',code:'POSTAL_CODE_NOT_COVERED'})).category,'NO_CARRIER_FOR_ADDRESS');
 assert.equal(classify(event({source:'dropea-public-v2',failureType:'ValidationFailure',code:'shipping_address address lines together must not exceed 100 characters'})).governedCode,'ADDRESS_LINES_TOO_LONG');
});
test('non-address failures retain existing handling without recovery provider reads',async t=>{
 const f=fixture(t),r=f.a.ingest(event({code:'AUTH_ERROR'}));assert.equal(r.state,'OUT_OF_SCOPE');await f.a.process(r.id);assert.ok(Object.values(f.calls).every(n=>n===0));assert.equal(f.s.overview().metrics.pending,0);
});
test('existing exact reference prevents all corrections, template claims and imports',async t=>{
 const f=fixture(t);f.setExisting([{id:9,storeId:10,externalReference:'#123',addressProblem:true}]);const id=f.start();await f.a.process(id);const c=f.s.get(id);assert.equal(c.state,'ALREADY_IMPORTED');assert.equal(c.private.existingAddressReview,'PRESENT');assert.equal(f.calls.read+f.calls.patch+f.calls.post+f.calls.send,0);
});
for(const [name,response]of Object.entries({multiple:{complete:true,items:[{id:9,storeId:10,externalReference:'#123'},{id:10,storeId:10,externalReference:'#123'}],storeId:10,externalReference:'#123',observedAt:at},incomplete:{complete:false,items:[]},wrongStore:{complete:true,items:[],storeId:99,externalReference:'#123',observedAt:at},wrongRef:{complete:true,items:[{id:9,storeId:10,externalReference:'#124'}],storeId:10,externalReference:'#123',observedAt:at},stale:{complete:true,items:[],storeId:10,externalReference:'#123',observedAt:'2026-10-24T00:00:00Z'}}))test('exact lookup '+name+' fails closed',async t=>{
 const f=fixture(t,{dropea:{findExact:async()=>response}});const id=f.start();await f.a.process(id);assert.equal(f.s.get(id).nextAction,'MANUAL_REVIEW');assert.equal(f.calls.patch+f.calls.post+f.calls.send,0);
});
test('confidence requires unique full-address attestation and strict boundaries',()=>{
 const a=addressOf(order());for(const[score,level]of [[.95,'HIGH'],[.949,'MEDIUM'],[.7,'MEDIUM'],[.699,'LOW']])assert.equal(candidateConfidence(lookup(a,{score}),a).level,level);
 for(const patch of [{count:2},{count:0},{verified:false},{query:{province:'Tarragona'}},{evidenceId:null}])assert.notEqual(candidateConfidence(lookup(a,patch),a).level,'HIGH');
});
test('unique verified address correction imports once and verifies exact source, amount, units, store and id',async t=>{
 const f=fixture(t),id=f.start();await f.a.process(id);const c=f.s.get(id);assert.equal(c.state,'IMPORT_VERIFIED');assert.equal(c.shopifyCorrectionStatus,'VERIFIED');assert.equal(c.dropeaOrderId,'9');assert.equal(f.calls.patch,1);assert.equal(f.calls.post,1);assert.equal(f.calls.send,0);await f.a.process(id);assert.equal(f.calls.post,1);assert.equal(f.current.tags,'unchanged');assert.equal(f.current.shipping_address.phone,'test-contact');
});
test('coverage failure never guesses a different valid postcode or contacts customer',async t=>{
 const f=fixture(t),id=f.a.ingest(event({source:'dropea-public-v2',failureType:'ValidationFailure',code:'POSTAL_CODE_NOT_COVERED'})).id;await f.a.process(id);assert.equal(f.s.get(id).lastError,'CARRIER_COVERAGE_REVIEW');assert.equal(f.calls.patch+f.calls.validate+f.calls.post+f.calls.send,0);
});
test('ambiguous candidate asks only exact order via existing template once',async t=>{
 const f=fixture(t,{address:{findCandidates:async a=>lookup(a,{count:2})}}),id=f.start();await f.a.process(id);assert.equal(f.s.get(id).state,'WAITING_CUSTOMER');assert.equal(f.s.get(id).customerConfirmationStatus,'SENT');await f.a.process(id);assert.equal(f.calls.send,1);assert.equal(f.calls.patch+f.calls.post,0);
});
test('same phone/old conversation cannot authorize a template',async t=>{
 const f=fixture(t,{address:{findCandidates:async a=>lookup(a,{score:.8})}});f.chat.shopifyOrderId='124';const id=f.start();await f.a.process(id);assert.equal(f.calls.send,0);assert.equal(f.s.get(id).lastError,'ORDER_CONVERSATION_UNVERIFIABLE');
});
test('complete fresh customer address is validated, corrects only its order and imports once',async t=>{
 const f=fixture(t);let checks=0;f.ports.address.findCandidates=async a=>lookup(a,{score:++checks===1?.8:.99});
 const id=f.start();await f.a.process(id);f.chat.latestRelevantMessageId='reply-2';f.chat.latestCustomerAddress={author:'CUSTOMER',complete:true,messageId:'reply-2',at:'2026-10-25T12:00:01Z',address:{...addressOf(f.current),postalCode:'43201'}};
 await f.a.process(id);assert.equal(f.s.get(id).state,'IMPORT_VERIFIED');assert.equal(f.s.get(id).customerConfirmationStatus,'VERIFIED');assert.equal(f.calls.patch,1);assert.equal(f.calls.post,1);
});
test('later customer cancellation/reply blocks address correction',async t=>{
 const f=fixture(t);let checks=0;f.ports.address.findCandidates=async a=>lookup(a,{score:++checks===1?.8:.99});
 const id=f.start();await f.a.process(id);f.chat.latestRelevantMessageId='later-cancellation';f.chat.latestCustomerAddress={author:'CUSTOMER',complete:true,messageId:'reply-2',at:'2026-10-25T12:00:01Z',address:addressOf(f.current)};
 await f.a.process(id);assert.equal(f.calls.patch+f.calls.post,0);assert.equal(f.s.get(id).lastError,'CUSTOMER_ADDRESS_AMBIGUOUS');
});
test('stale previously sent template never authorizes current reply or bypasses request binding',async t=>{
 const f=fixture(t,{address:{findCandidates:async a=>lookup(a,{score:.8})}}),id=f.start();await f.a.process(id);
 f.chat.latestRelevantMessageId='old';f.chat.latestCustomerAddress={author:'CUSTOMER',complete:true,messageId:'old',at:'2026-10-24T00:00:00Z',address:addressOf(f.current)};
 await f.a.process(id);assert.equal(f.calls.patch+f.calls.post,0);
});
test('template timeout never repeats delivery',async t=>{
 const f=fixture(t,{address:{findCandidates:async a=>lookup(a,{score:.8})},chatby:{sendTemplate:async()=>{f.calls.send++;throw Error('timeout');}}}),id=f.start();await f.a.process(id);await f.a.process(id);assert.equal(f.calls.send,1);assert.equal(f.s.get(id).lastError,'TEMPLATE_DELIVERY_UNCERTAIN');
});
test('fresh address/source mutation blocks correction rather than overwriting',async t=>{
 const f=fixture(t);let n=0;f.ports.shopify.readOrder=async()=>{const o=structuredClone(f.current);if(++n===2)o.shipping_address.address1='Otra calle 20';return o;};const id=f.start();await f.a.process(id);assert.equal(f.calls.patch+f.calls.post,0);assert.equal(f.s.get(id).lastError,'SOURCE_ADDRESS_CHANGED');
});
test('Shopify timeout is reconciled by GET without repeating mutation',async t=>{
 const f=fixture(t);f.ports.shopify.updateShippingAddress=async()=>{f.calls.patch++;f.current.shipping_address.zip='43201';throw Error('timeout');};const id=f.start();await f.a.process(id);assert.equal(f.s.get(id).shopifyCorrectionStatus,'UNKNOWN');await f.a.process(id);assert.equal(f.calls.patch,1);assert.equal(f.s.get(id).state,'IMPORT_VERIFIED');
});
test('timeout without observed correction stays manual and never retries',async t=>{
 const f=fixture(t,{shopify:{updateShippingAddress:async()=>{f.calls.patch++;throw Error('timeout');}}}),id=f.start();await f.a.process(id);await f.a.process(id);assert.equal(f.calls.patch,1);assert.equal(f.calls.post,0);assert.equal(f.s.get(id).lastError,'SHOPIFY_WRITE_UNCERTAIN');
});
test('existing importer same-order persistent reservation and native quiescence are mandatory',async t=>{
 const f=fixture(t,{dropea:{reserveExistingImporter:async()=>({acquired:true,persistent:true,nativeRetryQuiescent:false})}}),id=f.start();await f.a.process(id);assert.equal(f.calls.post,0);assert.equal(f.s.get(id).lastError,'EXISTING_IMPORTER_RESERVATION_REQUIRED');
});
test('Dropea timeout reconciles reference with no second POST across restarts',async t=>{
 const f=fixture(t,{dropea:{importOnce:async p=>{f.calls.post++;throw Error('timeout');}}}),id=f.start();await f.a.process(id);assert.equal(f.s.get(id).dropeaImportStatus,'UNKNOWN');await f.a.process(id);assert.equal(f.calls.post,1);const expected=f.s.get(id).private.expected;f.setExisting([{...expected,id:55}]);await f.a.process(id);assert.equal(f.s.get(id).state,'IMPORT_VERIFIED');assert.equal(f.calls.post,1);
});
for(const [name,patch]of Object.entries({total:{totalCents:3000},units:{units:[{variantId:8,quantity:1}]},store:{storeId:11},reference:{externalReference:'#124'},address:{address:{postalCode:'99999'}},id:{id:null}}))test('postcondition mismatch '+name+' is never recovered or resent',async t=>{
 const f=fixture(t,{dropea:{importOnce:async p=>{f.calls.post++;f.setExisting([{...p.expected,id:9,...patch}]);}}}),id=f.start();await f.a.process(id);await f.a.process(id);assert.notEqual(f.s.get(id).state,'IMPORT_VERIFIED');assert.equal(f.calls.post,1);
});
test('recovery uniqueness, generation change and per-order claim isolation are durable',async t=>{
 const f=fixture(t),first=f.a.ingest(event());assert.equal(f.a.ingest(event()).created,false);
 const second=f.a.ingest(event({failureGeneration:'failed-2',code:'STOCK_ERROR'}));assert.notEqual(first.id,second.id);assert.equal(f.s.get(first.id).state,'SUPERSEDED');assert.equal(f.s.get(second.id).state,'OUT_OF_SCOPE');
 const third=f.a.ingest(event({shopifyOrderId:'124',externalReference:'#124'}));assert.equal(third.state,'ADDRESS_RECOVERY_REQUIRED');assert.notEqual(claimKey('123'),claimKey('124'));
});
test('per-order concurrency lease does not block another order',async t=>{
 const f=fixture(t),owner=f.s.lease('123');assert.ok(owner);assert.equal(f.s.lease('123'),null);assert.ok(f.s.lease('124'));const id=f.start();assert.equal((await f.a.process(id)).blocked,'CASE_BUSY');f.s.release('123',owner);
});
test('new failure during uncertain correction is persisted and old policy cannot perform new actions',async t=>{
 const f=fixture(t,{shopify:{updateShippingAddress:async()=>{f.calls.patch++;throw Error('timeout');}}}),id=f.start();await f.a.process(id);
 const r=f.a.ingest(event({code:'STOCK_ERROR',failureGeneration:'stock-2'}));assert.equal(r.blocked,'PREVIOUS_EXECUTION_UNCERTAIN');assert.equal(f.s.get(id).private.newFailurePending.event.code,'STOCK_ERROR');await f.a.process(id);assert.equal(f.calls.patch,1);assert.equal(f.calls.post,0);
});
test('phase two can correct but cannot send a template or reimport',async t=>{
 const f=fixture(t,{config:flags({ADDRESS_IMPORT_RECOVERY_ENABLED:'true',ADDRESS_RECOVERY_SHOPIFY_WRITE:'true'})}),id=f.start();await f.a.process(id);assert.equal(f.s.get(id).shopifyCorrectionStatus,'VERIFIED');assert.equal(f.s.get(id).state,'REIMPORT_PENDING');assert.equal(f.calls.post+f.calls.send,0);
});
test('private addresses, original errors and candidates are encrypted; projection/audit have no contacts',t=>{
 const dir=mkdtempSync(join(tmpdir(),'recovery-private-')),file=join(dir,'db.sqlite'),s=new RecoveryStore(file,{privateKey:'fixture-key-no-production-use-1234567'});
 t.after(()=>{s.close();rmSync(dir,{recursive:true,force:true});});const e=event({originalError:'secret address and phone fixture'}),r=s.ingest(e,classify(e));
 assert.equal(s.get(r.case.id).private.originalError,e.originalError);assert.ok(!JSON.stringify(s.overview()).includes(e.originalError));assert.ok(!readFileSync(file).includes(Buffer.from(e.originalError)));
 const other=new RecoveryStore(file,{privateKey:'different-fixture-key-123456789012345'});assert.throws(()=>other.get(r.case.id));other.close();
});
test('fallback filters reject healthy/imported/resolved/active orders and tag alone is not evidence',()=>{
 assert.equal(markedFailureEligible({tags:['error_dropea']}),true);for(const o of [{tags:[]},{tags:['dropea_error'],dropea_id:9},{tags:['dropea_error'],import_recovery_resolved:true},{tags:['dropea_error'],note_attributes:[{name:'dropea_id',value:'9'}]}])assert.equal(markedFailureEligible(o),false);
 assert.equal(markedFailureEligible({tags:['error_dropea']},{hasActiveCase:true}),false);assert.equal(classify({tags:['error_dropea']}),null);
});
test('persisted intake correlates attempted/rejected order, key, exact code and timestamps only',()=>{
 const attempt={orderId:'123',reference:'#123',idempotencyKey:'k1',at:'2026-10-25T11:59:00Z',result:'attempted'},reject={orderId:'123',reference:'#123',at,result:'provider_rejected',status:'provider_rejected',reason:'POSTAL_CODE_NOT_COVERED'},r={idempotencyKey:'k1',at:'2026-10-25T11:59:30Z',http:400,failure:{type:'ValidationFailure',code:'POSTAL_CODE_NOT_COVERED'}};
 assert.equal(persistedLegacyFailures([attempt,reject],[r],{shop:'fixture',storeId:10}).length,1);
 for(const [aa,rr]of [[[reject],[r]],[[attempt,reject],[{...r,idempotencyKey:'other'}]],[[attempt,{...reject,result:'blocked'}],[r]],[[attempt,reject],[{...r,http:500}]]])assert.equal(persistedLegacyFailures(aa,rr,{shop:'fixture',storeId:10}).length,0);
});
test('staged flags cannot inherit global enabled writers or skip rollout phases',()=>{
 assert.equal(flags({PRODUCTION_WRITES_ENABLED:'true'}).enabled,false);
 for(const e of [{ADDRESS_RECOVERY_CHATBY_SEND:'true'},{ADDRESS_IMPORT_RECOVERY_ENABLED:'true',ADDRESS_RECOVERY_DROPEA_IMPORT:'true'},{ADDRESS_IMPORT_RECOVERY_ENABLED:'yes'}])assert.throws(()=>flags(e));
});
test('Shopify transport sends exactly shippingAddress to exact order, once, no global customer/profile/tag changes',async()=>{
 const requests=[],client=recoveryShopify({shop:'fixture.myshopify.com',requestOnce:async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>({data:{orderUpdate:{order:{id:'gid://shopify/Order/123'},userErrors:[]}}})};}});
 await client.updateShippingAddress('123','fixture.myshopify.com',lookup(addressOf(order())).candidates[0]);const body=JSON.parse(requests[0].options.body);
 assert.deepEqual(Object.keys(body.variables.input).sort(),['id','shippingAddress']);assert.equal(body.query,SHIPPING_MUTATION);assert.equal(requests.length,1);await assert.rejects(client.updateShippingAddress('123','another.myshopify.com',{}));
});
