import { absentHash } from './absent-template.mjs';

export const ABSENT_POLICY_DOCUMENT = Object.freeze({
  version: 'RECIPIENT_ABSENT_POLICY_V1', mode: 'SHADOW', timer_hours: 48,
  timer_owner: 'ingestion-worker:recipient-absent-shadow', reminders: [], auto_close: false,
  auto_cancel_timer: false, template: 'dropea_ausente_v1', timezone: 'Europe/Madrid',
  attempt_precedence: ['STRUCTURED', 'CORROBORATED_CARRIER_MAPPING', 'ORDER_TIMELINE', 'SAME_ORDER_HISTORY', 'UNKNOWN'],
  carrier_mapping: { GLS_ES_SUBSTATUS_15: { attempt: 2, requires_code: ['-30', '14'], requires_description: 'AUSENTE SEGUNDA VEZ', evidence: 'DROPEA_OBSERVED_COHORT_2026_09_17_9_OF_9', scope: 'DROPEA_GLS_ES_ONLY_NOT_UNIVERSAL_GLS_CODE' } },
  freshness_seconds: { dropea: 600, chatby: 300, gls: 900 },
  requirements: { CONTACT: ['DROPEA', 'EXACT_CHATBY', 'APPROVED_TEMPLATE'], WAIT: ['DROPEA', 'EXACT_CHATBY', 'VALID_48H_TIMER'], INTERPRET_RESPONSE: ['DROPEA', 'EXACT_CHATBY'], RESCHEDULE: ['DROPEA', 'EXACT_CHATBY', 'CARRIER_CAPABILITY', 'OPERABILITY', 'RETENTION', 'CALENDAR'], PICKUP: ['DROPEA', 'EXACT_CHATBY', 'CARRIER_CAPABILITY', 'OPERABILITY', 'RETENTION', 'PICKUP_POINT'], RETURN: ['DROPEA', 'EXACT_CHATBY', 'CARRIER_CAPABILITY', 'OPERABILITY', 'RETENTION'] },
  writes_enabled: false, customer_sends_enabled: false
});
export const ABSENT_POLICY_HASH = absentHash(ABSENT_POLICY_DOCUMENT);
const fold = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

export function classifyAbsentCause(issue = {}) {
  const text = fold(issue.initial_carrier_description_sanitized);
  if (issue.carrier === 'GLS' && issue.raw_type === 'RECIPIENT_ABSENT' && /(?:NO (?:ME )?APARECE|NO (?:SE )?(?:ENCUENTRA|LOCALIZA)).*(?:DIRECCION|GPS)|DIRECCION.*NO.*(?:GPS|LOCALIZA)/.test(text))
    return { interpreted_type: 'ADDRESS_NOT_LOCATED', secondary_reason: 'CARRIER_ADDRESS_NOT_LOCATED', routing_policy: 'ADDRESS_RESOLUTION', source: 'GOVERNED_GLS_DESCRIPTION_EXCEPTION' };
  if (/DIRECCION (?:INCORRECTA|ERRONEA)/.test(text)) return { interpreted_type: 'ADDRESS_INCORRECT', secondary_reason: 'CARRIER_ADDRESS_INCORRECT', routing_policy: 'ADDRESS_RESOLUTION', source: 'GOVERNED_DESCRIPTION_EXCEPTION' };
  if (/(?:ACCESO IMPOSIBLE|NO (?:SE )?PUEDE ACCEDER)/.test(text)) return { interpreted_type: 'DELIVERY_ACCESS_PROBLEM', secondary_reason: 'CARRIER_ACCESS_PROBLEM', routing_policy: 'HUMAN_LOGISTICS_REVIEW', source: 'GOVERNED_DESCRIPTION_EXCEPTION' };
  return { interpreted_type: 'RECIPIENT_ABSENT', secondary_reason: null, routing_policy: 'RECIPIENT_ABSENT_POLICY_V1', source: 'RAW_CANONICAL_TYPE' };
}

export function classifyAbsenceAttempt({ issue = {}, timeline = [] }) {
  const number = String(issue.delivery_attempt_number || '').toUpperCase();
  const result = (n, source, at) => ({ status: n === 1 ? 'FIRST_ABSENCE' : 'SECOND_ABSENCE', number: n, source, event_at: at || issue.created_at || null });
  if (['1', 'FIRST', 'FIRST_ATTEMPT'].includes(number)) return result(1, 'DROPEA_EXPLICIT_ATTEMPT');
  if (['2', 'SECOND', 'SECOND_ATTEMPT'].includes(number)) return result(2, 'DROPEA_EXPLICIT_ATTEMPT');
  // Observed primary Dropea data: 9/9 GLS ES substatus=15 rows carry the
  // second-absence description. Require BOTH signals; never export a universal
  // GLS code mapping, or classify text alone / another carrier / conflicting text.
  if (issue.carrier === 'GLS' && issue.market === 'ES'
      && ['-30', '14'].includes(String(issue.initial_carrier_code))
      && String(issue.initial_carrier_substatus_code) === '15'
      && /\bAUSENTE SEGUNDA VEZ\b/.test(fold(issue.initial_carrier_description_sanitized)))
    return result(2, 'DROPEA_GLS_ES_SUBSTATUS_15_CORROBORATED');
  const valid = timeline.filter(e => e.verified === true && e.normalized_type === 'RECIPIENT_ABSENT'
    && e.event_id && (!e.canonical_order_id || e.canonical_order_id === issue.canonical_order_id)
    && Number.isFinite(new Date(e.event_at).getTime()) && new Date(e.event_at) <= new Date(issue.created_at || issue.updated_at));
  const events = [...new Map(valid.map(e => [e.event_id, e])).values()].sort((a,b) => new Date(a.event_at) - new Date(b.event_at));
  if (events.length >= 2) return result(2, 'VERIFIED_SAME_ORDER_ABSENCE_HISTORY', events.at(-1).event_at);
  if (events.length === 1 && issue.attempt_history_complete === true) return result(1, 'VERIFIED_COMPLETE_ORDER_TIMELINE', events[0].event_at);
  return { status: 'ABSENCE_ATTEMPT_UNKNOWN', number: null, source: 'INSUFFICIENT_ATTEMPT_EVIDENCE', event_at: null };
}

export function absentSourceFreshness(at, now, seconds) {
  if (!at || !Number.isFinite(new Date(at).getTime())) return 'UNKNOWN';
  const age = new Date(now) - new Date(at);
  return age < 0 || age > seconds * 1000 ? 'STALE' : 'FRESH';
}

export function validAbsentTimer(timer, now) {
  if (!timer || !timer.timer_id || !['CUSTOMER_INITIAL_RESPONSE_48H', 'INCIDENT_AUSENTE_48H'].includes(timer.timer_type)
      || timer.status !== 'ACTIVE' || !Number.isFinite(new Date(timer.due_at).getTime())) return false;
  return Boolean(timer.started_at) && Number.isFinite(new Date(timer.started_at).getTime())
    && new Date(timer.started_at)<=new Date(now)
    && new Date(timer.due_at) - new Date(timer.started_at) === 48 * 3600000;
}
