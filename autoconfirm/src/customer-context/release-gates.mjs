export function evaluateConversationRelease(report){
  const reasons=[];
  if(!report||report.real_cases<300||report.reviewed_real_cases<300)reasons.push('REVIEWED_REAL_BENCHMARK_BELOW_300');
  if(!report?.provenance_verified)reasons.push('BENCHMARK_PROVENANCE_UNVERIFIED');
  for(const key of ['wrong_irreversible_route','wrong_order_binding','repeated_clarification','blind_retry'])if(report?.[key]!==0)reasons.push(key.toUpperCase());
  if(report?.owner_routing!==1)reasons.push('OWNER_ROUTING_BELOW_100_PERCENT');
  if(report?.explicit_return_recall!==1||report?.explicit_order_recall!==1)reasons.push('EXPLICIT_INTENT_RECALL_BELOW_100_PERCENT');
  if(!(report?.date_window_accuracy>.98))reasons.push('DATE_WINDOW_ACCURACY_NOT_ABOVE_98_PERCENT');
  if(!report?.current_replay_verified)reasons.push('CURRENT_REPLAY_UNVERIFIED');
  return {allowed:reasons.length===0,reasons};
}
