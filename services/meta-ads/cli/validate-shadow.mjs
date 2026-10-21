import {createMetaAdsReadClient} from '../meta-ads-client.mjs';
import {AdsIntelligence} from '../intelligence.mjs';
// Opt-in real GET validation. No Telegram calls, database or provider writer.
if(!process.argv.includes('--real-read-only'))throw Error('EXPLICIT_READ_ONLY_ARGUMENT_REQUIRED');
let requests=0;
const readFetch=(url,options)=>{if(options.method!=='GET'||options.body)throw Error('MUTATION_BLOCKED_BY_HARNESS');requests++;return fetch(url,options);};
const env=process.env,accountId=String(env.META_ADS_AD_ACCOUNT_ID||env.META_AD_ACCOUNT_ID).replace(/^act_/,'');
const reader=createMetaAdsReadClient({accessToken:env.META_ADS_ACCESS_TOKEN||env.META_ACCESS_TOKEN,accountId,apiVersion:env.META_ADS_API_VERSION||env.META_API_VERSION,fetchImpl:readFetch});
const proposals=new Map();
const ledger={byRequest:async k=>[...proposals.values()].find(p=>p.requestKey===k),get:async id=>proposals.get(id),createProposal:async p=>{proposals.set(p.id,p);return p;},claimProposal:async id=>{const p=proposals.get(id);if(p.state!=='PENDING')return false;p.state='RUNNING';return true;},finish:async(id,state)=>{const p=proposals.get(id);p.state=state;return p;},record:async(id,c,result)=>{proposals.get(id).items.find(i=>i.campaignId===c).result=result;},withCampaignLock:async(_,fn)=>fn({unresolved:async()=>false,circuitOpen:async()=>false,record:async(id,c,result)=>ledger.record(id,c,result)})};
const user=String(env.TELEGRAM_ALLOWED_USER_IDS||'').split(',')[0];
const policy={maxBudgetCents:Math.round(Number(env.META_MAX_DAILY_BUDGET_EUR)*100),maxChangePercent:Number(env.META_MAX_BUDGET_CHANGE_PERCENT),minSpend:15,minPurchases:2,minImpressions:500,maxAgeMs:120000};
const engine=new AdsIntelligence({reader,ledger,accountId,allowedActors:[user],policy,mode:'SHADOW'});
try{
 const actor={user,chat:user},p=await engine.propose({actor,requestKey:'validation:mandatory-case',text:'Sube 10 € el presupuesto de todas las campañas activas que tengan un ROAS superior a 5 hoy'});
 const result=await engine.confirm({id:p.id,actor});await engine.confirm({id:p.id,actor});
 const reasons={};for(const i of p.items)for(const r of i.reasons)reasons[r]=(reasons[r]||0)+1;
 const levels={};for(const level of ['campaign','adset','ad']){const s=await engine.snapshot('7d',level);levels[level]={rows:s.facts.length,spend:s.facts.reduce((n,f)=>n+(f.spend||0),0),complete:s.complete};}
 if(Object.values(levels).some(l=>!l.complete||Math.abs(l.spend-levels.campaign.spend)>.005))throw Error('LEVEL_RECONCILIATION_FAILED');
 console.log(JSON.stringify({ok:true,at:new Date().toISOString(),mode:'SHADOW',samplePolicy:'TEST_ONLY_NOT_DEPLOYED',items:p.items.length,reasons,state:result.state,levels,requests,metaWrites:0,telegramSends:0,databaseWrites:0}));
}catch{console.error('SHADOW_READ_VALIDATION_FAILED');process.exitCode=1;}
