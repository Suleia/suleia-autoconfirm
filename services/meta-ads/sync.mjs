import { normalizeInsight, CONTRACT, localDay } from './metrics.mjs';
// Serial bounded pages/dates. The existing scheduler may call this entrypoint;
// no new scheduler is enabled by importing it. Stop on any incomplete read.
export async function syncAds({reader,ledger,accountId,since,until,now=()=>Date.now()}) {
  const account=await reader.readAccount();
  if(String(account.id).replace(/^act_/,'')!==String(accountId).replace(/^act_/,'')||account.currency!=='EUR'||account.timezone_name!=='Europe/Madrid'||account.account_status!==1)throw Error('ACCOUNT_NOT_ELIGIBLE');
  const valid=d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
  if(!valid(since)||!valid(until)||since>until||until>localDay(now())||Date.parse(until)-Date.parse(since)>365*86400000)throw Error('BACKFILL_PERIOD_INVALID');
  let count=0,requests=0;
  for(let cursor=since;cursor<=until;){
    const end=new Date(Math.min(Date.parse(until),Date.parse(cursor)+30*86400000)).toISOString().slice(0,10);
    for(const level of ['campaign','adset','ad']){
      const observedAt=new Date(now()).toISOString();
      const rows=await reader.readInsights({since:cursor,until:end,level,daily:true});requests++;
      const facts=rows.map(r=>normalizeInsight(r,{level,accountId:String(accountId).replace(/^act_/,''),currency:'EUR',timezone:'Europe/Madrid',observedAt,complete:true,contract:CONTRACT}));
      if(facts.some(f=>!/^\d+$/.test(f.entityId)||f.since!==f.until||f.since<cursor||f.until>end)||new Set(facts.map(f=>f.entityId+':'+f.since)).size!==facts.length)throw Error('SYNC_IDENTITY_INVALID');
      if(ledger.persistDailySnapshot)await ledger.persistDailySnapshot(facts,{accountId:String(accountId).replace(/^act_/,''),level,since:cursor,until:end,contract:CONTRACT,observedAt});
      else await ledger.persistFacts(facts);
      count+=facts.length;
    }
    cursor=new Date(Date.parse(end)+86400000).toISOString().slice(0,10);
  }
  return {complete:true,since,until,rows:count,logicalReads:requests,metaWrites:0,contract:CONTRACT};
}
