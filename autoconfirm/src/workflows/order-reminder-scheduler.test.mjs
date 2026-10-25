import test from 'node:test';
import assert from 'node:assert/strict';
import {createScheduledJobQueue} from '../scheduled-job-queue.mjs';
import {queueOrderReminderScan} from './order-reminder-scheduler.mjs';

test('disabled reminder registers no job and cannot invoke the sender lane',()=>{
 let calls=0;assert.equal(queueOrderReminderScan({enabled:false,schedule:()=>{calls++;},scan:()=>{calls++;}}),null);assert.equal(calls,0);
});
test('existing tick registers an independent natural job before later startup jobs, coalescing pending repeats',async()=>{
 const queue=createScheduledJobQueue(),events=[];let release;
 const old=queue.schedule('background_poll',async()=>{events.push('orders-start');await new Promise(r=>release=r);events.push('orders-end');});
 const config={enabled:true,schedule:queue.schedule,scan:async options=>{assert.deepEqual(options,{natural:true});events.push('reminder');return {externalWrites:0};},onCycle:r=>assert.equal(r.externalWrites,0)};
 const reminder=queueOrderReminderScan(config);
 const other=queue.schedule('operational_orders',async()=>events.push('operational'));
 const duplicate=await queueOrderReminderScan(config);assert.equal(duplicate.skipped,true);
 await new Promise(r=>setImmediate(r));assert.deepEqual(events,['orders-start']);
 release();await Promise.all([old,reminder,other]);assert.deepEqual(events,['orders-start','orders-end','reminder','operational']);assert.equal(queue.pendingCount(),0);
});
test('failed reminder does not stop or repeat another workflow',async()=>{
 const queue=createScheduledJobQueue();let oldRuns=0;
 const reminder=queueOrderReminderScan({enabled:true,schedule:queue.schedule,scan:async()=>{throw Error('read unavailable');}});
 const old=queue.schedule('incidents_sync',async()=>{oldRuns++;});
 await assert.rejects(reminder,/read unavailable/);await old;assert.equal(oldRuns,1);assert.equal(queue.pendingCount(),0);
});
