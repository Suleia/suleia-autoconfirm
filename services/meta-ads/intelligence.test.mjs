import test from 'node:test';
import assert from 'node:assert/strict';

test('single-campaign recommendation retains its ROAS guard instead of expanding scope',()=>{
 const intent=parseAdsIntent('Sube 10 % el presupuesto de 123 con ROAS superior a 10 hoy');
 assert.equal(intent.selector,'123');assert.equal(intent.filter.threshold,10);assert.equal(intent.period,'hoy');
 assert.equal(parseAdsIntent('Sube 10 % el presupuesto de 123 y 456 con ROAS superior a 10 hoy').kind,'clarify');
});
import { AdsIntelligence } from './intelligence.mjs';
import { normalizeInsight,windowFor,CONTRACT } from './metrics.mjs';
import { parseAdsIntent,budgetAfter } from './intent.mjs';
import { syncAds } from './sync.mjs';
import { diagnose } from './diagnostics.mjs';
import {createMetaAdsReadClient} from './meta-ads-client.mjs';
import {readLegacyInsights} from './compat.mjs';
import {adsCommand} from './command-service.mjs';

export class MemoryLedger {
  constructor(){this.p=new Map();this.ops=new Map();this.locks=new Set();this.circuit=0;this.facts=new Map();}
  async byRequest(k){return [...this.p.values()].find(p=>p.requestKey===k)||null;}
  async createProposal(p){const existing=await this.byRequest(p.requestKey);if(existing)return existing;this.p.set(p.id,p);return this.get(p.id);}
  async get(id){const p=this.p.get(id);return p?{...p,items:p.items.map(i=>({...i,result:this.ops.get(id+':'+i.campaignId)||null}))}:null;}
  async claimProposal(id){const p=this.p.get(id);if(p.state!=='PENDING')return false;p.state='RUNNING';return true;}
  async finish(id,state){this.p.get(id).state=state;return this.get(id);}
  async cancel(id){if(this.p.get(id).state==='PENDING')return this.finish(id,'CANCELLED');return this.get(id);}
  async history(){return Promise.all([...this.p.keys()].map(id=>this.get(id)));}
  async pendingForActor(user){return (await this.history()).filter(p=>p.state==='PENDING'&&p.actor.user===user).slice(0,2);}
  async record(id,campaign,result){this.ops.set(id+':'+campaign,result);}
  async withAccountBudgetLock(key,fn){if(this.locks.has('account:'+key))throw Error('ACCOUNT_BUDGET_BUSY');this.locks.add('account:'+key);try{return await fn();}finally{this.locks.delete('account:'+key);}}
  async budgetUsage(account,now,cooldown=86400000){let increaseCents=0;const changedCampaignIds=[];for(const [key,op]of this.ops){if(!['VERIFIED','RECONCILED','UNKNOWN','EXECUTING'].includes(op.state))continue;const [id,campaign]=key.split(':'),p=this.p.get(id),item=p.items.find(i=>i.campaignId===campaign);const at=op.verifiedAt||p.createdAt;if(now-at<cooldown)changedCampaignIds.push(campaign);if(new Date(at).toISOString().slice(0,10)===new Date(now).toISOString().slice(0,10))increaseCents+=Math.max(0,item.after-item.before);}return {increaseCents,changedCampaignIds};}
  async persistFacts(facts){for(const f of facts)this.facts.set([f.accountId,f.level,f.entityId,f.since,f.until,f.contract].join(':'),f);}
  async withCampaignLock(key,fn){if(this.locks.has(key))throw Error('CAMPAIGN_BUSY');this.locks.add(key);try{return await fn({
    unresolved:async(_,campaign)=>[...this.ops].some(([k,v])=>k.endsWith(':'+campaign)&&['EXECUTING','UNKNOWN'].includes(v.state)),
    operation:async(id,c)=>this.ops.get(id+':'+c),claimOperation:async(id,c)=>{if(this.ops.has(id+':'+c))return false;this.ops.set(id+':'+c,{state:'EXECUTING'});return true;},
    record:(id,c,r)=>this.record(id,c,r),circuitOpen:async(_,now)=>now<this.circuit,openCircuit:async(_,until)=>{this.circuit=until;}
  });}finally{this.locks.delete(key);}}
}
const request='Sube 10 € el presupuesto de todas las campañas activas que tengan un ROAS superior a 5 hoy';
const actor={user:'1',chat:'1'};
function fixture(options={}){
  let now=Date.parse('2026-10-21T08:00:00Z'),writes=0;
  const campaigns=[{id:'11',account_id:'9',name:'Fixture campaign',status:'ACTIVE',effective_status:'ACTIVE',daily_budget:'10000'}];
  const rows=[{campaign_id:'11',campaign_name:'Fixture campaign',date_start:'2026-10-21',date_stop:'2026-10-21',spend:'20',impressions:'2000',actions:[{action_type:'purchase',value:'3'}],action_values:[{action_type:'purchase',value:'120'}]}];
  const rules=[];
  const reader={readAccount:async()=>({id:'act_9',currency:'EUR',timezone_name:'Europe/Madrid',account_status:1}),readCampaigns:async()=>campaigns,readDelivery:async()=>campaigns.map(c=>({campaign_id:c.id,status:'ACTIVE',effective_status:'ACTIVE'})),readRules:async()=>rules,readInsights:async()=>rows,readCampaign:async(id)=>campaigns.find(c=>c.id===id)};
  reader.readEntities=async()=>campaigns;
  const writer={setDailyBudget:async(id,cents)=>{writes++;campaigns.find(c=>c.id===id).daily_budget=String(cents);return {success:true};}};
  const ledger=new MemoryLedger();
  const policy={maxBudgetCents:20000,maxChangePercent:20,minSpend:15,minPurchases:2,minImpressions:500,maxAgeMs:120000,liveCampaignIds:['11','12'],maxAggregateIncreaseCents:3000,campaignCooldownMs:86400000};
  const engine=new AdsIntelligence({reader,ledger,policy,allowedActors:['1'],accountId:'9',now:()=>now,...options,writer});
  return {engine,reader,ledger,policy,campaigns,rows,rules,writes:()=>writes,setNow:n=>{now=n;},propose:(text=request,key='telegram:1')=>engine.propose({actor,requestKey:key,text})};
}
test('Spanish mandatory request preserves absolute EUR delta, strict filter and today',()=>{
  assert.deepEqual(parseAdsIntent(request),{kind:'budget',mode:'increase',value:'10',unit:'money',selector:'ALL_ACTIVE',period:'hoy',filter:{operator:'gt',threshold:5}});
  assert.equal(parseAdsIntent('Baja 5 € a las campañas con ROAS inferior a 2').period,'hoy');
  assert.equal(parseAdsIntent('Aumenta un 15 % las campañas rentables').kind,'clarify');
  assert.equal(parseAdsIntent('Sube 10 € a NIDA').selector,'nida');
  assert.equal(parseAdsIntent('Pon el presupuesto de CollaGum a 50 €').mode,'set');
  assert.equal(parseAdsIntent('Sube NIDA a 50 €').mode,'set');
  assert.equal(parseAdsIntent('Analiza todos los conjuntos de anuncios de Seoul 1988 hoy').level,'adset');
  assert.equal(budgetAfter(3333,{mode:'increase',value:'15',unit:'percent'}),3833);
  assert.equal(budgetAfter(5000,{mode:'set',value:'50.01',unit:'money'}),5001);
});
test('canonical insight requests fix attribution, conversion date and link metrics with GET only',async()=>{
 const calls=[];const reader=createMetaAdsReadClient({accessToken:'fixture-token',accountId:'9',apiVersion:'v25.0',fetchImpl:async(url,options)=>{calls.push({url:new URL(url),options});return new Response(JSON.stringify({data:[]}),{status:200});}});
 await reader.readInsights({since:'2026-10-14',until:'2026-10-20',level:'ad'});
 const {url,options}=calls[0];assert.equal(options.method,'GET');assert.equal(url.searchParams.get('action_report_time'),'conversion');assert.deepEqual(JSON.parse(url.searchParams.get('action_attribution_windows')),['7d_click','1d_view']);assert.equal(url.searchParams.has('use_account_attribution_setting'),false);assert.equal(url.searchParams.has('access_token'),false);assert.match(url.searchParams.get('fields'),/cost_per_inline_link_click/);
});
test('Render compatibility chunks daily history and refuses absent spend instead of zero',async()=>{
 const calls=[],reader={readInsights:async query=>{calls.push(query);return [{campaign_id:'11',date_start:query.since,date_stop:query.since,spend:'1'}];}};
 const rows=await readLegacyInsights(reader,{since:'2026-09-01',until:'2026-10-20',timeIncrement:1});assert.equal(calls.length,2);assert.equal(calls[1].since,'2026-10-02');assert.equal(rows[0].spend,1);assert.equal(rows[0].roas,null);
 await assert.rejects(readLegacyInsights({readInsights:async()=>[{campaign_id:'11',spend:null}]},{since:'2026-10-20',until:'2026-10-20'}),/SPEND_UNAVAILABLE/);
});
test('purchase aliases are selected, never added; provider ratios are not trusted',()=>{
  const row={spend:'20',actions:[{action_type:'purchase',value:'2'},{action_type:'omni_purchase',value:'2'}],action_values:[{action_type:'purchase',value:'120'},{action_type:'omni_purchase',value:'120'}],purchase_roas:[{action_type:'purchase',value:'999'}]};
  const n=normalizeInsight(row,{});assert.equal(n.purchases,2);assert.equal(n.roas,6);
  row.actions.push({action_type:'omni_purchase',value:'3'});assert.equal(normalizeInsight(row,{}).roasStatus,'AMBIGUOUS');
  assert.equal(normalizeInsight({spend:'0',actions:[{action_type:'purchase',value:'0'}],action_values:[{action_type:'purchase',value:'0'}]},{}).roasStatus,'ZERO_SPEND');
  assert.equal(normalizeInsight({},{}).spend,null);
});
test('ROAS >5 is eligible; confirmation simulates once with zero mutator calls',async()=>{
  const f=fixture(),p=await f.propose();assert.deepEqual(p.items[0].reasons,[]);assert.equal(p.items[0].after,11000);
  const a=await f.engine.confirm({id:p.id,actor});assert.equal(a.items[0].result.state,'SIMULATED');
  await f.engine.confirm({id:p.id,actor});assert.equal(f.writes(),0);
});
for(const [name,setup,reason] of [
  ['ROAS exactly 5',f=>f.rows[0].action_values[0].value='100','ROAS_FILTER_NOT_MET'],
  ['ROAS missing',f=>delete f.rows[0].action_values,'ROAS_MISSING'],
  ['ROAS ambiguous',f=>f.rows[0].action_values.push({action_type:'purchase',value:'121'}),'ROAS_AMBIGUOUS'],
  ['zero spend',f=>f.rows[0].spend='0','ROAS_ZERO_SPEND'],
  ['insufficient purchases',f=>f.rows[0].actions[0].value='1','INSUFFICIENT_SAMPLE'],
  ['ABO campaign',f=>delete f.campaigns[0].daily_budget,'CAMPAIGN_DAILY_BUDGET_REQUIRED'],
  ['maximum budget',f=>f.policy.maxBudgetCents=10000,'MAX_BUDGET'],
  ['automatic rule conflict',f=>f.rules.push({status:'ENABLED'}),'AUTOMATION_CONFLICT'],
  ['sample policy absent',f=>f.policy.minSpend=null,'SAMPLE_POLICY_NOT_CONFIGURED'],
])test(name+' blocks a proposal item without mutation',async()=>{const f=fixture();setup(f);const p=await f.propose();assert.ok(p.items[0].reasons.includes(reason));await f.engine.confirm({id:p.id,actor});assert.equal(f.writes(),0);});
test('all-active filter excludes inactive campaigns; explicit inactive target is blocked',async()=>{const f=fixture();f.campaigns[0].effective_status='PAUSED';assert.equal((await f.propose()).items.length,0);const p=await f.propose('Sube 10 € a 11','telegram:2');assert.ok(p.items[0].reasons.includes('CAMPAIGN_INACTIVE'));});
test('actual approved limits 100 EUR and 10 percent cannot allow +10 EUR',async()=>{const f=fixture();f.policy.maxBudgetCents=10000;f.policy.maxChangePercent=10;for(const old of [1000,5000,9000,10000]){f.campaigns[0].daily_budget=String(old);assert.ok((await f.propose(request,'telegram:'+old)).items[0].reasons.length);}});
test('duplicate request survives delivery replay and conflicts reject changed payload',async()=>{const f=fixture();const p=await f.propose();assert.equal((await f.propose()).id,p.id);await assert.rejects(f.propose(request+' extra'),/IDEMPOTENCY_PAYLOAD_CONFLICT/);});
test('confirmation expiry, actor identity, changed budget and changed metrics are fail closed',async()=>{
  const f=fixture(),p=await f.propose();await assert.rejects(f.engine.confirm({id:p.id,actor:{user:'2',chat:'2'}}),/UNAUTHORIZED/);
  f.campaigns[0].daily_budget='10001';assert.equal((await f.engine.confirm({id:p.id,actor})).items[0].result.state,'STALE');
  const g=fixture(),q=await g.propose();g.setNow(q.expiresAt);assert.equal((await g.engine.confirm({id:q.id,actor})).state,'EXPIRED');
  const h=fixture(),r=await h.propose();h.rows[0].spend='19';assert.equal((await h.engine.confirm({id:r.id,actor})).items[0].result.state,'STALE');
});
test('concurrent confirmation has one durable claim and SHADOW never mutates',async()=>{
  const f=fixture({mode:'SHADOW'}),p=await f.propose();await Promise.all([f.engine.confirm({id:p.id,actor}),f.engine.confirm({id:p.id,actor})]);assert.equal(f.ledger.ops.size,1);assert.equal(f.writes(),0);
});
test('natural confirmation is actor-bound and requires one unique pending proposal',async()=>{const f=fixture(),runtime={engine:f.engine,ledger:f.ledger};await f.propose(request,'telegram:1');const q=await f.propose(request,'telegram:2');assert.equal((await adsCommand(runtime,{action:'request',actor,text:'Sí, hazlo'})).proposal.state,'CLARIFICATION');await f.engine.cancel({id:q.id,actor});const result=await adsCommand(runtime,{action:'request',actor,text:'Sí, hazlo'});assert.equal(result.proposal.state,'SIMULATED');assert.equal(f.writes(),0);});
test('LIVE factory gate is closed; a SIMULATION proposal cannot become LIVE',async()=>{
  const f=fixture({mode:'LIVE',liveCompiled:false}),p=await f.propose();await assert.rejects(f.engine.confirm({id:p.id,actor}),/LIVE_NOT_AUTHORIZED/);assert.equal(f.writes(),0);
  const g=fixture(),q=await g.propose();g.engine.mode='LIVE';assert.equal((await g.engine.confirm({id:q.id,actor})).state,'STALE_POLICY_OR_MODE');
});
test('executor harness verifies partial results, opens circuit, and never retries unknown mutation',async()=>{
  // A test-only injection exercises future LIVE transitions. Production runtime
  // cannot supply this gate and has no writer.
  const f=fixture({mode:'LIVE',liveCompiled:true});
  f.campaigns.push({...f.campaigns[0],id:'12'});f.rows.push({...f.rows[0],campaign_id:'12'});
  let calls=0;f.engine.writer={setDailyBudget:async()=>{calls++;throw Error('timeout');}};
  const p=await f.propose();const result=await f.engine.confirm({id:p.id,actor});
  assert.equal(result.items[0].result.state,'UNKNOWN');assert.equal(result.items[1].result.state,'BLOCKED');
  await f.engine.confirm({id:p.id,actor});assert.equal(calls,1);
  f.campaigns[0].daily_budget='11000';await f.engine.reconcile({id:p.id,actor});assert.equal((await f.ledger.get(p.id)).items[0].result.state,'RECONCILED');assert.equal(calls,1);
});
test('future executor harness verifies success with one absolute budget assignment',async()=>{const f=fixture({mode:'LIVE',liveCompiled:true}),p=await f.propose();const r=await f.engine.confirm({id:p.id,actor});assert.equal(r.items[0].result.state,'VERIFIED');assert.equal(f.writes(),1);await f.engine.confirm({id:p.id,actor});assert.equal(f.writes(),1);});
test('approved account accumulation and cooldown are enforced at proposal and confirmation',async()=>{
 const f=fixture({mode:'LIVE'});f.policy.maxAggregateIncreaseCents=500;
 const over=await f.propose();assert.ok(over.items[0].reasons.includes('AGGREGATE_DAILY_LIMIT'));await f.engine.confirm({id:over.id,actor});assert.equal(f.writes(),0);
 const g=fixture({mode:'LIVE'}),first=await g.propose();await g.engine.confirm({id:first.id,actor});
 const repeat=await g.propose('Sube 5 € a 11','telegram:2');assert.ok(repeat.items[0].reasons.includes('CAMPAIGN_COOLDOWN'));await g.engine.confirm({id:repeat.id,actor});assert.equal(g.writes(),1);
 const h=fixture({mode:'LIVE'}),pending=await h.propose();h.ledger.budgetUsage=async()=>({increaseCents:2900,changedCampaignIds:[]});const result=await h.engine.confirm({id:pending.id,actor});assert.ok(result.items[0].result.reasons.includes('AGGREGATE_DAILY_LIMIT'));assert.equal(h.writes(),0);
});
test('two different confirmations cannot bypass account-wide serialization',async()=>{
 const f=fixture({mode:'LIVE'}),a=await f.propose(),b=await f.propose('Sube 5 € a 11','telegram:second');
 const results=await Promise.allSettled([f.engine.confirm({id:a.id,actor}),f.engine.confirm({id:b.id,actor})]);
 assert.equal(f.writes(),1);assert.ok(results.some(r=>r.status==='rejected'&&r.reason.message==='ACCOUNT_BUDGET_BUSY'));
});
test('future executor distinguishes confirmed rejection from a request never sent',async()=>{
 for(const [flag,state]of [['definitiveRejection','FAILED'],['notSent','STALE']]){const f=fixture({mode:'LIVE',liveCompiled:true});f.engine.writer={setDailyBudget:async()=>{throw Object.assign(Error('sanitized'),{[flag]:true,status:400});}};const p=await f.propose(),r=await f.engine.confirm({id:p.id,actor});assert.equal(r.items[0].result.state,state);}
});
test('expired token fails a read without any mutation or persisted proposal',async()=>{const f=fixture();f.reader.readAccount=async()=>{throw Error('META_HTTP_401');};await assert.rejects(f.propose(),/401/);assert.equal(f.writes(),0);assert.equal(f.ledger.p.size,0);});
test('Madrid midnight and daylight-saving calendar windows',()=>{
  assert.equal(windowFor('hoy',Date.parse('2026-10-24T22:30:00Z')).since,'2026-10-25');
  assert.equal(windowFor('hoy',Date.parse('2026-10-25T23:30:00Z')).since,'2026-10-26');
  assert.deepEqual(windowFor('3d',Date.parse('2026-10-26T08:00:00Z')),{since:'2026-10-23',until:'2026-10-25',partial:false});
});
test('daily sync is idempotent and requires daily identities',async()=>{
  const f=fixture(),args={reader:f.reader,ledger:f.ledger,accountId:'9',since:'2026-10-21',until:'2026-10-21',now:()=>Date.parse('2026-10-21T08:00:00Z')};
  f.reader.readInsights=async({level})=>f.rows.map(r=>({...r,[level+'_id']:'11'}));await syncAds(args);await syncAds(args);assert.equal(f.ledger.facts.size,3);assert.equal(f.writes(),0);
});
test('analysis includes inventory entities without insight rows as missing, never zero',async()=>{const f=fixture();f.campaigns.push({...f.campaigns[0],id:'12',name:'No row fixture'});const result=await f.engine.analyze({period:'hoy'});const absent=result.facts.find(x=>x.entityId==='12');assert.equal(absent.spend,null);assert.equal(absent.source,'META_NO_INSIGHT_ROW');});
test('diagnosis abstains without sample policy and never invents profit',()=>{
  const m=normalizeInsight({spend:'20',impressions:'2000'}, {complete:true,contract:CONTRACT});assert.equal(diagnose(m,null,{})[0].code,'INSUFFICIENT_SAMPLE');
});
test('fatigue needs multiple same-entity signals; one high frequency is insufficient',()=>{
 const base={spend:20,purchases:3,impressions:2000,complete:true,contract:CONTRACT,roasStatus:'VALID',linkCtr:2,linkCpc:.5,cpm:10,frequency:2,cpa:6,roas:6,funnel:{}};
 const policy={minSpend:15,minPurchases:2,minImpressions:500};
 assert.ok(!diagnose({...base,frequency:4},base,policy).some(d=>d.code==='POSSIBLE_FATIGUE'));
 assert.ok(diagnose({...base,frequency:4,linkCtr:1,cpa:9},base,policy).some(d=>d.code==='POSSIBLE_FATIGUE'));
});
test('many checkout events and zero observed purchases can diagnose a funnel failure',()=>{
 const base={spend:100,purchases:10,impressions:10000,complete:true,contract:CONTRACT,roasStatus:'VALID',initiateCheckout:20,funnel:{checkoutToPurchase:.5}};
 const current={...base,purchases:0,roasStatus:'ZERO',funnel:{checkoutToPurchase:0}};
 assert.ok(diagnose(current,base,{minSpend:15,minPurchases:2,minImpressions:500,minFunnelEvents:10}).some(d=>d.code==='PURCHASE_DROP'));
});
