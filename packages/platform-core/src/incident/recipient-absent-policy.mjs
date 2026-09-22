import { absentHash, absentButtonFor } from './absent-template.mjs';
import { addressInstructionFromText } from '../operational-truth/chatby-customer-instruction.mjs';
import { absentTimeWindow } from './absent-time-window.mjs';
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
export function interpretAbsentResponse(event = {}) {
  const button = absentButtonFor(event);
  const text = fold(event.raw_text || event.sanitized_text);
  const base = { customer_intent: 'UNCLEAR', requested_date: null, requested_time_window: null,
    time_from: null, time_to: null, all_day: false, pickup_requested: false, button_pressed: button?.payload || null,
    raw_customer_text_hash: absentHash(event.raw_text || event.sanitized_text || ''), confidence: 0, reason_code: 'AMBIGUOUS_CUSTOMER_RESPONSE' };
  if (!button && String(event.button_payload || event.payload?.payload || event.interactive?.button_reply?.id || '').startsWith('ABSENT_')) return {...base,reason_code:'UNKNOWN_ABSENT_BUTTON_PAYLOAD'};
  const day = madridDay(event.created_at);
  let intent = null;
  const returnIntent = /\b(devuelvelo|quiero devolverlo|quiero devolver|no lo quiero|no quiero (?:el |este |mi )?pedido|cancelalo)\b/.test(text);
  const addressIntent = /\b(cambia|cambiar|cambio)\b.*\b(direccion|domicilio)\b/.test(text);
  const pickupIntent = button?.payload === 'ABSENT_PICKUP_AGENCY' || /\b(recoger|recogida|recojo)\b.*\b(agencia|oficina)\b/.test(text);
  const receiveIntent = button && ['ABSENT_TOMORROW_MORNING','ABSENT_TOMORROW_AFTERNOON'].includes(button.payload)
    || /\b(manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo|esta tarde|recibir|reparto)\b/.test(text);
  if (/\bno (?:quiero recoger|quiero cambiar|cambies|vengas|entregues|quiero recibir)\b/.test(text)) return {...base,reason_code:'NEGATED_OR_CORRECTED_CUSTOMER_REQUEST'};
  if ([returnIntent, addressIntent, pickupIntent, Boolean(receiveIntent)].filter(Boolean).length > 1) return { ...base, customer_intent: 'CONTRADICTORY', reason_code: 'CONTRADICTORY_CUSTOMER_RESPONSE' };
  if (returnIntent) intent = 'RETURN_REQUEST';
  else if (addressIntent) intent = 'ADDRESS_CHANGE';
  else if (pickupIntent) intent = 'PICKUP_AT_AGENCY';
  else if (button?.payload === 'ABSENT_OTHER_DAY') intent = 'CUSTOM_TIME_SLOT';
  else if (button?.payload === 'ABSENT_CHANGE_DELIVERY_DATA') intent = 'ADDRESS_DATA_REQUEST';
  else if (button?.payload === 'ABSENT_MORE_OPTIONS') intent = 'RECOVERY_OPTIONS';
  else if (event.flow_selection === 'ABSENT_CHANGE_DELIVERY_DATA') {
    const address = addressInstructionFromText(event.raw_text || '');
    return { ...base, customer_intent: address.has_address_data ? 'ADDRESS_CHANGE' : 'ADDRESS_DATA_REQUEST',
      address_complete: address.complete, address_missing_fields: address.missing_fields,
      confidence: address.has_address_data ? 1 : 0, reason_code: address.has_address_data ? 'CORRELATED_ADDRESS_DATA_RECEIVED' : 'WAITING_ADDRESS_DATA' };
  }
  if (intent) return { ...base, customer_intent: intent, pickup_requested: intent === 'PICKUP_AT_AGENCY', confidence: 1, reason_code: 'EXPLICIT_CUSTOMER_INTENT' };
  if (!day) return { ...base, reason_code: 'CUSTOMER_MESSAGE_TIMESTAMP_NOT_VERIFIED' };
  const weekdays = ['domingo','lunes','martes','miercoles','jueves','viernes','sabado'];
  const selected = weekdays.filter(w => new RegExp(`\\b${w}\\b`).test(text));
  if (selected.length > 1 || /\b(o|quizas|tal vez|puede que)\b/.test(text)) return base;
  let date = null;
  const explicitDate = text.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1];
  if (event.flow_selection === 'ABSENT_OTHER_DAY' && explicitDate) {
    if (!Number.isFinite(Date.parse(`${explicitDate}T12:00:00Z`)) || new Date(`${explicitDate}T12:00:00Z`).toISOString().slice(0,10)!==explicitDate) return base;
    date = explicitDate;
  }
  if (button?.payload?.startsWith('ABSENT_TOMORROW') || /\bmanana\b/.test(text.replace(/por la manana/g, ''))) date = addDays(day, 1);
  if (selected.length === 1) {
    if (date) return base;
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
    date = addDays(day, (weekdays.indexOf(selected[0]) - weekday + 7) % 7 || 7);
  }
  if (text.includes('esta tarde')) date = day;
  if(!date && /^mejor por la (manana|tarde)[.!]?$/.test(text)
      && /^\d{4}-\d{2}-\d{2}$/.test(event.correlated_requested_date || '') && event.correlated_requested_date>=day)
    date=event.correlated_requested_date;
  const slot=absentTimeWindow(text.replace(/\b\d{4}-\d{2}-\d{2}\b/g,''),button?.payload);
  const window=slot.window || (date && event.flow_selection==='ABSENT_OTHER_DAY' && !/\b(no|imposible)\b/.test(text) && !/\d/.test(text.replace(/\b\d{4}-\d{2}-\d{2}\b/g,'')) ? 'DATE_ONLY':null);
  if (!window) return {...base,reason_code:slot.reason};
  if (!date) return {...base,requested_time_window:window,time_from:slot.from,time_to:slot.to,reason_code:'REQUESTED_DATE_MISSING'};
  return { ...base, customer_intent: 'RESCHEDULE_DELIVERY', requested_date: date, requested_time_window: window,
    time_from: slot.from, time_to:slot.to, all_day: window==='ALL_DAY', confidence: 1, reason_code: 'EXACT_CUSTOMER_SLOT' };
}
export { validateAbsentLogistics, simulateRecipientAbsent } from './absent-decision.mjs';
