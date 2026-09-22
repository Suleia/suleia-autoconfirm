import test from 'node:test';
import assert from 'node:assert/strict';
import {verifiedAbsentOrderPhone,absentResolutionPreflight,recipientAbsentResolutionPanel} from '../src/incident/absent-resolution.mjs';
import {interpretAbsentResponse} from '../src/incident/recipient-absent-policy.mjs';
import {absentSolutionCapability} from '../../../services/integrations/dropea/absent-solution.mjs';
import {fixture,now} from './fixtures/absent-resolution.mjs';

for(const [payload,window,phrase,opposite] of [['ABSENT_TOMORROW_AM','MORNING','por la mañana','por la tarde'],['ABSENT_TOMORROW_PM','AFTERNOON','por la tarde','por la mañana']])test(`verified ${payload}: exact text and no inversion`,()=>{
 const x=fixture('');Object.assign(x.events[0],{button_payload:payload,message_type:'BUTTON',button_verified:true});
 const r=absentResolutionPreflight(x,now);assert.equal(r.can_execute,true,JSON.stringify(r.blocking_reasons));
 assert.equal(r.resolution_text,`Realizar entrega ${phrase} y por favor, llamar al número de teléfono +34600000001`);
 assert.ok(!r.resolution_text.includes(opposite));assert.equal(r.resolution_structured.requested_time_window,window);
 assert.equal(r.resolution_structured.requested_date,'2026-09-23');assert.equal(r.resolution_structured.interpretation_source,'VERIFIED_BUTTON');
 assert.equal(r.idempotency_key,absentResolutionPreflight({...x,events:[...x.events,...x.events]},now).idempotency_key);
});
for(const [text,date,window,phrase] of [
 ['entregar mañana','2026-09-23','UNSPECIFIED','entrega mañana'],
 ['Entregar el día 24 de septiembre por la tarde','2026-09-24','AFTERNOON','el 24/09/2026 por la tarde'],
 ['entregar el día 24 de septiembre','2026-09-24','UNSPECIFIED','el 24/09/2026'],
 ['el viernes por la mañana','2026-09-25','MORNING','el 25/09/2026 por la mañana'],
 ['mañana después de las 16','2026-09-23','FROM_TIME','a partir de las 16:00'],
 ['viernes hasta las 16','2026-09-25','UNTIL_TIME','antes de las 16:00'],
 ['el 24 de septiembre de 10:00 a 14:00','2026-09-24','TIME_RANGE','el 24/09/2026 entre las 10:00 y las 14:00'],
 ['mañana por la mañana no, por la tarde sí','2026-09-23','AFTERNOON','por la tarde']
])test(text,()=>{const r=absentResolutionPreflight(fixture(text),now);assert.equal(r.can_execute,true,JSON.stringify(r.blocking_reasons));assert.equal(r.resolution_structured.requested_date,date);assert.equal(r.resolution_structured.requested_time_window,window);assert.ok(r.resolution_text.includes(phrase));});
for(const text of ['cuando podáis','por la tarde quizá','mañana o pasado por la tarde','antes de comer','cuando salga del trabajo','el viernes menos por la mañana','llamadme y vemos','puede que mañana','no sé','mañana por la mañana no','por la tarde','de 10:00 a 14:00','el 31 de septiembre por la tarde','el 21 de septiembre por la tarde'])test(`no write: ${text}`,()=>{const r=absentResolutionPreflight(fixture(text),now);assert.equal(r.can_execute,false);assert.equal(r.resolution_text,null);assert.equal(recipientAbsentResolutionPanel(r).status,'HUMAN_REVIEW_REQUIRED');});
test('ambiguous reason is visible in panel without logs',()=>{const p=recipientAbsentResolutionPanel(absentResolutionPreflight(fixture('mañana o pasado por la tarde'),now));assert.match(p.detail,/Fecha de entrega no inequívoca/);});
test('phone A never becomes phone B',()=>{
 const a=fixture();const b=fixture();b.issue.canonical_order_id='order-b';b.issue.dropea_order_id='322';
 const phoneB=verifiedAbsentOrderPhone({issue:b.issue,providerOrder:{id:322,store_id:'store',customer_phone:'+34600000002'},observedAt:now,privacyKey:'synthetic-test-key-'.repeat(3)});
 const r=absentResolutionPreflight(a,now);assert.ok(r.resolution_text.includes(a.verified_phone.value));assert.ok(!r.resolution_text.includes(phoneB.value));
 a.verified_phone=phoneB;assert.ok(absentResolutionPreflight(a,now).blocking_reasons.includes('ORDER_PHONE_NOT_VERIFIABLE'));
});
test('missing phone and local phone without a verified country fail closed',()=>{
 const x=fixture();x.verified_phone=verifiedAbsentOrderPhone({issue:x.issue,providerOrder:{id:321,store_id:'store',customer_phone:'600000001'},observedAt:now,privacyKey:'synthetic-test-key-'.repeat(3)});
 const r=absentResolutionPreflight(x,now);assert.equal(r.can_execute,false);assert.match(recipientAbsentResolutionPanel(r).detail,/Teléfono del pedido no verificable/);
});
test('same exact order shipping fallback only; preserves numbers and declared country',()=>{
 const x=fixture();const read=order=>verifiedAbsentOrderPhone({issue:x.issue,providerOrder:order,observedAt:now,privacyKey:'synthetic-test-key-'.repeat(3)});
 assert.equal(read({id:321,store_id:'store',shipping_address:{phone_number:'600 000 001',country:'ES'}}).value,'+34600000001');
 assert.equal(read({id:322,store_id:'store',shipping_address:{phone_number:'+34600000002'}}).verified,false);
 assert.equal(read({id:321,store_id:'store',customer_phone:'invalid',shipping_address:{phone_number:'+34600000002'}}).verified,false);
});
test('latest correction inherits date only from same exact conversation',()=>{
 const x=fixture('Mañana por la mañana');x.events.push({...x.events[0],chatby_message_id:'message-2',created_at:'2026-09-22T11:30:00Z',raw_text:'Mejor por la tarde'});
 let r=absentResolutionPreflight(x,now);assert.equal(r.can_execute,true);assert.match(r.resolution_text,/por la tarde/);assert.equal(r.resolution_structured.supersedes_response_id,'message-1');
 x.events[1].chatby_contact_id_hash='other';assert.equal(absentResolutionPreflight(x,now).can_execute,false);
});
test('later unclear/cancelled request blocks prior valid choice',()=>{
 for(const text of ['no sé','no lo quiero','mañana o pasado']){const x=fixture();x.events.push({...x.events[0],chatby_message_id:'new',created_at:'2026-09-22T11:30:00Z',raw_text:text});assert.equal(absentResolutionPreflight(x,now).can_execute,false);}
});
for(const mutate of [x=>x.issue.status='RESOLVED',x=>x.issue.is_active=false,x=>x.order.canonical_state='DELIVERED',x=>x.issue.resolution_changed_at=now,x=>x.chatby.history_complete=false,x=>x.verified_phone.observed_at='2026-09-22T11:59:44Z',x=>x.logistics_capability.supported_windows=[],x=>x.events[0].canonical_order_id='other'])test('final preflight rejects stale or nonactionable context',()=>{const x=fixture();mutate(x);assert.equal(absentResolutionPreflight(x,now).can_execute,false);});
test('date-only provider requirement is obeyed',()=>{const x=fixture('entregar mañana');x.logistics_capability.requires_window=true;assert.ok(absentResolutionPreflight(x,now).blocking_reasons.includes('DELIVERY_TIME_WINDOW_REQUIRED'));});
test('numeric confidence cannot grant execution',()=>{const x=fixture('cuando podáis');x.events[0].confidence=1;assert.equal(absentResolutionPreflight(x,now).can_execute,false);});
test('free text is not labeled as a verified button',()=>{assert.equal(interpretAbsentResponse({raw_text:'Mañana por la tarde',created_at:now}).interpretation_source,'FREE_TEXT');});
test('audit/panel retain hashes, not full phone or operational note',()=>{const x=fixture(),r=absentResolutionPreflight(x,now),p=recipientAbsentResolutionPanel(r);assert.ok(!JSON.stringify(r.resolution_structured).includes(x.verified_phone.value));assert.ok(!JSON.stringify(p).includes(x.verified_phone.value));});
