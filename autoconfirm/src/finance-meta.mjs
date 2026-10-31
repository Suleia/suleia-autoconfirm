// Account-level monetary spend for finance. GET only; no campaign/budget writes.
import {getAppConfig} from './config.mjs';
const DATE=/^\d{4}-\d{2}-\d{2}$/;
export async function getFinanceMetaSpend({since,until},{config=getAppConfig(),fetchImpl=globalThis.fetch,now=new Date()}={}){
 if(!DATE.test(since)||!DATE.test(until)||since>until)throw Error('FINANCE_META_RANGE_INVALID');
 const id=String(config.metaAdAccountId||'').replace(/^act_/,'');
 const version=config.metaApiVersion;
 if(!/^\d+$/.test(id)||!/^v\d+\.0$/.test(version)||!config.metaAccessToken)throw Error('FINANCE_META_CONFIG_MISSING');
 const read=async url=>{
  if(url.protocol!=='https:'||url.hostname!=='graph.facebook.com'||!['/'+version+'/act_'+id,'/'+version+'/act_'+id+'/insights'].includes(url.pathname))throw Error('FINANCE_META_HOST_BLOCKED');
  url.searchParams.delete('access_token');
  for(let n=0;n<3;n++){
   const response=await fetchImpl(url,{method:'GET',headers:{Accept:'application/json',Authorization:'Bearer '+config.metaAccessToken},redirect:'error',signal:AbortSignal.timeout(30000)});
   if((response.status===429||response.status>=502)&&n<2){await new Promise(r=>setTimeout(r,Math.min(10000,Number(response.headers?.get?.('retry-after')||1)*1000)));continue;}
   if(!response.ok)throw Error('FINANCE_META_HTTP_'+response.status);
   const data=await response.json();if(data?.error)throw Error('FINANCE_META_PROVIDER_ERROR');return data;
  }
 };
 const base='https://graph.facebook.com/'+version+'/act_'+id;
 const a=new URL(base);a.searchParams.set('fields','id,currency,timezone_name');
 const account=await read(a);
 if(account.currency!=='EUR'||account.timezone_name!=='Europe/Madrid')throw Error('FINANCE_META_CURRENCY_TIMEZONE_MISMATCH');
 let url=new URL(base+'/insights');
 for(const[k,v]of Object.entries({level:'account',fields:'account_id,spend,date_start,date_stop',time_increment:1,time_range:JSON.stringify({since,until}),limit:500}))url.searchParams.set(k,v);
 const days=new Map(),visited=new Set();let complete=false;
 for(let page=0;page<20;page++){
  const cursor=url.searchParams.get('after')||'first';if(visited.has(cursor))throw Error('FINANCE_META_PAGE_REPEATED');visited.add(cursor);
  const payload=await read(url);if(!Array.isArray(payload.data))throw Error('FINANCE_META_SCHEMA');
  for(const row of payload.data){
   if(!DATE.test(row.date_start)||row.date_start<since||row.date_start>until||row.date_start!==row.date_stop
    ||row.spend===null||row.spend===undefined||!/^\d+(?:\.\d{1,2})?$/.test(String(row.spend))||days.has(row.date_start)
    ||String(row.account_id).replace(/^act_/,'')!==id)throw Error('FINANCE_META_DAY_INVALID');
   days.set(row.date_start,{dateStart:row.date_start,spend:String(row.spend),sourceState:'ACCOUNT_DAILY_OBSERVED'});
  }
  if(!payload.paging?.next){complete=true;break;}url=new URL(payload.paging.next);
  if(url.protocol!=='https:'||url.hostname!=='graph.facebook.com'||url.pathname!=='/'+version+'/act_'+id+'/insights')throw Error('FINANCE_META_HOST_BLOCKED');
 }
 if(!complete)throw Error('FINANCE_META_PAGINATION_INCOMPLETE');
 const rows=[];let missingDays=0;
 for(let day=since;day<=until;day=new Date(Date.parse(day+'T00:00Z')+86400000).toISOString().slice(0,10)){
  const row=days.get(day);if(!row)missingDays++;
  rows.push(row||{dateStart:day,spend:'0.00',sourceState:'NO_ACTIVITY_COMPLETE_ACCOUNT_QUERY'});
 }
 rows.financeEvidence={accountId:'act_'+id,currency:account.currency,timeZone:account.timezone_name,complete:true,
  since,until,readAt:now.toISOString(),days:rows.length,zeroNoActivityDays:missingDays,basis:'ACCOUNT_LEVEL_MONETARY_SPEND'};
 return rows;
}

