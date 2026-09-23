import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyNativeAbsentNotice} from './recipient-absent-native-verification.mjs';
const claim={conversation_id:'test-conversation',claimed_at:'2026-09-23T10:00:00Z'};
const msg={direction:'OUTBOUND',at:'2026-09-23T10:01:00Z',template_name:'dropea_ausente_v3',template_id:'1552419',message_id:'test-notice'};
const history=messages=>({complete:true,conversation_id:claim.conversation_id,messages});
const now=new Date('2026-09-23T12:00:00Z');
test('verified real notice starts a 48-hour timer at notification, not issue creation',()=>{
 const result=verifyNativeAbsentNotice(claim,history([msg]),now);
 assert.equal(result.verified,true);assert.equal(result.timer.started_at,new Date(msg.at).toISOString());
 assert.equal(Date.parse(result.timer.due_at)-Date.parse(result.timer.started_at),48*3600000);
 assert.equal(result.timer.message_id,msg.message_id);
});
test('v2 and duplicate v3 trip the scoped breaker',()=>{
 assert.equal(verifyNativeAbsentNotice(claim,history([msg,{...msg,message_id:'other'}]),now).reason,'DUPLICATE_V3_NOTICE');
 assert.equal(verifyNativeAbsentNotice(claim,history([{...msg,template_name:'dropea_incidencia_ausente_v2'}]),now).reason,'V2_AFTER_CUTOVER');
});
test('wrong conversation, incomplete history, future/failed/missing and preclaim notices cannot start timers',()=>{
 for(const h of [{...history([msg]),complete:false},{...history([msg]),conversation_id:'other'},history([]),
 history([{...msg,at:'2026-09-23T14:00:00Z'}]),history([{...msg,delivery_failed:true}]),history([{...msg,at:'2026-09-23T09:00:00Z'}])])
 assert.equal(verifyNativeAbsentNotice(claim,h,now).verified,false);
});
