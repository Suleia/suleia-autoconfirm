// Pure deterministic examples. No credentials, network, database or writer.
import {loadAutopilotConfig,evaluateAutopilot} from '../autopilot/policy.mjs';
import {reviewSlot,instantFor} from '../autopilot/schedule.mjs';
if(process.argv.length>2)throw Error('SIMULATION_ONLY_NO_ARGUMENTS');
const date='2026-10-22',type='offsite_conversion.fb_pixel_purchase';
const config=loadAutopilotConfig({AUTOPILOT_MODE:'SIMULATION'},{maxBudgetCents:10000,maxChangePercent:10,maxAggregateIncreaseCents:3000,campaignCooldownMs:86400000,minSpend:15,minPurchases:5,minImpressions:1000});
const scenarios=[['20 → 30',2000,4.2,3,'10:00'],['25 → 35',2500,4.2,3,'07:00'],['60 → 70',6000,4.2,6,'10:00'],['65 → 70',6500,4.2,6,'10:00'],['70: mantener',7000,4.2,6,'10:00'],['12:00: 70 → 60',7000,3.7,3,'12:00'],['19:00: 30 → 20',3000,3.7,3,'19:00'],['ROAS =3,8',2500,3.8,3,'12:00'],['ROAS ausente',2500,null,null,'12:00'],['Noche: ROAS alto',7000,4.2,6,'23:59'],['Noche: ROAS desconocido',7000,null,null,'23:59'],['Noche: presupuesto ya bajo',1500,4.2,6,'23:59']];
const results=scenarios.map(([name,budget,roas,purchases,time])=>{
 const now=instantFor(date,time),metric={level:'campaign',campaignId:'11',since:date,until:date,observedAt:new Date(now).toISOString(),complete:true,purchases,spend:20,impressions:2000,metaRoas:roas,metaRoasStatus:roas===null?'MISSING':roas===0?'ZERO':'VALID',purchaseType:type,metaRoasPurchaseType:type};
 const decision=evaluateAutopilot({campaign:{id:'11',name:'Campaña ficticia',daily_budget:String(budget),status:'ACTIVE',effective_status:'ACTIVE'},metric,slot:reviewSlot(now),now,config});
 return {scenario:name,time,beforeCents:budget,candidateCents:decision.after,action:decision.action,state:decision.state,blockers:decision.reasons,nightTargetCents:decision.nightTargetCents};
});
process.stdout.write(JSON.stringify({mode:'SIMULATION',data:'FICTIONAL_POLICY_EXAMPLES',version:config.policy.version,externalWrites:0,approvedPolicyValues:{},results},null,2)+'\n');
