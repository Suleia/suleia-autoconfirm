import test from 'node:test';import assert from 'node:assert/strict';
import {createExecutiveService} from './service.mjs';
import {analyzeReview} from '../review/analyze.mjs';
import {fixtureDataset,fixtureExtras,FIXTURE_NOW} from '../review/fixtures.mjs';
const actor={user:'1',chat:'1'};

test('night financial priority defers the report without claiming, failing or delivering; later resumes four parts',async()=>{
 const f=fixture();let ready=false;const s=createExecutiveService({...f.options,financialReady:async()=>ready});
 assert.equal((await s.prepare({kind:'DAILY'})).state,'FINANCIAL_PRIORITY_WAIT');assert.equal(f.rows.size,0);assert.equal(f.reads,0);assert.equal(f.parts.size,0);
 ready=true;await s.prepare({kind:'DAILY'});await s.pending();assert.equal(f.rows.size,1);assert.equal([...f.rows.values()][0].body.messages.length,4);assert.equal(f.writes,0);
});
test('V10 optional growth failure preserves deterministic four-part delivery across October DST',async()=>{
 const f=fixture();f.options.recipients=['1'];f.options.review.growth=async()=>{throw Error('OPTIONAL_HISTORY_UNAVAILABLE');};f.setTime('2026-10-25T21:30:00Z');const s=createExecutiveService(f.options);await Promise.all([s.prepare({kind:'DAILY'}),s.prepare({kind:'DAILY'})]);await s.pending();assert.equal(f.rows.size,1);const row=[...f.rows.values()][0];assert.equal(row.body.messages.length,4);assert.equal(row.body.metaWrites,0);assert.ok(row.body.failures.includes('GROWTH_OPTIONAL_UNAVAILABLE'));for(let i=0;i<4;i++){const part=(await s.command({operation:'due',actor})).executive;assert.equal(part.part,i);await s.command({operation:'finish',actor,id:part.id,part:i,claim:part.claim,state:'SENT',messageId:100+i});}assert.equal((await s.command({operation:'due',actor})).executive.state,'DELIVERED');assert.equal(f.parts.size,4);assert.equal(f.writes,0);
});
function fixture(){
 let at=Date.parse('2026-10-21T20:30:00Z'),reads=0,writes=0;
 const rows=new Map(),parts=new Map(),events=[];
 const ledger={
  async claim(x){let row=rows.get(x.id);if(row)return null;rows.set(x.id,{id:x.id,state:'PREPARING',kind:x.kind,body:null,attempts:1});events.push('GENERATION_CLAIM');return 'lease';},
  async complete(id,lease,body){Object.assign(rows.get(id),{state:'READY',body});events.push('REPORT_SAVED');return true;},
  async fail(id){rows.get(id).state='FAILED';},async get(id){return rows.get(id)||null;},async deliveries(id){return [...parts.values()].filter(p=>p.id===id);},
  async history(){return {entries:[...rows.values()],nextCursor:null};},async missed(x){rows.set(x.id,{state:'MISSED',kind:'DAILY'});},async expirePrior(){},
  async claimPart(x){const key=`${x.id}:${x.recipient}:${x.part}`;if(parts.has(key))return null;parts.set(key,{...x,state:'SENDING',claim:'claim'});events.push('PART_CLAIM');return 'claim';},
  async finishPart(x){const p=parts.get(`${x.id}:${x.recipient}:${x.part}`);if(!p||p.claim!==x.claim)return false;Object.assign(p,{state:x.state,message_id:x.messageId});return true;}
 };
 const report=analyzeReview({dataset:fixtureDataset(),extras:fixtureExtras(fixtureDataset()),now:FIXTURE_NOW});
 const review={async report(q){reads++;return {...structuredClone(report),level:q.level};}};
 const options={review,ledger,accountId:'act_9',panelUrl:'https://panel.example/operations/',enabled:true,recipients:['1','2'],now:()=>at,readBudget:async()=>({mode:'LIVE',enabled:true,verifiedChanges:writes})};
 const service=createExecutiveService(options);
 return {service,options,ledger,rows,parts,events,setTime:t=>at=Date.parse(t),get reads(){return reads;},get writes(){return writes;}};
}
test('one report per date/account with concurrent ticks and restart; ordered independent numeric recipients',async()=>{
 const f=fixture();const prepared=await Promise.all(Array.from({length:4},()=>f.service.command({operation:'due',actor})));
 await f.service.pending();assert.equal(f.rows.size,1);assert.equal(f.reads,4);assert.equal(f.events.filter(x=>x==='GENERATION_CLAIM').length,1);
 let r=(await f.service.command({operation:'due',actor})).executive;assert.equal(r.state,'SEND');assert.equal(r.part,0);
 assert.equal((await f.service.command({operation:'due',actor})).executive.state,'WAIT');
 const restarted=createExecutiveService(f.options);assert.equal((await restarted.command({operation:'due',actor})).executive.state,'WAIT');
 await restarted.command({operation:'finish',actor,id:r.id,part:0,claim:r.claim,state:'SENT',messageId:22});
 r=(await restarted.command({operation:'due',actor})).executive;assert.equal(r.part,1);
 const other=(await restarted.command({operation:'due',actor:{user:'2',chat:'2'}})).executive;assert.equal(other.part,0);assert.equal(other.id,r.id);assert.equal(f.writes,0);
});
test('uncertain receipt remains blocked after restart; no blind send or later parts',async()=>{
 const f=fixture();await f.service.prepare({kind:'DAILY'});await f.service.pending();const r=(await f.service.command({operation:'due',actor})).executive;
 await f.service.command({operation:'finish',actor,id:r.id,part:r.part,claim:r.claim,state:'UNKNOWN'});
 const next=await createExecutiveService(f.options).command({operation:'due',actor});assert.equal(next.executive.state,'WAIT');assert.equal(f.parts.size,1);
});
test('manual audit has its own key and never claims a Telegram lane; supports selected period',async()=>{
 const f=fixture();let q;f.options.review.report=async query=>{q=query;return analyzeReview({dataset:fixtureDataset(),now:FIXTURE_NOW});};
 const value=await f.service.prepare({query:{period:'30d'},principal:'panel:owner'});await f.service.pending();
 assert.equal((await f.service.detail(value.id)).kind,'MANUAL');assert.equal(f.parts.size,0);assert.equal(f.writes,0);
 const daily=await f.service.prepare({kind:'DAILY'});assert.notEqual(daily.id,value.id);await f.service.pending();
});
test('authorization: private numeric recipient only, no username/group/unconfigured user',async()=>{
 const f=fixture();for(const actor of [{user:'3',chat:'3'},{user:'1',chat:'-12'},{user:'Juanmartos',chat:'Juanmartos'},null])await assert.rejects(f.service.command({operation:'due',actor}),/ACTOR_UNAUTHORIZED/);
 assert.equal(f.reads,0);assert.equal(f.rows.size,0);
 const disabled=createExecutiveService({...f.options,enabled:false});await assert.rejects(disabled.command({operation:'due',actor}),/EXECUTIVE_DISABLED/);
});
test('late restart is MISSED; no send and no budget recovery; early tick is not due',async()=>{
 const f=fixture();f.setTime('2026-10-21T20:29:00Z');assert.equal((await f.service.command({operation:'due',actor})).executive.state,'NOT_DUE');
 f.setTime('2026-10-21T21:01:00Z');assert.equal((await f.service.command({operation:'due',actor})).executive.state,'MISSED');assert.equal(f.reads,0);assert.equal(f.parts.size,0);assert.equal(f.writes,0);
});
test('Meta unavailable still saves explicit incomplete report; bounded preparation retries, zero mutations',async()=>{
 const f=fixture();let attempts=0;f.options.review.report=async()=>{attempts++;throw Object.assign(Error('ADS_REPORT_PREPARING'),{code:'ADS_REPORT_PREPARING'});};
 const service=createExecutiveService({...f.options,sleep:async()=>{}});const p=await service.prepare({kind:'DAILY'});await service.pending();
 const r=await service.detail(p.id);assert.equal(r.state,'READY');assert.equal(r.body.dataState,'INSUFFICIENT');assert.ok(attempts<=90);assert.equal(r.body.metaWrites,0);
});
test('SENT requires a valid receipt and forged message index/claim cannot change delivery',async()=>{
 const f=fixture();const p=await f.service.prepare({kind:'DAILY'});await f.service.pending();
 await assert.rejects(f.service.command({operation:'finish',actor,id:p.id,part:0,claim:'forged',state:'SENT'}),/RECEIPT_REQUIRED/);
 await assert.rejects(f.service.command({operation:'finish',actor,id:p.id,part:99,claim:'forged',state:'SENT',messageId:1}),/QUERY_INVALID/);
 const r=await f.service.command({operation:'finish',actor,id:p.id,part:0,claim:'forged',state:'SENT',messageId:1});assert.equal(r.executive.state,'UNCHANGED');
});
test('a completed daily delivery is never falsely marked MISSED after the window closes',async()=>{
 const f=fixture();await f.service.prepare({kind:'DAILY'});await f.service.pending();
 for(const user of ['1','2'])for(let i=0;i<4;i++){const actor={user,chat:user},r=(await f.service.command({operation:'due',actor})).executive;await f.service.command({operation:'finish',actor,id:r.id,part:r.part,claim:r.claim,state:'SENT',messageId:100+i});}
 f.setTime('2026-10-21T21:01:00Z');assert.equal((await f.service.command({operation:'due',actor})).executive.state,'DELIVERED');assert.equal([...f.rows.values()][0].state,'READY');
});
test('an unfinished delivery after23:00 is visible as incomplete and cannot create more sends',async()=>{
 const f=fixture();await f.service.prepare({kind:'DAILY'});await f.service.pending();f.setTime('2026-10-21T21:01:00Z');assert.equal((await f.service.command({operation:'due',actor})).executive.state,'DELIVERY_INCOMPLETE');assert.equal(f.parts.size,0);
});

