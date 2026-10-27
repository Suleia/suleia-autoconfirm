import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMetaSummary,readMetaSummary} from './meta-summary.mjs';
import {CONTRACT} from '../meta-ads/metrics.mjs';
import {formatMetaSummary} from '../../infrastructure/telegram-center/meta-summary.mjs';
const now=Date.parse('2026-10-26T10:00:00Z');
test('relative refresh buttons resolve the new Madrid day; explicit dates remain fixed',async()=>{
 const f=fixture(),next=Date.parse('2026-10-27T23:05:00Z');
 for(const [phrase,from,to] of [['Cómo van las campañas hoy','2026-10-28','2026-10-28'],['Cómo van las campañas ayer','2026-10-27','2026-10-27'],['Cómo van las campañas últimos 7 días','2026-10-22','2026-10-28'],['Cómo van las campañas 2026-10-23','2026-10-23','2026-10-23']]){
  const query=parseMetaSummary(phrase,now),first=await readMetaSummary(f.ads,query,now);
  const button=formatMetaSummary(first).navigation[0];
  await readMetaSummary(f.ads,button.request.query,next);
  assert.equal(f.queries.at(-1).since,from);assert.equal(f.queries.at(-1).until,to);
  assert.equal(f.queries.at(-1).force,true);assert.equal(f.queries.at(-1).interactive,true);
 }
});
const fact=(id,roas,purchases=5)=>({entityId:String(id),name:'Campaña '+id,roas,roasStatus:roas===null?'MISSING':roas===0?'ZERO':'VALID',purchases,spend:20,impressions:1200,delivery:'ACTIVE',budgetCents:2000});
function fixture(rows=[fact(1,12)]){
 const report={account:{id:'act_9',currency:'EUR',timezone:'Europe/Madrid'},contract:CONTRACT,level:'campaign',range:{since:'2026-10-26',until:'2026-10-26'},observedAt:new Date(now).toISOString(),cache:{status:'FRESH'},facts:rows,totals:{spend:rows.length*20},quality:{status:'SOURCE_COMPLETE',missingPurchaseRows:0},inventory:{campaigns:rows.map(f=>({id:f.entityId}))}};
 const guard={reasons:[],recent:{spend:100,purchases:20,impressions:5000,roas:12}},usage={changedCampaignIds:[],increaseCents:0},queries=[];
 const ads={overview:async q=>{queries.push(q);return report;},engine:{accountId:'9',policy:{maxBudgetCents:10000,maxAggregateIncreaseCents:3000},learningAssessment:async()=>guard,propose(){throw Error('Unexpected write');},confirm(){throw Error('Unexpected write');}},ledger:{budgetUsage:async()=>usage}};
 return {report,ads,guard,usage,queries,read:()=>readMetaSummary(ads,{},now)};
}
test('requested phrases default to Madrid today; mutations and detailed reviews keep their routes',()=>{
 for(const t of ['¿Cómo van las campañas?','¿Cómo va Meta hoy?','Dame el gasto y el ROAS.','¿Qué campaña está vendiendo más?','¿Cuál funciona mejor?','¿Qué campaña debería subir o bajar?','Actualiza las campañas.'])assert.equal(parseMetaSummary(t,now).since,'2026-10-26');
 for(const t of ['Sube 10 € a NIDA','Confirma','Analiza campañas NIDA ayer','Detalle de campañas','Auditoría de campañas'])assert.equal(parseMetaSummary(t,now),null);
 assert.equal(parseMetaSummary('Cómo van las campañas ayer',now).until,'2026-10-25');
 assert.equal(parseMetaSummary('Cómo van las campañas últimos 7 días',now).since,'2026-10-20');
 assert.equal(parseMetaSummary('Cómo van las campañas 2026-10-23',now).since,'2026-10-23');
 assert.equal(parseMetaSummary('Cómo van las campañas',Date.parse('2026-10-25T23:30:00Z')).since,'2026-10-26');
 assert.ok(parseMetaSummary('Cómo van las campañas últimas 48 horas',now).question);
});
test('all campaign spend and purchase winner survive pagination; paused campaigns and missing/zero ROAS remain distinct',async()=>{
 const rows=[fact(1,20),fact(2,15),fact(3,10),fact(4,5),fact(5,0,40),fact(6,null,0)];rows[4].delivery='PAUSED';
 const f=fixture(rows),s=await f.read(),first=formatMetaSummary(s),last=formatMetaSummary(s,{page:1});
 assert.equal(f.queries[0].level,'campaign');assert.equal(s.totals.spend,120);assert.equal(s.winners[0].id,'5');
 assert.match(first.text,/120 €/);assert.match(first.text,/Más ventas: Campaña 5/);assert.match(last.text,/Pausada\/no activa/);assert.match(last.text,/ROAS: 0/);assert.match(last.text,/ROAS: N\/D/);
 assert.equal(first.navigation[0].request.query.force,true);assert.equal(first.navigation[1].page,1);assert.equal(first.navigation[0].request.action,'meta-summary');
 assert.ok(first.text.length<4096);assert.doesNotMatch(first.text,/CTR|CPM|CPC|embudo/);
});
test('ties, absent purchases, partial data and unsafe names do not create misleading winners',async()=>{
 const f=fixture([fact(1,12),fact(2,11)]);f.report.facts[0].name='<b>Injected</b>';
 let s=await f.read();assert.equal(s.winners.length,2);assert.match(formatMetaSummary(s).text,/empate/);assert.match(formatMetaSummary(s).text,/&lt;b&gt;/);
 f.report.quality.missingPurchaseRows=1;assert.match(formatMetaSummary(await f.read()).text,/no verificable/);
 f.report.quality.missingPurchaseRows=0;f.report.facts.forEach(x=>x.purchases=0);assert.equal((await f.read()).winners.length,0);
});
test('recommendations require fresh evidence, sample, historical corroboration and unchanged safeguards',async()=>{
 const f=fixture();assert.equal((await f.read()).recommendation.direction,'increase');
 f.report.facts[0].roas=2;f.guard.recent.roas=2;assert.equal((await f.read()).recommendation.direction,'decrease');
 for(const [object,key,value] of [[f.report,'cache',{status:'STALE'}],[f.report,'observedAt','2026-10-25T10:00:00Z'],[f.report,'quality',{status:'PARTIAL'}],[f.report.facts[0],'purchases',4],[f.report.facts[0],'spend',14],[f.report.facts[0],'impressions',999],[f.report.facts[0],'delivery','PAUSED'],[f.guard,'reasons',['LEARNING']],[f.guard,'contextWarnings',['INSUFFICIENT_MULTIDAY_SAMPLE']],[f.guard.recent,'roas',8],[f.usage,'changedCampaignIds',['1']]]){
  const old=object[key];object[key]=value;assert.equal((await f.read()).recommendation.direction,'maintain',key);object[key]=old;
 }
 f.report.range.until='2026-10-25';assert.equal((await f.read()).recommendation.direction,'maintain');
});
test('stale fallback is disclosed and cannot retain an old increase recommendation',async()=>{
 const f=fixture();f.report.cache.status='STALE';const s=await f.read();s.recommendation={direction:'increase',campaign:'BAD'};
 const out=formatMetaSummary(s);assert.match(out.text,/No se pudo actualizar/);assert.doesNotMatch(out.text,/BAD|valorar subir/);assert.match(out.text,/mantener/);
});
test('account and attribution mismatch fail closed; stricter budget limits block increases',async()=>{
 const f=fixture();f.ads.engine.policy.maxBudgetCents=2000;assert.equal((await f.read()).recommendation.direction,'maintain');
 f.ads.engine.policy.maxBudgetCents=10000;f.usage.increaseCents=3000;assert.equal((await f.read()).recommendation.direction,'maintain');
 f.report.account.id='act_10';await assert.rejects(f.read,/CONTRACT_INVALID/);
 f.report.account.id='act_9';f.report.contract='wrong';await assert.rejects(f.read,/CONTRACT_INVALID/);
});
