import test from 'node:test';import assert from 'node:assert/strict';
import {createAbsentObserverHealth,readAbsentControllerHealth} from './recipient-absent-health.mjs';
import {createAbsentEvidenceProjector} from './recipient-absent-projector.mjs';
import {readFile} from 'node:fs/promises';
test('observer health detects missing cycles and provider failures, recovers only on completed cycle',()=>{
 let at=new Date('2026-09-25T12:00:00Z');const h=createAbsentObserverHealth({now:()=>at});assert.equal(h.snapshot().healthy,false);
 h.start();h.finish({observed:0});assert.equal(h.snapshot().healthy,true);
 at=new Date(+at+301000);assert.equal(h.snapshot().healthy,false);h.finish({deferred:true});assert.equal(h.snapshot().healthy,false);
 h.finish({failed:true});assert.equal(h.snapshot().healthy,false);h.finish({observed:1});assert.equal(h.snapshot().healthy,true);
 h.fail();assert.equal(h.snapshot().healthy,false);
});
test('resolution breaker is visible but does not disable notification health or native control',async()=>{
 const queries=[];const pool={query:async sql=>{queries.push(sql);return {rows:sql.includes('native_control')?[{status:'CANARY',automation_live:true,native_send_enabled:true,canary_issue_id:'private-id'}]:sql.includes('resolution_control')?[{status:'DISABLED',circuit_breaker_reason:'PROVIDER_RESULT_UNVERIFIED'}]:[{reservations:1,notifications:1,timers:1,resolutions:0,callbacks:1}]};}};
 const out=await readAbsentControllerHealth(pool,{snapshot:()=>({healthy:true,last_completed_at:'2026-09-25T12:00:00Z'})});
 assert.equal(out.ok,true);assert.equal(out.notification.enabled,true);assert.equal(out.resolution.breaker,'PROVIDER_RESULT_UNVERIFIED');assert.equal(out.counts.timers,1);
 assert.ok(queries.every(q=>q.startsWith('SELECT')));assert.doesNotMatch(JSON.stringify(out),/private-id/);
});
test('AUSENTE evidence projector never persists customer events or needs shared write grants',async()=>{
 const p=createAbsentEvidenceProjector();assert.deepEqual(Object.keys(p),['recordChatbyConversationEvent']);
 assert.deepEqual(await p.recordChatbyConversationEvent({raw_text:'private'}),{inserted:false});
 const source=await readFile(new URL('./recipient-absent-resolution-worker.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/OperationsProjector/);assert.match(source,/createAbsentEvidenceProjector\(\)/);
 const native=await readFile(new URL('./recipient-absent-native-worker.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(native,/AUSENTE_DROPEA_WRITE_TOKEN|createDropeaAbsentSolutionWriter/);
});