test('a retained stale snapshot with a pending canonical refresh waits for fresh evidence',async()=>{
 const f=fixture(),calls=new Map(),waits=[];let at=FIXTURE_NOW;
 const base=analyzeReview({dataset:fixtureDataset(),extras:fixtureExtras(fixtureDataset()),now:FIXTURE_NOW});
 const service=createExecutiveService({...f.options,now:()=>at,sleep:async ms=>{waits.push(ms);at+=ms;},review:{async report(q){
  const key=q.period+':'+q.level,n=(calls.get(key)||0)+1;calls.set(key,n);
  return {...structuredClone(base),observedAt:new Date(n===1?at-3600000:at).toISOString(),freshness:n===1?'STALE':'FRESH',diagnostic:n===1?{code:'ADS_REPORT_PREPARING'}:null};
 }}});
 const p=await service.prepare({kind:'MANUAL',query:{period:'hoy'},principal:'synthetic-owner'});await service.pending();const r=await service.detail(p.id);
 assert.equal(r.state,'READY');assert.notEqual(r.body.dataState,'INSUFFICIENT');
 for(const k of ['today','week','ads','month'])assert.equal(r.body.evidence[k].freshness,'FRESH');
 assert.deepEqual([...calls.values()],[2,2,2,2]);assert.deepEqual(waits,[3000,3000,3000,3000]);
 assert.equal(f.parts.size,0);assert.equal(r.body.metaWrites,0);
});

