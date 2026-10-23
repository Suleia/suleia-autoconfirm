import test from 'node:test';
import assert from 'node:assert/strict';
import {buildExecutive,escapeHTML,contentHash} from './report.mjs';
import {analyzeReview} from '../review/analyze.mjs';
import {fixtureDataset,fixtureExtras,FIXTURE_NOW} from '../review/fixtures.mjs';
function reports(patch=()=>{}){
 const d=fixtureDataset(3);patch(d);
 const week=analyzeReview({dataset:d,extras:fixtureExtras(d),now:FIXTURE_NOW});
 const ads=analyzeReview({dataset:d,extras:fixtureExtras(d),query:{level:'ad'},now:FIXTURE_NOW});
 return {today:week,week,month:week,ads,targetDate:'2026-10-21',generatedAt:new Date(FIXTURE_NOW).toISOString(),panelUrl:'https://panel.example/operations/',budget:{mode:'LIVE',enabled:true,verifiedChanges:0,blockedCampaigns:2,limits:[],pendingApprovals:0}};
}
test('complete report preserves canonical totals, all ten blocks and exact evidence/Telegram content hashes',()=>{
 const input=reports(),r=buildExecutive(input),text=r.messages.map(m=>m.text).join('\n');
 assert.equal(r.dataState,'UPDATED');assert.deepEqual(r.evidence.week,input.week);assert.equal(r.messages.length,4);
 for(let n=1;n<=10;n++)assert.match(text,new RegExp(n+' · '));
 assert.equal(r.externalWrites,0);assert.equal(r.metaWrites,0);assert.equal(r.evidence.today.totals.spend,300);
 for(const m of r.messages){assert.equal(contentHash(m.text),m.hash);assert.ok(m.text.length<=3950);}
 assert.equal(r.messages.at(-1).markup.inline_keyboard.length,5);
});
for(const scenario of ['partial','zero purchases','missing ROAS','ambiguous attribution','inactive','many purchases','stale','Shopify unavailable'])test('report safely handles '+scenario,()=>{
 const input=reports(d=>{
  if(scenario==='partial')d.range.partial=true;
  if(scenario==='stale')d.readFailed=true;
  for(const level of ['campaign','adset','ad'])for(const r of d.current[level]){
   if(scenario==='zero purchases')Object.assign(r,{purchases:0,purchaseValue:0,cpa:null,roas:0});
   if(scenario==='missing ROAS')Object.assign(r,{roas:null,purchaseValue:null,purchases:null});
   if(scenario==='ambiguous attribution')Object.assign(r,{roas:null,roasStatus:'AMBIGUOUS',purchases:null,purchaseValue:null,quality:{purchase:'AMBIGUOUS'}});
   if(scenario==='many purchases')Object.assign(r,{purchases:100,purchaseValue:5000,roas:50,cpa:1});
  }
  if(scenario==='inactive')for(const level of ['campaign','adset','ad'])d.entities[level].forEach(r=>r.effective_status='PAUSED');
 });
 const r=buildExecutive(input);assert.equal(r.metaWrites,0);assert.ok(!JSON.stringify(r).includes('NaN'));
 if(scenario==='stale'){assert.equal(r.dataState,'INSUFFICIENT');assert.deepEqual(r.priorities,[]);assert.deepEqual(r.topAds,[]);}
 if(['zero purchases','missing ROAS','ambiguous attribution'].includes(scenario))assert.deepEqual(r.topAds,[]);
 if(scenario==='Shopify unavailable')assert.match(r.messages.map(m=>m.text).join('\n'),/beneficio por campaña desconocido/);
});
test('missing Meta sends clearly incomplete notice, never apparently current old figures',()=>{
 const r=buildExecutive({targetDate:'2026-10-21',generatedAt:new Date(FIXTURE_NOW).toISOString(),failures:['META_UNAVAILABLE']});
 assert.equal(r.dataState,'INSUFFICIENT');assert.deepEqual(r.priorities,[]);assert.match(r.messages[0].text,/No son cifras actuales/);
});
test('daily/weekly/monthly comparisons retain contracts and do not invent same-hour purchases',()=>{
 const input=reports(),r=buildExecutive(input),text=r.messages[0].text;
 assert.match(text,/Ayer a las 22:30: N\/D/);assert.match(text,/7 días anteriores/);assert.match(text,/30 días completos/);assert.match(text,/Variación semanal/);
 assert.equal(r.evidence.week.contract,input.week.contract);assert.equal(r.cut.exact,false);
});
for(const [code,alter]of [['CTR_DECLINE',r=>r.linkCtr=0.3],['CPC_INCREASE',r=>r.linkCpc=3],['CART_DROP',r=>r.addToCart=3],['MEASUREMENT_BLOCKED',r=>{r.initiateCheckout=0;}]])test('shared review diagnosis '+code+' appears with numeric evidence and alternatives',()=>{
 const input=reports(d=>{for(const r of d.current.campaign)alter(r);}),r=buildExecutive(input);
 assert.ok(r.evidence.week.recommendations.some(r=>r.code===code));assert.ok(r.priorities.every(p=>p.evidence&&p.alternatives&&p.risk));
});
test('isolated purchase is never a top ad; ranks use same existing review engine',()=>{
 const r=buildExecutive(reports(d=>d.current.ad.forEach(r=>r.purchases=1)));assert.deepEqual(r.topAds,[]);
 const strong=buildExecutive(reports());assert.equal(strong.topAds.length,3);assert.ok(strong.topAds.every(id=>strong.evidence.ads.rankings.some(g=>g.best.some(r=>r.entityId===id))));
});
test('HTML names and long material never create executable tags or oversized reports; all blocks remain',()=>{
 const input=reports(d=>{for(const level of ['campaign','adset','ad'])d.current[level].forEach(r=>{r.name='<script>&"'.repeat(200);r.linkCtr=.1;r.linkCpc=10;r.roas=.1;});});
 const r=buildExecutive(input),text=r.messages.map(m=>m.text).join('\n');assert.ok(!text.includes('<script>'));assert.match(text,/&lt;script&gt;/);
 assert.ok(r.messages.every(m=>m.text.length<=3950));for(let n=1;n<=10;n++)assert.match(text,new RegExp(n+' · '));assert.equal(escapeHTML('<&'), '&lt;&amp;');
});
test('authenticated navigation links are token-free; insecure URLs fail closed; model absent cannot block report',()=>{
 const input=reports(),r=buildExecutive(input);for(const row of r.messages.at(-1).markup.inline_keyboard){const u=new URL(row[0].url);assert.equal(u.protocol,'https:');assert.equal(u.search,'');assert.ok(u.hash.startsWith('#ads?'));}
 assert.throws(()=>buildExecutive({...input,panelUrl:'https://user:secret@example.com/'}),/URL_INVALID/);
 assert.equal(r.version,'suleia-executive-v8.0');assert.match(r.messages.at(-1).text,/Sin modelo externo/);
});
test('six long named top/problem entities fit four accessible messages without dropping any required block',()=>{
 const d=fixtureDataset(6);for(const level of ['campaign','adset','ad'])d.current[level].forEach((r,i)=>{r.name='<&"'.repeat(100);if(i>=3){r.linkCtr=.1;r.linkCpc=10;r.roas=.1;}});
 const week=analyzeReview({dataset:d,extras:fixtureExtras(d),now:FIXTURE_NOW}),ads=analyzeReview({dataset:d,extras:fixtureExtras(d),now:FIXTURE_NOW,query:{level:'ad'}});
 const r=buildExecutive({...reports(),week,month:week,ads}),text=r.messages.map(m=>m.text).join('\n');
 assert.equal(r.topCampaigns.length,3);assert.equal(r.problemCampaigns.length,3);assert.equal(r.topAds.length,3);assert.equal(r.problemAds.length,3);assert.ok(r.messages.every(m=>m.text.length<=3950));for(let n=1;n<=10;n++)assert.match(text,new RegExp(n+' · '));
});
