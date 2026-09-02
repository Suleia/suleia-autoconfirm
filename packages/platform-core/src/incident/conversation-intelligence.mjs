import crypto from 'node:crypto';
import { maskText } from '../masking.mjs';

export const INCIDENT_INTENTS = Object.freeze([
  'DELIVERY_RETRY', 'DELIVERY_RETRY_ON_DATE', 'DELIVERY_RETRY_MORNING',
  'DELIVERY_RETRY_AFTERNOON', 'DELIVERY_RETRY_EVENING', 'CHANGE_ADDRESS',
  'PROVIDE_MISSING_DATA', 'PICKUP_AT_AGENCY', 'RETURN_REQUEST', 'FINAL_REJECTION',
  'CUSTOMER_STILL_WANTS_ORDER', 'ACCIDENTAL_REFUSAL', 'NO_RESPONSE',
  'DISCOUNT_ACCEPTED', 'DISCOUNT_REJECTED', 'INSPECT_BEFORE_PAYMENT',
  'UNDECIDED', 'CONTRADICTORY', 'UNKNOWN'
]);

const BUTTON_INTENTS = Object.freeze({
  DELIVERY_RETRY: 'DELIVERY_RETRY', PICKUP_AT_AGENCY: 'PICKUP_AT_AGENCY',
  RETURN_REQUEST: 'RETURN_REQUEST', FINAL_REJECTION: 'FINAL_REJECTION',
  CUSTOMER_STILL_WANTS_ORDER: 'CUSTOMER_STILL_WANTS_ORDER',
  DISCOUNT_ACCEPTED: 'DISCOUNT_ACCEPTED', DISCOUNT_REJECTED: 'DISCOUNT_REJECTED'
});

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function iso(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function sameIssueVersion(left, right) {
  const leftIso = iso(left);
  const rightIso = iso(right);
  if (leftIso && rightIso) return leftIso === rightIso;
  return String(left ?? '') === String(right ?? '');
}

function eventIntent(event) {
  const explicit = String(event.intent || '').toUpperCase();
  if (INCIDENT_INTENTS.includes(explicit)) return explicit;
  return BUTTON_INTENTS[String(event.button_payload || '').toUpperCase()] || 'UNKNOWN';
}

export function interpretIncidentConversation({ events = [], issueId, issueVersion, now = new Date() }) {
  const sorted = [...events].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const relevant = [];
  const ignored = [];
  for (const event of sorted) {
    const currentIssue = String(event.canonical_issue_id || '') === String(issueId);
    const currentVersion = !event.incident_version || sameIssueVersion(event.incident_version, issueVersion);
    const customerInput = event.direction === 'INBOUND' || event.message_type === 'BUTTON';
    if (!currentIssue || !currentVersion || !customerInput) {
      ignored.push(event);
      continue;
    }
    relevant.push({ ...event, detected_intent: eventIntent(event) });
  }
  const timeline = relevant.map((event, index) => Object.freeze({
    message_id_hash: hash(event.chatby_message_id || `${issueId}:${index}`),
    detected_at: iso(event.created_at),
    detected_intent: event.detected_intent,
    confidence: Number(event.intent_confidence || (event.message_type === 'BUTTON' ? 1 : 0)),
    contradiction: index > 0 && relevant[index - 1].detected_intent !== event.detected_intent,
    supersedes_message_id_hash: index > 0 ? hash(relevant[index - 1].chatby_message_id || `${issueId}:${index - 1}`) : null,
    relevant_to_issue_version: String(issueVersion)
  }));
  const latest = relevant.at(-1) || null;
  const previousIntents = [...new Set(relevant.slice(0, -1).map((event) => event.detected_intent))];
  const currentIntent = latest?.detected_intent || 'NO_RESPONSE';
  const intentChanged = Boolean(latest && previousIntents.length && !previousIntents.includes(currentIntent));
  return Object.freeze({
    canonical_issue_id: String(issueId),
    issue_version: String(issueVersion),
    has_customer_replied: Boolean(latest),
    latest_inbound_message_at: latest ? iso(latest.created_at) : null,
    latest_relevant_message_hash: latest ? hash(latest.chatby_message_id || latest.created_at) : null,
    latest_relevant_message_sanitized: latest?.sanitized_text ? maskText(latest.sanitized_text).slice(0, 500) : null,
    customer_intent: currentIntent,
    previous_intents: previousIntents,
    intent_changed: intentChanged,
    contradiction: timeline.some((item) => item.contradiction),
    requested_date: latest?.requested_date || null,
    requested_time_window: latest?.requested_time_window || null,
    requested_detail: latest?.requested_detail_sanitized ? maskText(latest.requested_detail_sanitized).slice(0, 300) : null,
    requested_address_present: Boolean(latest?.requested_address),
    pickup_requested: currentIntent === 'PICKUP_AT_AGENCY',
    return_requested: ['RETURN_REQUEST', 'FINAL_REJECTION'].includes(currentIntent),
    discount_accepted: currentIntent === 'DISCOUNT_ACCEPTED',
    discount_rejected: currentIntent === 'DISCOUNT_REJECTED',
    conversation_quality: latest ? (currentIntent === 'UNKNOWN' ? 'LOW' : 'SUPPORTED') : 'NO_RESPONSE',
    interpretation_confidence: latest ? Number(latest.intent_confidence || (latest.message_type === 'BUTTON' ? 1 : 0)) : 1,
    interpretation_summary: latest ? `CURRENT_INTENT:${currentIntent}` : 'NO_VALID_INBOUND_FOR_CURRENT_ISSUE',
    messages_used: relevant.length,
    messages_ignored: ignored.length,
    missing_information: currentIntent === 'UNKNOWN' ? ['DETERMINISTIC_INTENT_CLASSIFICATION'] : [],
    intent_timeline: timeline,
    interpreted_at: new Date(now).toISOString(),
    actions_executed: 0,
    production_writes: 0,
    run_mode: 'SHADOW_READ_ONLY'
  });
}
