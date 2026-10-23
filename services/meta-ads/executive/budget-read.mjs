import {madridTime,instantFor,NIGHT_TIMES} from '../autopilot/schedule.mjs';
import {shiftDay} from '../review/periods.mjs';
// Restricted dependency surface: SQL reads and immutable configuration only.
// Never receives engine, capture(), constraints(), a Meta client or writer.
export async function readExecutiveBudget({ledger,accountId,mode,config,now=Date.now()}){
 const [history,counts,slots]=await Promise.all([ledger.autopilotHistory(accountId,now),ledger.executiveBudgetCounts(accountId,now),ledger.autopilotSlots(accountId,now)]);
 const items=history.flatMap(p=>p.items||[]),blocked=items.filter(i=>i.reasons?.length),local=madridTime(now),next=NIGHT_TIMES.find(t=>t>local.time),nextDate=next?local.date:shiftDay(local.date,1);
 const alerts=slots.filter(s=>s.state==='FAILED'||s.state==='EXECUTING'||s.body?.finalCheck?.state==='CRITICAL_UNVERIFIED_CAP').map(s=>({slot:s.slot_key,state:s.body?.finalCheck?.state||s.state}));
 return {mode,enabled:config.enabled,observedAt:new Date(now).toISOString(),verifiedChanges:counts.verifiedChanges,
  blockedCampaigns:new Set(blocked.map(i=>i.campaignId)).size,limits:[...new Set(blocked.flatMap(i=>i.reasons).filter(r=>/LIMIT|MAX_|MIN_/.test(r)))],
  pendingApprovals:counts.pendingApprovals,nextNight:new Date(instantFor(nextDate,next||'22:30')).toISOString(),alerts,
  policyVersion:config.policy.version,externalWrites:0,note:'Only this executor ledger proves own verified changes. External Meta changes require their separate audit.'};
}
