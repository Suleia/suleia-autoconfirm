import test from 'node:test';import assert from 'node:assert/strict';
import {readExecutiveBudget} from './budget-read.mjs';
test('report and nocturnal budget slot coexist: only SQL reads, verified changes and critical alerts are described',async()=>{
 const calls=[],ledger={async autopilotHistory(){calls.push('history');return [{items:[{campaignId:'1',reasons:[],result:{state:'VERIFIED',externalWrites:1}},{campaignId:'2',reasons:['GLOBAL_EXPOSURE_LIMIT'],result:{state:'UNKNOWN',externalWrites:1}}]}];},async executiveBudgetCounts(){return {verifiedChanges:1,pendingApprovals:1};},async autopilotSlots(){return [{slot_key:'2026-10-21:22:30',state:'EXECUTING',body:{}},{slot_key:'2026-10-20:23:59',state:'COMPLETE',body:{finalCheck:{state:'CRITICAL_UNVERIFIED_CAP'}}}];}};
 const r=await readExecutiveBudget({ledger,accountId:'9',mode:'LIVE',config:{enabled:true,policy:{version:'v5.1'}},now:Date.parse('2026-10-21T20:30:00Z')});
 assert.equal(r.mode,'LIVE');assert.equal(r.verifiedChanges,1);assert.equal(r.blockedCampaigns,1);assert.equal(r.nextNight,'2026-10-21T20:45:00.000Z');assert.equal(r.alerts.length,2);assert.equal(r.externalWrites,0);assert.deepEqual(calls,['history']);
});
