// Owner's absolute configured daily-budget ceiling, independent of feature flags,
// recommendations, actor, ROAS, or environment-supplied limits. Not a spend cap.
export const MAX_CAMPAIGN_DAILY_BUDGET_CENTS=10000;
export function assertDailyBudget(cents){
  if(!Number.isSafeInteger(cents)||cents<=0||cents>MAX_CAMPAIGN_DAILY_BUDGET_CENTS)
    throw Object.assign(Error('MAX_CAMPAIGN_DAILY_BUDGET'),{code:'MAX_CAMPAIGN_DAILY_BUDGET',notSent:true});
  return cents;
}
