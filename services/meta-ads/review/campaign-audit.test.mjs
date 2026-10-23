import test from 'node:test';
import assert from 'node:assert/strict';
import {createReviewService} from './service.mjs';
import {fixtureDataset,FIXTURE_NOW,fixtureExtras} from './fixtures.mjs';
import {parseReviewQuestion,formatReview} from './queries.mjs';
function fixture(){const dataset=fixtureDataset(3);let reads=0;const service=createReviewService({snapshot:async()=>{reads++;return {dataset};},extras:async()=>fixtureExtras(dataset),ledger:{autopilotAudit:async()=>({entries:[],nextCursor:null})},now:()=>FIXTURE_NOW});return {service,dataset,reads:()=>reads};}
test('one campaign audit contains only its ads, funnel and math and uses one canonical snapshot',async()=>{
 const f=fixture(),r=await f.service.report({period:'7d',campaignId:'10002',audit:'true'});assert.equal(r.campaignAudit.campaignId,'10002');assert.equal(r.campaignAudit.ads.length,1);assert.equal(r.campaignAudit.ads[0].campaignId,'10002');assert.equal(f.reads(),1);assert.equal(r.campaignAudit.externalWrites,0);assert.equal(r.campaignAudit.funnel.stages.at(-1).value,r.rows[0].purchases);assert.equal(r.totals.reach,5000);
});
test('reach and frequency are never summed across campaigns; campaign without insights remains auditable and unknown',async()=>{
 const f=fixture();let r=await f.service.report({period:'7d'});assert.equal(r.totals.reach,null);assert.equal(r.totals.frequency,null);
 f.dataset.current.campaign=[];r=await f.service.report({campaignId:'10001',audit:'true'});assert.equal(r.campaignAudit.campaignId,'10001');assert.equal(r.campaignAudit.classification,'DATOS_INSUFICIENTES');assert.equal(r.rows[0].purchases,null);assert.equal(r.totals.spend,null);
});
test('stale data suppresses recommendations and scaling classification, preserving historical identity',async()=>{
 const f=fixture();f.dataset.observedAt=new Date(FIXTURE_NOW-121000).toISOString();const r=await f.service.report({campaignId:'10001',audit:'true'});assert.equal(r.freshness,'STALE');assert.equal(r.campaignAudit.classification,'DATOS_INSUFICIENTES');assert.equal(r.campaignAudit.recommendations.length,0);
});
test('Telegram explanation is built from the same campaign audit and refuses ambiguous names',async()=>{
 const f=fixture();f.dataset.entities.campaign[0].name='NIDA';const r=await f.service.answer('Analiza la campaña NIDA');assert.equal(r.review.campaignAudit.campaignId,'10001');assert.match(r.text,/Campaña 10001/);assert.equal(r.externalWrites,0);
 f.dataset.entities.campaign[1].name='NIDA segunda';assert.match((await f.service.answer('Analiza la campaña NIDA')).text,/único ID/);
});
test('V7 requested natural questions stay read-only; budget commands keep their established executor',()=>{
 for(const q of ['¿Qué anuncios tienen mejor CPA?','¿Qué anuncio está gastando más sin vender?','¿Por qué ha caído el ROAS?','¿Dónde estamos perdiendo clientes?','¿Qué tres acciones recomiendas hoy?','¿Cuál de las campañas activas reducirías?'])assert.ok(parseReviewQuestion(q),q);
 for(const q of ['Sube 10 € el presupuesto de NIDA','Pausa la campaña NIDA','/confirmar abc'])assert.equal(parseReviewQuestion(q),null);
});
test('optional evidence timeout does not turn valid canonical data into a false total failure',async()=>{
 const dataset=fixtureDataset(1),service=createReviewService({snapshot:async()=>({dataset}),extras:()=>new Promise(()=>{}),ledger:{},optionalWaitMs:1,now:()=>FIXTURE_NOW});const r=await service.report({period:'7d'});assert.equal(r.totals.spend,100);assert.ok(r.warnings.includes('META_OPTIONAL_EVIDENCE_PREPARING'));
});
test('explicit Telegram campaign ID uses the same detailed audit and cannot change its scope',async()=>{
 const f=fixture(),r=await f.service.answer('Analiza la campaña 10001');assert.equal(r.review.campaignAudit.campaignId,'10001');assert.ok(r.review.campaignAudit.ads.every(a=>a.campaignId==='10001'));
});
test('same-hour traffic in a campaign audit excludes every other campaign',async()=>{
 const dataset=fixtureDataset(2),day='2026-10-21',hour=12;dataset.range={since:day,until:day,partial:true};dataset.current.campaign.forEach(f=>{f.since=day;f.until=day;});
 const hourly=[];for(const campaign_id of ['10001','10002'])for(const date_start of [day,'2026-10-20'])for(let h=0;h<hour;h++)hourly.push({campaign_id,date_start,hourly_stats_aggregated_by_advertiser_time_zone:`${String(h).padStart(2,'0')}:00:00 - ${String(h).padStart(2,'0')}:59:59`,spend:campaign_id==='10001'?'1':'1000',impressions:'100',inline_link_clicks:'5'});
 const service=createReviewService({snapshot:async()=>({dataset}),extras:async()=>({...fixtureExtras(dataset),hourly}),ledger:{},now:()=>FIXTURE_NOW});const r=await service.report({period:'hoy',campaignId:'10001',audit:'true'});assert.equal(r.hourly.status,'AVAILABLE_TRAFFIC_ONLY');assert.equal(r.hourly.current.spend,12);assert.equal(r.hourly.purchaseComparison,'UNAVAILABLE');
});
