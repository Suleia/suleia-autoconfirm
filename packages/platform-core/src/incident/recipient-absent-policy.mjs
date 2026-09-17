import { absentHash, ABSENT_BUTTONS } from './absent-template.mjs';
export { classifyAbsenceAttempt } from './absent-evidence.mjs';

export const RECIPIENT_ABSENT_POLICY_V1 = 'RECIPIENT_ABSENT_POLICY_V1';
export const ABSENT_STEPS = Object.freeze(['ABSENT_DETECTED', 'CUSTOMER_CONTACT_REQUIRED',
  'WAITING_CUSTOMER_RESPONSE', 'CUSTOMER_RESPONSE_RECEIVED', 'RESPONSE_INTERPRETED',
  'LOGISTICS_VALIDATION_REQUIRED', 'RESOLUTION_PROPOSED', 'WAITING_EXECUTION']);
const fold = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const DAY = 86_400_000;
function madridDay(at) {
  if (at instanceof Date) at = at.toISOString();
  if (!at || !/(?:Z|[+-]\d{2}:?\d{2})$/.test(String(at)) || !Number.isFinite(new Date(at).getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(at)).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function addDays(day, days) { return new Date(new Date(`${day}T12:00:00Z`).getTime() + days * DAY).toISOString().slice(0, 10); }
function buttonFor(event) {
  const payload = event.button_payload || event.payload?.payload || event.payload?.button_reply?.id || event.interactive?.button_reply?.id;
  const exact = ABSENT_BUTTONS.find(b => b.payload === payload);
  if (exact) return exact;
  // Text-only providers require an exact approved label, never fuzzy matching.
  return ABSENT_BUTTONS.find(b => fold(b.text) === fold(event.raw_text || event.button_text || event.payload?.title));
}
export function interpretAbsentResponse(event = {}) {
  const button = buttonFor(event);
  const text = fold(event.raw_text || event.sanitized_text);
  const base = { customer_intent: 'UNCLEAR', requested_date: null, requested_time_window: null,
    time_from: null, time_to: null, all_day: false, pickup_requested: false, button_pressed: button?.payload || null,
    raw_customer_text_hash: absentHash(event.raw_text || event.sanitized_text || ''), confidence: 0, reason_code: 'AMBIGUOUS_CUSTOMER_RESPONSE' };
  const day = madridDay(event.created_at);
  let intent = null;
  const returnIntent = /\b(devuelvelo|quiero devolverlo|quiero devolver|no lo quiero|no quiero (?:el |este |mi )?pedido|cancelalo)\b/.test(text);
  const addressIntent = /\b(cambia|cambiar|cambio)\b.*\b(direccion|domicilio)\b/.test(text);
  const pickupIntent = button?.payload === 'ABSENT_PICKUP_AGENCY' || /\b(recoger|recogida|recojo)\b.*\b(agencia|oficina)\b/.test(text);
  const receiveIntent = button && ['ABSENT_TOMORROW_AM','ABSENT_TOMORROW_PM'].includes(button.payload)
    || /\b(manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo|esta tarde|recibir|reparto)\b/.test(text);
  if (/\bno (?:estoy|estare|puedo|podre|hay|habra|quiero recoger|quiero cambiar|cambies|vengas|entregues|quiero recibir)\b/.test(text)) return {...base,reason_code:'NEGATED_OR_CORRECTED_CUSTOMER_REQUEST'};
  if ([returnIntent, addressIntent, pickupIntent, Boolean(receiveIntent)].filter(Boolean).length > 1) return { ...base, customer_intent: 'CONTRADICTORY', reason_code: 'CONTRADICTORY_CUSTOMER_RESPONSE' };
  if (returnIntent) intent = 'RETURN_REQUEST';
  else if (addressIntent) intent = 'ADDRESS_CHANGE';
  else if (pickupIntent) intent = 'PICKUP_AT_AGENCY';
  else if (button?.payload === 'ABSENT_OTHER_SLOT') intent = 'CUSTOM_TIME_SLOT';
  if (intent) return { ...base, customer_intent: intent, pickup_requested: intent === 'PICKUP_AT_AGENCY', confidence: 1, reason_code: 'EXPLICIT_CUSTOMER_INTENT' };
  if (!day) return { ...base, reason_code: 'CUSTOMER_MESSAGE_TIMESTAMP_NOT_VERIFIED' };
  const weekdays = ['domingo','lunes','martes','miercoles','jueves','viernes','sabado'];
  const selected = weekdays.filter(w => new RegExp(`\\b${w}\\b`).test(text));
  if (selected.length > 1 || /\b(o|quizas|tal vez|puede que)\b/.test(text)) return base;
  let date = null;
  if (button?.payload?.startsWith('ABSENT_TOMORROW') || /\bmanana\b/.test(text.replace(/por la manana/g, ''))) date = addDays(day, 1);
  if (selected.length === 1) {
    if (date) return base;
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
    date = addDays(day, (weekdays.indexOf(selected[0]) - weekday + 7) % 7 || 7);
  }
  if (text.includes('esta tarde')) date = day;
  const clocks = [...text.matchAll(/(?:las?\s+|\b)(\d{1,2}):(\d{2})\b/g)];
  const bare = !clocks.length ? text.match(/a partir de las?\s+(\d{1,2})\b/) : null;
  if (clocks.length > 1 || (bare && Number(bare[1]) < 13)) return base;
  const from = clocks[0] ? `${clocks[0][1].padStart(2,'0')}:${clocks[0][2]}` : bare ? `${bare[1].padStart(2,'0')}:00` : null;
  if (from && (Number(from.slice(0,2)) > 23 || Number(from.slice(3)) > 59)) return base;
  const morning = button?.payload === 'ABSENT_TOMORROW_AM' || /por la manana/.test(text);
  const afternoon = button?.payload === 'ABSENT_TOMORROW_PM' || /por la tarde|esta tarde/.test(text);
  if (morning && afternoon) return base;
  const allDay = text.includes('todo el dia');
  const window = allDay ? 'ALL_DAY' : morning ? 'MORNING' : afternoon ? 'AFTERNOON' : from ? 'FROM_TIME' : null;
  if (!date || !window) return base;
  return { ...base, customer_intent: 'RESCHEDULE_DELIVERY', requested_date: date, requested_time_window: window,
    time_from: from, all_day: allDay, confidence: 1, reason_code: 'EXACT_CUSTOMER_SLOT' };
}
export { validateAbsentLogistics, simulateRecipientAbsent } from './absent-decision.mjs';
