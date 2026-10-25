import {CONTRACT,windowFor} from './metrics.mjs';
import {assembleReport} from './report.mjs';
// Read existing normalized evidence only. No new schema, credentials or writes.
// Restored views are ALWAYS historical, with unknown delivery and no budget.
export async function readStoredReport({pool,accountId,query={},now=Date.now(),maxRangeDays=90,mode='UNKNOWN'}){
 const account=String(accountId).replace(/^act_/,'');if(!/^\d+$/.test(account))return null;
 const range=windowFor(query.since?query:query.period||'7d',now,'Europe/Madrid',maxRangeDays),days=(Date.parse(range.until)-Date.parse(range.since))/86400000+1;
 const comparison={since:new Date(Date.parse(range.since)-days*86400000).toISOString().slice(0,10),until:new Date(Date.parse(range.since)-86400000).toISOString().slice(0,10)};
 const levels=query.level?[query.level]:['campaign','adset','ad'];if(levels.some(l=>!['campaign','adset','ad'].includes(l)))throw Error('QUERY_INVALID');
 const result=await pool.query(`SELECT body FROM economics.ads_insights WHERE account_id=$1 AND contract=$2 AND level=ANY($3::text[])
  AND ((since=$4::date AND until=$5::date) OR (since=$6::date AND until=$7::date) OR (since=until AND since BETWEEN $4::date AND $5::date)) LIMIT 40001`,[account,CONTRACT,levels,range.since,range.until,comparison.since,comparison.until]);
 if(result.rows.length>40000)return null;
 const facts=result.rows.map(r=>r.body);
 if(!facts.length||facts.some(f=>f.accountId!==account||f.contract!==CONTRACT||!levels.includes(f.level)||!/^\d+$/.test(f.entityId)||!Number.isFinite(Date.parse(f.observedAt))))return null;
 const current={},prior={},daily={},entities={campaign:[],adset:[],ad:[],rules:[]};
 for(const level of ['campaign','adset','ad']){
  current[level]=facts.filter(f=>f.level===level&&f.since===range.since&&f.until===range.until);
  prior[level]=facts.filter(f=>f.level===level&&f.since===comparison.since&&f.until===comparison.until);
  daily[level]=facts.filter(f=>f.level===level&&f.since===f.until&&f.since>=range.since&&f.until<=range.until);
  entities[level]=current[level].map(f=>({id:f.entityId,name:f.name,campaign_id:f.campaignId,adset_id:f.adsetId,effective_status:'UNKNOWN'}));
 }
 if(!levels.some(l=>current[l].length))return null;
 const observedAt=new Date(Math.min(...facts.map(f=>Date.parse(f.observedAt)))).toISOString();
 const dataset={account:{id:account,currency:'EUR',timezone_name:'Europe/Madrid'},range,comparison,observedAt,current,prior,daily,entities,mode,loadedLevels:levels,creativeStatus:'UNAVAILABLE',readFailed:true,persisted:true,budgetObservation:{state:'UNAVAILABLE',observedAt:null}};
 return {...assembleReport(dataset),dataset,readFailed:true};
}
