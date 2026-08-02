import { interpretIncidentConversation } from './conversation-intelligence.mjs';
import { simulateIncidentProcess } from './incident-processor.mjs';

function sourceEvent(issue) {
  return issue.source_event_id || `poll:${issue.canonical_issue_id}:${issue.updated_at}`;
}

export function buildIncidentSimulation({ issue, order, events = [], gls = {}, now = new Date(), holidays = [] }) {
  const issueVersion = issue.updated_at;
  const interpretation = interpretIncidentConversation({
    events,
    issueId: issue.canonical_issue_id,
    issueVersion,
    now
  });
  const sourceEventId = sourceEvent(issue);
  const decision = simulateIncidentProcess({
    market: 'ES', sourceEventId, issue, order,
    identity: { status: order.identity_status },
    chatby: {
      customer_response_status: interpretation.has_customer_replied ? 'RESPONDED' : 'NO_RESPONSE',
      intent: interpretation.customer_intent,
      fresh: issue.freshness === 'FRESH',
      contradiction_status: interpretation.contradiction ? 'CONTRADICTORY' : 'NONE',
      requested_date: interpretation.requested_date,
      requested_time_window: interpretation.requested_time_window,
      wait_started_at: issue.updated_at,
      discount_offer_status: issue.discount_status
    },
    gls
  }, { now, holidays });
  return Object.freeze({
    interpretation: Object.freeze({
      ...interpretation,
      canonical_order_id: order.canonical_order_id,
      freshness: issue.freshness
    }),
    decision,
    simulation_record: Object.freeze({
      simulation_id: decision.decision_id,
      canonical_issue_id: issue.canonical_issue_id,
      canonical_order_id: order.canonical_order_id,
      issue_version: issueVersion,
      source_event_id: sourceEventId,
      dropea_snapshot_at: issue.observed_at || issue.updated_at,
      chatby_snapshot_at: interpretation.latest_inbound_message_at,
      policy_version: decision.policy_version,
      connector_version: issue.source_version,
      issue_type: issue.type,
      delivery_attempt_number: decision.delivery_attempt_number,
      customer_has_replied: interpretation.has_customer_replied,
      customer_intent: interpretation.customer_intent,
      interpretation_summary: interpretation.interpretation_summary,
      facts_used: ['DROPEA_ISSUE', 'DROPEA_ALLOWED_RESOLUTIONS', 'GLS_POLICY',
        ...(interpretation.has_customer_replied ? ['CURRENT_CHATBY_INBOUND'] : [])],
      facts_ignored: interpretation.messages_ignored ? ['IRRELEVANT_OR_OUTBOUND_CHATBY_EVENTS'] : [],
      allowed_resolution_options: issue.allowed_resolution_options,
      gls_feasibility: decision.gls_feasibility,
      simulated_decision: decision.simulated_decision,
      simulated_action: decision.simulated_action,
      missing_data: interpretation.missing_information,
      blocking_reasons: decision.blocking_reasons,
      risk: decision.risk,
      confidence: interpretation.interpretation_confidence,
      qa_status: decision.qa_result,
      human_review: decision.requires_human_review,
      timer_status: decision.timer?.status || null,
      execution_available: false,
      external_write_attempted: false,
      actions_executed: 0,
      production_writes: 0
    })
  });
}
