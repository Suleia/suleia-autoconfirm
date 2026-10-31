export function evaluatePreCanaryGate(report){
  const reasons=[];
  if(!Number.isSafeInteger(report?.real_cases)||!Number.isSafeInteger(report?.reviewed_real_cases)
    ||report.real_cases<300||report.reviewed_real_cases<300||report.reviewed_real_cases>report.real_cases)reasons.push('REVIEWED_REAL_BENCHMARK_BELOW_300');
  if(report?.provenance_verified!==true)reasons.push('BENCHMARK_PROVENANCE_UNVERIFIED');
  for(const key of ['wrong_irreversible_route','wrong_order_binding','repeated_clarification'])if(report?.[key]!==0)reasons.push(key.toUpperCase());
  if(report?.owner_routing!==1)reasons.push('OWNER_ROUTING_BELOW_100_PERCENT');
  if(report?.explicit_return_recall!==1||report?.explicit_order_recall!==1)reasons.push('EXPLICIT_INTENT_RECALL_BELOW_100_PERCENT');
  if(!(typeof report?.date_window_accuracy==='number'&&report.date_window_accuracy>.98&&report.date_window_accuracy<=1))reasons.push('DATE_WINDOW_ACCURACY_NOT_ABOVE_98_PERCENT');
  if(report?.current_replay_verified!==true)reasons.push('CURRENT_REPLAY_UNVERIFIED');
  if(report?.executor_reconciliation_contract_verified!==true)reasons.push('EXECUTOR_RECONCILIATION_CONTRACT_UNVERIFIED');
  if(report?.unknown_execution_no_blind_retry_tests!==true)reasons.push('UNKNOWN_EXECUTION_NO_BLIND_RETRY_TESTS_UNVERIFIED');
  // No V3 send has happened yet: observed blind_retry belongs to promotion.
  return {gate:'PRE_CANARY',allowed:reasons.length===0,reasons};
}

export function evaluatePromotionGate(report){
  const reasons=[...evaluatePreCanaryGate(report).reasons];
  for(const key of ['canary_executed','canary_exact_case','provider_receipt_verified','conversation_readback_verified','current_evidence_revalidated'])
    if(report?.[key]!==true)reasons.push(key.toUpperCase());
  if(report?.send_attempts!==1)reasons.push('CANARY_REQUIRES_EXACTLY_ONE_SEND_ATTEMPT');
  for(const key of ['wrong_recipient','duplicate_send','blind_retry','uncertain_write_replayed'])if(report?.[key]!==0)reasons.push(key.toUpperCase());
  const capability=report?.capability;
  if(!['CONTEXTUAL_CLARIFICATION','STATUS_REPLY'].includes(capability)||report?.canary_capability!==capability)reasons.push('CAPABILITY_SPECIFIC_CANARY_REQUIRED');
  return {gate:'PROMOTION',allowed:reasons.length===0,capability:reasons.length===0?capability:null,reasons};
}

// Compatibility for offline report consumers; this never grants promotion.
export const evaluateConversationRelease=evaluatePreCanaryGate;
