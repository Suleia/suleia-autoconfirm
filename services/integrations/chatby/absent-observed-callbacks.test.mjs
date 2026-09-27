import test from 'node:test';import assert from 'node:assert/strict';
import {captureObservedAbsentCallbacks} from './absent-observed-callbacks.mjs';
const notice={verified:true,template_id:'1552419',message_id:'notice',conversation_id:'conversation',notification_at:'2026-09-23T10:00:00Z'};
const message={mid:'response',user_ns:'conversation',context:{id:'notice'},created_at:'2026-09-23T10:10:00Z',payload:{payload:'f1n2',title:'Mañana por la tarde'}};
const now=new Date('2026-09-23T12:00:00Z');
test('capture persists actual bound callback fields without installing an activation contract',()=>{
 const result=captureObservedAbsentCallbacks([message],notice,now);
 assert.equal(result.samples[0].real_button_id,'f1n2');assert.equal(result.samples[0].canonical_payload,'ABSENT_TOMORROW_AFTERNOON');
 assert.equal(result.samples[0].message_id,'response');assert.equal(result.samples[0].notification_message_id,'notice');
 assert.equal(result.samples[0].conversation_id,'conversation');assert.equal(result.samples[0].status,'OBSERVED_REAL');
});
test('unbound responses never become productive evidence; unknown bound callbacks are reported',()=>{
 assert.equal(captureObservedAbsentCallbacks([{...message,context:{id:'old'}}],notice,now).samples.length,0);
 assert.equal(captureObservedAbsentCallbacks([{...message,payload:{payload:'unexpected',title:'unknown'}}],notice,now).unknown.length,1);
});