test('pending retained evidence respects the generation deadline and is never promoted to fresh',async()=>{
 const f=fixture();let at=FIXTURE_NOW,reads=0;
 const service=createExecutiveService({...f.options,now:()=>at,generationMs:6000,sleep:async ms=>{at+=ms;},review:{async report(){reads++;return {freshness:'STALE',diagnostic:{code:'ADS_REPORT_PREPARING'}};}}});
 const p=await service.prepare({kind:'MANUAL'});await service.pending();const r=await service.detail(p.id);
 assert.equal(reads,2);assert.equal(r.body.dataState,'INSUFFICIENT');assert.ok(r.body.failures.includes('CURRENT_UNAVAILABLE'));assert.equal(f.parts.size,0);
});

test('a definitive source error preserves historical evidence without automatic retries',async()=>{
 const f=fixture(),base=analyzeReview({dataset:fixtureDataset(),extras:fixtureExtras(fixtureDataset()),now:FIXTURE_NOW});let reads=0,waits=0;
 const service=createExecutiveService({...f.options,sleep:async()=>{waits++;},review:{async report(){reads++;return {...structuredClone(base),freshness:'STALE',diagnostic:{code:'META_HTTP_403'}};}}});
 const p=await service.prepare({kind:'MANUAL'});await service.pending();const r=await service.detail(p.id);
 assert.equal(reads,4);assert.equal(waits,0);assert.equal(r.body.dataState,'INSUFFICIENT');assert.equal(r.body.evidence.today.freshness,'STALE');assert.equal(r.body.priorities.length,0);
});
