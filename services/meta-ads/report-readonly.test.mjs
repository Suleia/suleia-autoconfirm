import test from 'node:test';import assert from 'node:assert/strict';
import {createAdsRuntime} from './runtime.mjs';import {adsCommand} from './command-service.mjs';
test('read-only deployment works on default_transaction_read_only without any SQL mutation',async()=>{
 const sql=[],http=[];const pool={query:async q=>{sql.push(q);assert.match(q,/^SELECT /);return {rows:[]};}};
 const fetchImpl=async(url,options)=>{http.push(options.method);assert.equal(options.method,'GET');const u=new URL(url);return new Response(JSON.stringify(u.pathname.endsWith('/act_9')?{id:'act_9',account_status:1,currency:'EUR',timezone_name:'Europe/Madrid'}:{data:[]}));};
 const r=createAdsRuntime({pool,fetchImpl,env:{ADS_INTELLIGENCE_READ_ENABLED:'true',ADS_REPORT_READ_ONLY:'true',META_ACCESS_TOKEN:'fixture-token',META_AD_ACCOUNT_ID:'9',TELEGRAM_ALLOWED_USER_IDS:'1',META_MAX_DAILY_BUDGET_EUR:'100',META_MAX_BUDGET_CHANGE_PERCENT:'10'}});
 const report=await r.overview({period:'hoy'});assert.equal(report.reportReadOnly,true);assert.equal(report.totals.spend,null);assert.ok(http.length>0);assert.ok(sql.length>0);
 for(const name of ['createProposal','claimProposal','finish','cancel','persistFacts','persistDailySnapshot','saveRecommendation','reviewRecommendation','appendAlgorithmJournal','claimDigest','record','withCampaignLock'])await assert.rejects(r.ledger[name](),/ADS_REPORT_READ_ONLY/);
 const result=await adsCommand(r,{action:'request',actor:{user:'1',chat:'1'},text:'Sube 10 € a NIDA',requestKey:'test'});assert.match(result.text,/modo consulta/);assert.equal(sql.filter(s=>!s.startsWith('SELECT')).length,0);
});
