import test from 'node:test';import assert from 'node:assert/strict';
import {persistedNativeFailure} from './intake.mjs';
import {cartociudadResolver,portalQuery,verifiedPortal} from './cartociudad.mjs';
import {nativeFailures,MARKED_QUERY} from './live.mjs';
const at='2026-10-29T10:00:00Z';
const source=()=>({id:123,name:'#123',created_at:'2026-10-29T08:00:00Z',tags:'dropea_error',note:'dropea_error: Postal code 999 has an invalid format for country ES',shipping_address:{zip:'999',country_code:'ES'}});
const timeline=()=>[{id:1,author:'dropea',verb:'note_created',created_at:at}];
const opts={shop:'fixture.myshopify.com',storeId:10,observedAt:at};
const address={street:'Calle Ejemplo 10',houseNumber:'10',line2:'Piso privado',postalCode:'99999',city:'Madrid',province:'Madrid',country:'ES'};
const result=(patch={})=>({id:'public-fixture',type:'portal',address:'CALLE EJEMPLO 10, Madrid',tip_via:'CALLE',portalNumber:10,extension:null,muni:'Madrid',province:'Madrid',postalCode:'28001',countryCode:'011',noNumber:false,...patch});

test('native intake needs current exact error note + native app timeline; tag alone does nothing',()=>{
 assert.equal(persistedNativeFailure(source(),timeline(),opts).code,'POSTAL_CODE_INVALID');
 for(const patch of [{tags:''},{note:'please fix postal code'},{shipping_address:{zip:'12345',country_code:'ES'}},{tags:'dropea_error',note_attributes:[{name:'dropea_id',value:'123'}]}])assert.equal(persistedNativeFailure({...source(),...patch},timeline(),opts),null);
 assert.equal(persistedNativeFailure(source(),[],opts),null);
 assert.equal(persistedNativeFailure(source(),[{...timeline()[0],author:'someone'}],opts),null);
 assert.equal(persistedNativeFailure(source(),[{...timeline()[0],created_at:'2026-10-20T08:00:00Z'}],opts),null);
});
test('native signature changes generation; stale native note after correction is rejected',()=>{
 const o=source(),a=persistedNativeFailure(o,timeline(),opts);
 const b=persistedNativeFailure({...o,note:'dropea_error: No carrier ships to postal code 999 in ES'},timeline(),opts);
 assert.notEqual(a.failureGeneration,b.failureGeneration);assert.equal(b.code,'NO_CARRIER_FOR_ADDRESS');
 assert.equal(persistedNativeFailure({...o,shipping_address:{zip:'28001',country_code:'ES'}},timeline(),opts),null);
});
test('portal evidence requires unique exact number, street, city, province, country and postcode',()=>{
 const p=portalQuery(address);assert.ok(verifiedPortal([result()],address,p));
 for(const patch of [{type:'callejero'},{portalNumber:11},{address:'CALLE OTRO 10, Madrid'},{muni:'Otra'},{province:'Otra'},{countryCode:'002'},{postalCode:'280'},{noNumber:true}])assert.equal(verifiedPortal([result(patch)],address,p),null);
 assert.equal(verifiedPortal([result(),result({id:'another'})],address,p),null);
 assert.equal(portalQuery({...address,street:'Calle Ejemplo'}),null);
});
test('official resolver never sends contacts/order ids/flat; verifies selected portal again, not first fuzzy result',async()=>{
 const calls=[],r=cartociudadResolver({request:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>calls.length===1?[result({address:'CALLE DIFERENTE 10, Madrid'}),result()]:result()};}});
 const verified=await r.findCandidates({...address,phone:'PRIVATE_PHONE',name:'PRIVATE_NAME',orderId:123});
 assert.equal(verified.confidence,1);assert.equal(verified.candidates[0].postalCode,'28001');assert.equal(verified.verified,true);
 const sent=decodeURIComponent(calls.map(c=>c.url).join(' '));for(const secret of ['PRIVATE_PHONE','PRIVATE_NAME','Piso privado','orderId'])assert.ok(!sent.includes(secret));
 assert.ok(calls.every(c=>c.options.redirect==='error'));assert.equal(calls.length,2);
});
test('resolver mismatch, ambiguity, truncated candidate set and missing number never authorize correction',async()=>{
 for(const rows of [[result(),result({id:'another'})],Array.from({length:50},(_,i)=>result({id:i+1})),[result({portalNumber:11})]]){
  const r=cartociudadResolver({request:async()=>({ok:true,json:async()=>rows})});assert.equal((await r.findCandidates(address)).verified,false);
 }
 let called=0;const r=cartociudadResolver({request:async()=>{called++;throw Error('no');}});assert.equal((await r.findCandidates({...address,street:'Sin número'})).verified,false);assert.equal(called,0);
});
test('failed-only poll is server-filtered, stops at existing provider id, ignores healthy orders and requires full pagination',async()=>{
 const calls=[],store={db:{prepare:()=>({get:()=>null})}};
 const request=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({data:{orders:{nodes:[{id:'gid://shopify/Order/123',tags:['dropea_error','dropea_id:42'],customAttributes:[]},{id:'gid://shopify/Order/124',tags:[],customAttributes:[]}],pageInfo:{hasNextPage:false}}}})};};
 assert.deepEqual(await nativeFailures({request,root:'https://fixture/',...opts,store}),[]);assert.equal(calls.length,1);assert.ok(MARKED_QUERY.includes('(tag:error_dropea OR tag:dropea_error)'));assert.ok(!MARKED_QUERY.includes('status:any'));
});
