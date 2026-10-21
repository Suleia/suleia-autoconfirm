import { createHash } from 'node:crypto';
import { localDay } from './metrics.mjs';
// Called by the existing scheduler only after enabling the Ads feature. No new
// daemon, no budget executor, and no automatic retry after an uncertain send.
export async function reviewAds({runtime,enabled=false,alertsEnabled=false,send=null,now=Date.now()}){
  if(!enabled)return {state:'DISABLED',externalWrites:0};
  const report=await runtime.overview({period:'7d'});
  const meaningful=report.alertGroups.filter(a=>a.priority===1);
  const day=localDay(now),signature=createHash('sha256').update(JSON.stringify(meaningful.map(a=>[a.entityId,[...a.related].sort()]).sort())).digest('hex');
  if(!meaningful.length||!alertsEnabled||!send)return {state:'REVIEWED',report,externalWrites:0};
  // One consolidated digest per day/signature. Claim before sending; ambiguity
  // remains reviewable and never leads to duplicate customer/operator messages.
  const key=`${report.account.id}:${day}:daily-review`;
  if(!await runtime.ledger.claimDigest(key,{observedAt:report.observedAt,range:report.range,signature,count:meaningful.length}))return {state:'DUPLICATE',externalWrites:0};
  try{await send({text:`Ads Intelligence · ${report.range.since} → ${report.range.until}\nActualizado ${report.observedAt}\n${meaningful.slice(0,5).map(a=>`${a.name}: ${a.reason}. ${a.action}`).join('\n')}\nSin cambios de presupuesto.`,report});await runtime.ledger.finishDigest(key,'SENT');return {state:'SENT',externalWrites:1};}
  catch{await runtime.ledger.finishDigest(key,'UNKNOWN');return {state:'UNKNOWN',externalWrites:null};}
}
