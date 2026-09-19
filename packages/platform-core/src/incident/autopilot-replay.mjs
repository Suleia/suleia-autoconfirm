export function replayIncidentAutopilot(records = []) {
  const total = records.length;
  const automatic = records.filter((item) => !item.humanReview && !['ERROR', 'BLOCKED'].includes(item.state)).length;
  const human = records.filter((item) => item.humanReview || item.state === 'HUMAN_REVIEW').length;
  const unsafe = records.filter((item) => item.action?.mode === 'LIVE' || item.action?.externalWriteAttempted || item.productionWrites).length;
  const unknown = records.filter((item) => !item.policyVersion || item.state === 'BLOCKED').length;
  return Object.freeze({
    incidents_analyzed: total,
    automatic_decisions: automatic,
    automation_rate: total ? Number((automatic / total * 100).toFixed(2)) : null,
    human_review: human,
    human_review_rate: total ? Number((human / total * 100).toFixed(2)) : null,
    decisions_different_from_production: null,
    potential_unsafe_actions: unsafe,
    unknown_policies: unknown,
    actions_executed: 0,
    production_writes: 0,
    run_mode: 'REPLAY_READ_ONLY'
  });
}
