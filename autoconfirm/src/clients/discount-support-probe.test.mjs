import test from 'node:test';
import assert from 'node:assert/strict';
import {probeAuthorized,validCaptureProbe,probeSupportConnections} from './discount-support-probe.mjs';
const plan={orderId:'1',issueId:'2',offerMessageId:'3',acceptanceMessageId:'4',phone:'+34600000000',conversationId:'f1u2',customerName:'Test',snapshot:'test',finalCents:2499,offerAt:'2026-10-01T10:00:00Z',acceptedAt:'2026-10-01T11:00:00Z'};
test('probe never permits missing or incorrect credentials',()=>{
 assert.equal(probeAuthorized(undefined,undefined),false);
 assert.equal(probeAuthorized('Bearer secret',''),false);
 assert.equal(probeAuthorized('Bearer different','secret'),false);
 assert.equal(probeAuthorized('Bearer secret','secret'),true);
});
test('probe rejects malformed identity before opening connections',async()=>{
 for(const patch of [{orderId:'1,div'},{phone:'600000000'},{conversationId:'https://example.org'},{acceptedAt:plan.offerAt},{finalCents:NaN},{customerName:''}]) {
  assert.equal(validCaptureProbe({...plan,...patch}),false);
  await assert.rejects(probeSupportConnections({...plan,...patch},{mail:{check(){assert.fail('must not connect');}}}),/PROBE_INPUT_INVALID/);
 }
});
test('probe validates evidence, returns original bytes and releases lock after failure',async()=>{
 const bytes=Buffer.alloc(1100);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
 const evidence={...plan,source:'CHATBY_BROWSER_SCREENSHOT',capturedAt:new Date().toISOString(),visiblePhone:true,visibleDateTime:true,visibleAcceptance:true,visibleOffer:true,attachments:[{filename:'proof.png',mimeType:'image/png',bytes}]};
 const calls=[];const deps={mail:{async check(){calls.push('check');}},capture:async()=>evidence};
 await assert.rejects(probeSupportConnections(plan,{...deps,capture:async()=>({...evidence,orderId:'99'})}),/PROBE_EVIDENCE_INVALID/);
 const result=await probeSupportConnections(plan,deps);
 assert.deepEqual(calls,['check','check']);
 assert.equal(result.gmailVerified,true);assert.equal(result.captureVerified,true);
 assert.deepEqual(Buffer.from(result.attachments[0].base64,'base64'),bytes);
});
