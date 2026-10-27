import test from 'node:test';import assert from 'node:assert/strict';
import {createGrowthService} from './growth-service.mjs';
import {growthFixtureReport,GROWTH_FIXTURE_NOW} from './growth-fixtures.mjs';
test('slow optional history publishes exact selected summary, no fabricated decision, then finishes one shared job',async()=>{
 let resume,reads=0;const service=createGrowthService({now:()=>GROWTH_FIXTURE_NOW,waitMs:2,report:async q=>{reads++;if(q.since&&q.since<'2026-10-01')await new Promise(r=>resume=r);return growthFixtureReport(q);}});
 const q={period:'7d',level:'campaign',campaignId:'101',analysis:'true'},a=await service.get(q);
 assert.equal(a.progress.pending,true);assert.equal(a.analysis.entity.id,'101');assert.equal(a.analysis.row.spend,196);assert.equal(a.analysis.decision,null);assert.equal(a.metaWrites,0);
 const b=await service.get(q);assert.equal(b.analysis.row.spend,196);assert.equal(reads,2);resume();await service.pending();const c=await service.get(q);assert.equal(c.progress.pending,false);assert.equal(c.analysis.entity.id,'101');assert.ok(c.analysis.children.every(r=>r.campaignId==='101'));
});
test('optional history rate failure preserves selected metrics, marks unavailable and never invents scale eligibility',async()=>{
 const service=createGrowthService({now:()=>GROWTH_FIXTURE_NOW,report:async q=>{if(q.since)throw Object.assign(Error('META_RATE_LIMITED'),{code:'META_RATE_LIMITED'});return growthFixtureReport(q);}});
 const r=await service.get({period:'7d',level:'campaign',campaignId:'101',analysis:'true'});assert.equal(r.analysis.row.spend,196);assert.equal(r.progress.blocks.history,'UNAVAILABLE');assert.ok(!r.analysis.decision?.proposalEligible);assert.equal(r.externalWrites,0);
});

test('a successful historical preview waits for its existing fresh history before caching final decisions',async()=>{
 let histories=0;const service=createGrowthService({now:()=>GROWTH_FIXTURE_NOW,waitMs:2,report:async q=>{const r=growthFixtureReport(q);if(q.since&&histories++===0){r.freshness='STALE';r.diagnostic={state:'PREPARING'};}return r;}});
 await service.get({period:'7d',level:'campaign'});await service.pending();const value=await service.get({period:'7d',level:'campaign'});
 assert.equal(histories,2);assert.equal(value.progress.pending,false);assert.equal(value.progress.blocks.history,'READY');assert.ok(value.decisions.campaigns.some(c=>c.status!=='DATOS_INSUFICIENTES'));assert.equal(value.metaWrites,0);
});

test('a slow successful historical preview is not accepted as final after the old eight-second cut',async()=>{
 let histories=0;const service=createGrowthService({now:()=>GROWTH_FIXTURE_NOW,waitMs:1,report:async q=>{const r=growthFixtureReport(q);if(q.since&&histories++<8){r.freshness='STALE';r.diagnostic={state:'PREPARING'};}return r;}});
 await service.get({period:'7d',level:'campaign'});await service.pending();const value=await service.get({period:'7d',level:'campaign'});assert.equal(histories,9);assert.equal(value.progress.pending,false);assert.ok(value.decisions.campaigns.some(c=>c.status!=='DATOS_INSUFICIENTES'));assert.equal(value.failures.length,0);
});
