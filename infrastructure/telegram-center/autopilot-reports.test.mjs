import test from 'node:test';
import assert from 'node:assert/strict';
import {AutopilotReports} from './autopilot-reports.mjs';
import {formatAdsResult} from './ads-gateway.mjs';
test('Autopilot reports reuse the poller/store, preserve actor binding and unknown-send claims',async()=>{
 const state={},store={state,save(){}},sent=[],actors=[];
 const config={autopilotReportsEnabled:true,allowedUserIds:['1','2']};
 const report={mode:'SHADOW',enabled:true,nextReviewAt:'2026-10-22T11:00Z',slots:[{slot_key:'2026-10-22:12:00',state:'COMPLETE',body:{decisions:[],outcomes:[],externalWrites:0}}]};
 const options={config,store,now:()=>Date.parse('2026-10-22T10:01:00Z'),gateway:{read:async(body,actor)=>{assert.equal(body.action,'autopilot');actors.push(actor);return {autopilot:report,cycleText:'12:00 SHADOW sin escrituras',cycleKey:'2026-10-22:12:00'};}},api:{telegram:async(method,body)=>{assert.equal(method,'sendMessage');sent.push(body);if(body.chat_id==='1')throw Error('uncertain');}}};
 await new AutopilotReports(options).tick();await new AutopilotReports(options).tick();
 assert.equal(sent.length,2);assert.deepEqual(actors,[{user:'1',chat:'1'},{user:'2',chat:'2'}]);assert.equal(state.autopilotDeliveries['2026-10-22:12:00:1'].state,'UNKNOWN');assert.equal(state.autopilotDeliveries['2026-10-22:12:00:2'].state,'SENT');assert.match(sent[0].text,/SHADOW/);
});
test('reports remain off by default and do not send an incomplete scheduled cycle',async()=>{
 let sends=0;const store={state:{},save(){}},options={config:{allowedUserIds:['1'],autopilotReportsEnabled:false},store,now:()=>Date.parse('2026-10-22T10:00:00Z'),gateway:{read:async()=>({autopilot:{enabled:true,slots:[{slot_key:'2026-10-22:12:00',state:'EXECUTING'}]}})},api:{telegram:async()=>{sends++;}}};
 await new AutopilotReports(options).tick();options.config.autopilotReportsEnabled=true;await new AutopilotReports(options).tick();assert.equal(sends,0);
});
test('a delayed final report after Madrid midnight keeps the previous slot date',async()=>{
 const sent=[],options={config:{allowedUserIds:['1'],autopilotReportsEnabled:true},store:{state:{},save(){}},now:()=>Date.parse('2026-10-22T22:01:00Z'),gateway:{read:async()=>({autopilot:{mode:'SHADOW',enabled:true,nextReviewAt:'2026-10-23T05:00Z',slots:[{slot_key:'2026-10-22:23:59',state:'COMPLETE',body:{finalCheck:{state:'NOT_ENFORCED_SHADOW'}}}]},cycleKey:'2026-10-22:23:59',cycleText:'2026-10-22:23:59 NOT_ENFORCED_SHADOW'})},api:{telegram:async(_method,body)=>sent.push(body)}};
 await new AutopilotReports(options).tick();assert.equal(sent.length,1);assert.match(sent[0].text,/2026-10-22:23:59/);assert.match(sent[0].text,/NOT_ENFORCED_SHADOW/);
});
test('bot shows actual Autopilot mode and keeps SHADOW plans distinct from real writes',()=>{
 const r=formatAdsResult({text:'SHADOW desactivado: no modifica Meta',autopilot:{mode:'SHADOW',enabled:false,date:'2026-10-22',observedAt:'2026-10-22T10:00Z',nextReviewAt:'2026-10-22T11:00Z',campaigns:[],timeline:[]}});assert.match(r.text,/desactivado/);assert.match(r.text,/no modifica Meta/);
});
