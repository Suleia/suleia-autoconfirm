// A prepared payload for the existing Telegram consumer. No transport, timer or
// send is created here; channel activation remains a separate owner decision.
export function prepareMorningBrief(overview,algorithm){
 const priorities=overview.actions.slice(0,3).map(a=>({title:a.title,campaign:a.name,evidence:a.evidenceText,risk:a.risk}));
 return {range:overview.range,contract:overview.contract,observedAt:overview.observedAt,spend:overview.totals.spend,roas:overview.totals.roas,purchases:overview.totals.purchases,cpa:overview.totals.cpa,improving:overview.facts.filter(f=>f.delta?.roas>0&&f.purchases>=5).map(f=>f.name),deteriorating:overview.facts.filter(f=>f.delta?.roas< -25&&f.purchases>=5).map(f=>f.name),anomalies:overview.alertGroups.filter(a=>a.priority===1),learningRisks:algorithm.campaigns.filter(c=>c.budgetCents!==null).map(c=>({campaign:c.name,reasons:c.reasons})),priorities,notificationsEnabled:false,externalWrites:0};
}
