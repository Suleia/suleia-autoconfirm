import test from 'node:test';import assert from 'node:assert/strict';import {reportReader,sourceReadAt} from './report-reader.mjs';
test('analysis GETs coalesce by exact contract; original financial reads stay fresh',async()=>{
 let now=1000,inventory=0,insights=0,fail=false;
 const original={async readEntities(){inventory++;if(fail)throw Error('META_RATE_LIMITED');return [{id:'1'}];},async readInsights(){insights++;return [];}};
 const view=reportReader(original,{now:()=>now});await Promise.all([view.readEntities('ad'),view.readEntities('ad')]);assert.equal(inventory,1);
 await view.readEntities('ad');assert.equal(inventory,1);await original.readEntities('ad');assert.equal(inventory,2);
 const first=await view.readInsights({period:'hoy'});now+=1000;assert.equal(await view.readInsights({period:'hoy'}),first);assert.equal(sourceReadAt(first),1000);assert.equal(insights,1);
 await original.readInsights({period:'hoy'});await view.readInsights({period:'ayer'});assert.equal(insights,3);
 now+=301000;fail=true;await assert.rejects(view.readEntities('ad'));await assert.rejects(view.readEntities('ad'));assert.equal(inventory,4);
 fail=false;await view.readEntities('ad');assert.equal(inventory,5);
});
test('bounded report cache retains source cut including epoch zero and never renews stale data',async()=>{
 let now=0,calls=0;const view=reportReader({async readInsights(q){calls++;return [{id:q.level}];}},{now:()=>now,ttlMs:10,maxEntries:2,maxRows:2});
 const first=await view.readInsights({level:'campaign'});assert.equal(sourceReadAt(first),0);now=5;
 assert.equal(await view.readInsights({level:'campaign'}),first);assert.equal(sourceReadAt(first),0);
 await view.readInsights({level:'adset'});await view.readInsights({level:'ad'});assert.equal(view.cacheStatus().entries,2);
 now=11;assert.notEqual(await view.readInsights({level:'campaign'}),first);assert.equal(calls,4);assert.equal(sourceReadAt(first),0);
});
test('equivalent provider date contracts reuse one GET despite object order and local partial markers',async()=>{
 let reads=0;const r=reportReader({readInsights:async()=>{reads++;return [];}});
 await r.readInsights({since:'2026-10-17',until:'2026-10-23',level:'campaign',partial:false,extended:true});
 await r.readInsights({level:'campaign',until:'2026-10-23',since:'2026-10-17',extended:true,daily:false});assert.equal(reads,1);
 await r.readInsights({since:'2026-10-17',until:'2026-10-23',level:'campaign',extended:true,daily:true});assert.equal(reads,2);
});

test('the optional extended range validator does not duplicate identical short provider requests',async()=>{
 let calls=0;const view=reportReader({readInsights:async()=>{calls++;return [];}});
 await view.readInsights({since:'2026-09-26',until:'2026-10-25',level:'campaign',daily:true,extended:true});await view.readInsights({since:'2026-09-26',until:'2026-10-25',level:'campaign',daily:true,extended:false});assert.equal(calls,1);
 await view.readInsights({since:'2026-08-01',until:'2026-10-25',level:'campaign',daily:true,extended:true});await view.readInsights({since:'2026-08-01',until:'2026-10-25',level:'campaign',daily:true,extended:false});assert.equal(calls,3);
});
