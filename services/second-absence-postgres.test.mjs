import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
import {ShadowRepository} from '../packages/suleia-operations-mcp/src/shadow/repository.mjs';
import {createNativeAbsentLedger} from './recipient-absent-native-gate.mjs';
import {reconcileNativeAbsentNotice} from './recipient-absent-native-verification.mjs';
const url=process.env.SECOND_ABSENCE_TEST_DATABASE_URL;
test('real PostgreSQL serializes initial/second/third stages and preserves independent receipts/timer', {skip:!url},async()=>{
 const parsed=new URL(url);assert.equal(parsed.pathname,'/second_absence_test');
 const db=new ShadowRepository(url),pool=db.pool;
 try{
  for(const role of ['suleia_ingestion','suleia_operations_readonly','suleia_mcp_readonly','suleia_backup'])await pool.query(`CREATE ROLE ${role}`);
  await pool.query('CREATE SCHEMA operations');await pool.query(await fs.readFile(new URL('../migrations/045_absent_native_notification_gate.sql',import.meta.url),'utf8'));
  const ledger=createNativeAbsentLedger(pool);
  const claim=async(issue,stage='INITIAL',prior=null)=>ledger.transaction(async store=>{await store.controlForUpdate();
   const {randomUUID}=await import('node:crypto');const claim_id=randomUUID();
   return await store.claim({canonical_issue_id:issue,canonical_order_id:'order',conversation_id:'conversation',claim_id,
    template_version:'dropea_ausente_v3',notice_stage:stage,second_notice:prior?{previous_claim_id:prior}:null})?claim_id:null;});
  const initial=(await Promise.all(Array.from({length:20},()=>claim('initial')))).filter(Boolean);
  assert.equal(initial.length,1);
  assert.equal(await claim('second','SECOND_ABSENCE',initial[0]),null,'unverified predecessor blocks');
  await pool.query("UPDATE operations.recipient_absent_native_notifications SET claimed_at='2026-10-21T10:00:00Z'");
  const first={direction:'OUTBOUND',at:'2026-10-21T10:01:00Z',message_id:'first',provider_message_id:'wamid.first',template_name:'dropea_ausente_v3',template_id:'1552419'};
  const history={complete:true,conversation_id:'conversation',messages:[first]};
  const verify=id=>reconcileNativeAbsentNotice({pool,claimId:id,readHistory:async()=>history,now:()=>new Date('2026-10-23T12:00:00Z')});
  assert.equal((await verify(initial[0])).verified,true);
  const timerBefore=(await pool.query('SELECT * FROM operations.recipient_absent_native_timers')).rows;
  const seconds=(await Promise.all(Array.from({length:20},(_,i)=>claim('second-'+i,'SECOND_ABSENCE',initial[0])))).filter(Boolean);
  assert.equal(seconds.length,1);await pool.query("UPDATE operations.recipient_absent_native_notifications SET claimed_at='2026-10-22T10:00:00Z' WHERE claim_id=$1",[seconds[0]]);
  history.messages.push({...first,message_id:'second',provider_message_id:'wamid.second',at:'2026-10-22T10:01:00Z'});
  assert.equal((await verify(initial[0])).verified,true,'authorized successor is not a duplicate of first');
  assert.equal((await verify(seconds[0])).verified,true);
  await pool.query("UPDATE operations.recipient_absent_native_notifications SET outcome=outcome-'provider_message_id' WHERE claim_id=$1",[seconds[0]]);
  assert.equal((await verify(seconds[0])).verified,true,'late definitive provider ID upgrades an earlier provisional receipt');
  assert.deepEqual((await pool.query('SELECT * FROM operations.recipient_absent_native_timers')).rows,timerBefore,'initial deadline unchanged; no new timer');
  assert.equal(await claim('third','SECOND_ABSENCE',initial[0]),null);
  assert.equal(await claim('third'),null);
  const rows=(await pool.query('SELECT status,outcome FROM operations.recipient_absent_native_notifications ORDER BY claimed_at')).rows;
  assert.deepEqual(rows.map(r=>r.status),['VERIFIED','VERIFIED']);
  assert.deepEqual(rows.map(r=>r.outcome.notice_stage),['INITIAL','SECOND_ABSENCE']);
  assert.equal(rows[1].outcome.previous_claim_id,initial[0]);
  assert.equal(rows[1].outcome.provider_message_id,'wamid.second');
 }finally{await db.close();}
});
