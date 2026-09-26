import test from 'node:test';
import assert from 'node:assert/strict';
import {createDropeaAbsentSolutionWriter,absentSolutionCapability} from './absent-solution.mjs';
import {fixture,now} from '../../../packages/platform-core/test/fixtures/absent-resolution.mjs';
import {absentResolutionPreflight} from '../../../packages/platform-core/src/incident/absent-resolution.mjs';
const token=scope=>`e30.${Buffer.from(JSON.stringify({scope,exp:9999999999})).toString('base64url')}.synthetic`;
test('readonly token cannot construct a writer',()=>{assert.throws(()=>createDropeaAbsentSolutionWriter({token:token('dp:issues:read'),market:'ES'}),/WRITE_PERMISSION_NOT_AVAILABLE/);});
test('official free note contract, one POST, safe response and idempotency header',async()=>{
 const calls=[];const writer=createDropeaAbsentSolutionWriter({token:token('dp:issues:resolve'),market:'ES',fetchImpl:async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({success:true,data:{id:123,order_id:321,status:'RESOLVED',resolution_status:'SOLUTION_PROVIDED',resolution_changed_at:now,customer_phone:'must-never-escape'}}),{status:200});}});
 const resolution=absentResolutionPreflight(fixture(),now);const r=await writer.provideSolution({issueId:123,resolution,idempotencyKey:resolution.idempotency_key});
 assert.equal(r.confirmed,true);assert.equal(calls.length,1);assert.equal(calls[0].options.headers['Idempotency-Key'],resolution.idempotency_key);
 assert.deepEqual(Object.keys(JSON.parse(calls[0].options.body)).sort(),['resolution_note','resolution_status','status']);assert.ok(!JSON.stringify(r).includes('must-never-escape'));
});
test('transport failure never retries or prints payload',async()=>{let calls=0;const w=createDropeaAbsentSolutionWriter({token:token('dp:issues:resolve'),market:'ES',fetchImpl:async()=>{calls++;throw new Error('private provider content');}});const r=absentResolutionPreflight(fixture(),now);const out=await w.provideSolution({issueId:123,resolution:r,idempotencyKey:r.idempotency_key});assert.equal(calls,1);assert.equal(out.confirmed,false);assert.ok(!JSON.stringify(out).includes('private'));});
test('provider permission is issue and market scoped',()=>{const x=fixture();x.issue.allowed_resolution_options=[];assert.equal(absentSolutionCapability({issue:x.issue,observedAt:now}).verified,false);x.issue.allowed_resolution_options=['PROVIDE_SOLUTION'];x.issue.market='PT';assert.equal(absentSolutionCapability({issue:x.issue,observedAt:now}).verified,false);});
