import test from 'node:test';import assert from 'node:assert/strict';
import {supportCycle} from './support-runtime.mjs';
test('disabled support does not access providers',async()=>{assert.equal((await supportCycle({enabled:false})).status,'DISABLED');});
test('expired Gmail never reads cases or reserves delivery',async()=>{let calls=0;const r=await supportCycle({enabled:true,checkMail:async()=>{throw Error('invalid_grant');},readCases:async()=>{calls++;},execute:async()=>{calls++;}});assert.equal(r.status,'GMAIL_REAUTHORIZATION_REQUIRED');assert.equal(calls,0);});
test('one successful mail per cycle bounds load',async()=>{let calls=0;const r=await supportCycle({enabled:true,checkMail:async()=>true,readCases:async()=>[{orderId:'1'},{orderId:'2'}],execute:async()=>{calls++;return {status:'SUPPORT_SENT_SOLUTION_VERIFIED',mailId:'abc'};}});assert.equal(calls,1);assert.equal(r.results[0].orderId,'1');});
test('uncertain side effects stop the batch',async()=>{let calls=0;await supportCycle({enabled:true,checkMail:async()=>true,readCases:async()=>[{orderId:'1'},{orderId:'2'}],execute:async()=>{calls++;return {status:'RECONCILIATION_REQUIRED'};}});assert.equal(calls,1);});
test('unexpected failure stops batch because persistence may have failed',async()=>{const r=await supportCycle({enabled:true,checkMail:async()=>true,readCases:async()=>[{orderId:'1'},{orderId:'2'}],execute:async i=>{if(i.orderId==='1')throw Error('read');return {status:'WAIT_ONE_HOUR'};}});assert.deepEqual(r.results.map(x=>x.status),['CASE_FAILED_REVIEW_REQUIRED']);});
test('case discovery failure is reported and cannot fall through to a provider write',async()=>{let executed=false;const r=await supportCycle({enabled:true,checkMail:async()=>true,readCases:async()=>{throw Error('cache unavailable');},execute:async()=>{executed=true;}});assert.equal(r.status,'SUPPORT_CASE_READ_FAILED');assert.equal(executed,false);});
test('waiting and failed support cases retain exact issue identity for panel feedback',async()=>{
 const run=execute=>supportCycle({enabled:true,checkMail:async()=>true,readCases:async()=>[{orderId:'1',incidenceId:'9'}],execute});
 const waiting=await run(async()=>({status:'WAIT_ONE_HOUR'}));assert.equal(waiting.results[0].currentIssueId,'9');
 const failed=await run(async()=>{throw Error('CAPTURE_SEARCH_FAILED');});assert.equal(failed.results[0].currentIssueId,'9');assert.equal(failed.results[0].needsHumanReview,true);assert.equal(failed.results[0].reason,'CAPTURE_SEARCH_FAILED');
 const privateError=await run(async()=>{throw Error('private customer content');});assert.equal(privateError.results[0].reason,'CASE_EXECUTION_FAILED');assert.equal(JSON.stringify(privateError).includes('private customer content'),false);
});
