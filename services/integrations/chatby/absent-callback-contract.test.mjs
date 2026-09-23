import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyAbsentCallback} from './absent-callback-contract.mjs';
import {ABSENT_TEMPLATE_BUTTONS,ABSENT_TEMPLATE_NAME} from '../../../packages/platform-core/src/incident/absent-template.mjs';
// Synthetic fixtures test the fail-closed mechanism. They are not activation
// evidence and must never be loaded into the production control record.
const fixture=()=>({status:'OBSERVED_REAL',template_name:ABSENT_TEMPLATE_NAME,template_id:'1552419',
 evidence_id:'synthetic-test-only',observed_at:'2026-09-22T10:00:00Z',buttons:ABSENT_TEMPLATE_BUTTONS.map((b,i)=>({
 text:b.text,canonical_payload:b.payload,provider_id:`f1n${100+i}`,observed_message_id:`test-response-${i}`,observed_notification_message_id:'test-notice'}))});
const callback=(id='f1n100')=>({context:{id:'notice'},user_ns:'conversation',created_at:'2026-09-22T10:30:00Z',interactive:{button_reply:{id,title:'Mañana por la mañana'}}});
const now=new Date('2026-09-22T11:00:00Z');
const notice={verified:true,template_id:'1552419',message_id:'notice',conversation_id:'conversation',notification_at:'2026-09-22T10:10:00Z'};
test('only the exact ID in an observed contract becomes verified',()=>{
 assert.equal(verifyAbsentCallback(callback(),ABSENT_TEMPLATE_NAME,fixture(),now,notice)?.canonical_payload,'ABSENT_TOMORROW_MORNING');
 assert.equal(verifyAbsentCallback(callback('ABSENT_TOMORROW_AM'),ABSENT_TEMPLATE_NAME,fixture(),now,notice),null);
 assert.equal(verifyAbsentCallback(callback('f1n999'),ABSENT_TEMPLATE_NAME,fixture(),now,notice),null);
});
test('configured, absent and future contracts cannot verify callbacks',()=>{
 for(const c of [null,{...fixture(),status:'CONFIGURED'},{...fixture(),observed_at:'2026-09-23T10:00:00Z'}])assert.equal(verifyAbsentCallback(callback(),ABSENT_TEMPLATE_NAME,c,now,notice),null);
});
test('v2 context and duplicate provider IDs are forbidden',()=>{
 assert.equal(verifyAbsentCallback(callback(),'dropea_incidencia_ausente_v2',fixture(),now,notice),null);
 const c=fixture();c.buttons[1].provider_id=c.buttons[0].provider_id;
 assert.equal(verifyAbsentCallback(callback(),ABSENT_TEMPLATE_NAME,c,now,notice),null);
});
test('ambiguous IDs, label mismatch and missing observed notification block verification',()=>{
 assert.equal(verifyAbsentCallback({...callback(),button_payload:'f1n101'},ABSENT_TEMPLATE_NAME,fixture(),now,notice),null);
 assert.equal(verifyAbsentCallback({...callback(),button_text:'Mañana por la tarde'},ABSENT_TEMPLATE_NAME,fixture(),now,notice),null);
 const c=fixture();delete c.buttons[0].observed_notification_message_id;
 assert.equal(verifyAbsentCallback(callback(),ABSENT_TEMPLATE_NAME,c,now,notice),null);
});

test('button must reply to the verified current v3 notice in the exact conversation after send',()=>{
 for(const change of [{context:{id:'older-notice'}},{user_ns:'other-conversation'},{created_at:'2026-09-22T10:00:00Z'},
 {created_at:'2026-09-23T10:00:00Z'},{context:null}])assert.equal(verifyAbsentCallback({...callback(),...change},ABSENT_TEMPLATE_NAME,fixture(),now,notice),null);
 assert.equal(verifyAbsentCallback(callback(),ABSENT_TEMPLATE_NAME,fixture(),now,null),null);
 assert.equal(verifyAbsentCallback(callback(),ABSENT_TEMPLATE_NAME,fixture(),now,{...notice,verified:false}),null);
});
