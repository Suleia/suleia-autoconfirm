import crypto from 'node:crypto';

export const ABSENT_TEMPLATE_NAME = 'dropea_ausente_v3';
// Retirement affects future selection, not interpretation of historical events.
export const ABSENT_RETIRED_TEMPLATES = Object.freeze(['dropea_ausente_v1', 'dropea_ausente_v2']);
export const ABSENT_TEMPLATE_BODY = `👋 Hola, {{1}}

📦 *Queremos que recibas tu pedido cuanto antes*

GLS nos ha avisado de que hoy no ha podido entregarte tu pedido *{{2}}*, ya que no había nadie disponible en ese momento.

No te preocupes 💚 *tu pedido sigue en camino* y podemos organizar un nuevo intento de entrega.

✨ *¿Cuándo te viene mejor recibirlo?*`;
export const ABSENT_BUTTONS = Object.freeze([
  Object.freeze({ text: '☀️ Mañana por la mañana', payload: 'ABSENT_TOMORROW_MORNING' }),
  Object.freeze({ text: '🌙 Mañana por la tarde', payload: 'ABSENT_TOMORROW_AFTERNOON' }),
  Object.freeze({ text: '📅 Elegir otro día', payload: 'ABSENT_OTHER_DAY' }),
  Object.freeze({ text: '🏠 Cambiar datos', payload: 'ABSENT_CHANGE_DELIVERY_DATA' })
]);
// Four template buttons collapse behind WhatsApp's See-all control. Three
// visible buttons retain one-tap primary choices; secondary choices take two.
export const ABSENT_MORE_OPTIONS = Object.freeze({ text: 'Otro día o datos', payload: 'ABSENT_MORE_OPTIONS' });
// Actual Meta/Chatby create rejection: template button emojis are forbidden.
// Body emojis stay exact; session subflow choices remain separate preparations.
export const ABSENT_TEMPLATE_BUTTONS = Object.freeze([
  Object.freeze({ text:'Mañana por la mañana',payload:'ABSENT_TOMORROW_MORNING' }),
  Object.freeze({ text:'Mañana por la tarde',payload:'ABSENT_TOMORROW_AFTERNOON' }), ABSENT_MORE_OPTIONS
]);
export const ABSENT_LEGACY_BUTTONS = Object.freeze([
  Object.freeze({ text: 'Mañana por la mañana', payload: 'ABSENT_TOMORROW_AM', canonical: 'ABSENT_TOMORROW_MORNING' }),
  Object.freeze({ text: 'Mañana por la tarde', payload: 'ABSENT_TOMORROW_PM', canonical: 'ABSENT_TOMORROW_AFTERNOON' }),
  Object.freeze({ text: 'Otra fecha u horario', payload: 'ABSENT_OTHER_SLOT', canonical: 'ABSENT_OTHER_DAY' }),
  Object.freeze({ text: 'Recoger en agencia', payload: 'ABSENT_PICKUP_AGENCY', canonical: 'ABSENT_PICKUP_AGENCY' })
]);
const fold = s => String(s || '').normalize('NFC').toLocaleLowerCase('es').replace(/\s+/g, ' ').trim();
export function absentButtonFor(event = {}) {
  const payload = event.button_payload || event.payload?.payload || event.payload?.button_reply?.id || event.interactive?.button_reply?.id;
  const choices = [...ABSENT_BUTTONS, ...ABSENT_TEMPLATE_BUTTONS, ...ABSENT_LEGACY_BUTTONS];
  const button = choices.find(b => b.payload === payload);
  if (!button && String(payload || '').startsWith('ABSENT_')) return null;
  const labels = [event.raw_text,event.button_text,event.payload?.title,event.interactive?.button_reply?.title].filter(v=>typeof v==='string');
  const found = button || choices.find(b => labels.some(label=>fold(b.text)===fold(label)));
  return found ? { ...found, payload: found.canonical || found.payload } : null;
}
export const ABSENT_FUTURE_RESPONSES = Object.freeze({
  ABSENT_TOMORROW_MORNING: 'Preferencia registrada: mañana por la mañana. La nueva entrega queda pendiente de validación logística.',
  ABSENT_TOMORROW_AFTERNOON: 'Preferencia registrada: mañana por la tarde. La nueva entrega queda pendiente de validación logística.',
  ABSENT_OTHER_DAY: '📅 ¿Qué día puedes recibir tu pedido? Indica la fecha y, si lo necesitas, la franja horaria.',
  ABSENT_CHANGE_DELIVERY_DATA: '🏠 Indica qué datos de entrega necesitas corregir: vía y número, piso o puerta, código postal y localidad.',
  ABSENT_MORE_OPTIONS: '📅🏠 ¿Quieres elegir otro día o cambiar los datos de entrega?',
  ABSENT_PICKUP_AGENCY: 'Perfecto. Vamos a comprobar si tu envío puede quedar disponible para recogida en agencia GLS. En cuanto tengamos la información validada, te indicaremos cómo proceder.'
});
export function absentFollowUpPreparation(button, binding = {}) {
  if (!ABSENT_FUTURE_RESPONSES[button]) return null;
  const buttons = button === 'ABSENT_MORE_OPTIONS' ? ABSENT_BUTTONS.slice(2).map(b => ({
    type: 'reply', reply: { id: b.payload, title: b.text }
  })) : [];
  return { flow: button, binding, text: ABSENT_FUTURE_RESPONSES[button],
    interactive: buttons.length ? { type: 'button', body: { text: ABSENT_FUTURE_RESPONSES[button] }, action: { buttons } } : null,
    execution_status: 'PREPARED_SHADOW_ONLY', messages_sent: 0 };
}
export function absentTemplateSelection(name = ABSENT_TEMPLATE_NAME) {
  return { template_name: name, selected: name === ABSENT_TEMPLATE_NAME,
    retired: ABSENT_RETIRED_TEMPLATES.includes(name), customer_send_enabled: false };
}
export const ABSENT_LIVE_FLAGS = Object.freeze({ AUSENTE_AUTOMATION_LIVE: false,
  CHATBY_REAL_SENDS: false, DROPEA_ACTIONS_ENABLED: false, GLS_ACTIONS_ENABLED: false });
export function absentHash(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value), 'utf8').digest('hex');
}
export function validateAbsentTemplate(payload) {
  if (payload.name !== ABSENT_TEMPLATE_NAME || payload.language !== 'es_ES' || payload.category !== 'UTILITY') throw new Error('ABSENT_TEMPLATE_METADATA_INVALID');
  const body = payload.components.find(c => c.type === 'BODY');
  const buttons = payload.components.find(c => c.type === 'BUTTONS')?.buttons;
  if (payload.components.length !== 2 || body?.text !== ABSENT_TEMPLATE_BODY
    || JSON.stringify(buttons) !== JSON.stringify(ABSENT_TEMPLATE_BUTTONS.map(b => ({ type: 'QUICK_REPLY', text: b.text })))) throw new Error('ABSENT_TEMPLATE_CONTENT_INVALID');
  if (buttons.length > 3 || buttons.some(b => b.text.length > 25) || new Set(buttons.map(b => b.text)).size !== buttons.length) throw new Error('ABSENT_TEMPLATE_BUTTON_LIMIT');
  if (buttons.some(b=>/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\n*]/u.test(b.text))) throw new Error('ABSENT_TEMPLATE_BUTTON_EMOJI_OR_FORMAT_UNSUPPORTED');
  if (body.text.length > 1024 || body.text.includes('**') || (body.text.match(/\*/g) || []).length !== 8) throw new Error('ABSENT_TEMPLATE_FORMAT_INVALID');
  for (const text of [body.text, ...buttons.map(b => b.text)]) {
    if (text !== text.normalize('NFC') || /[\p{Cf}\p{Cs}\u00a0\u202f\ufffd\u2018-\u201f\u0000-\u0009\u000b-\u001f\u007f]|<[^>]*>|\\[nr]|[_`]/u.test(text)
      || Buffer.from(text, 'utf8').toString('utf8') !== text) throw new Error('ABSENT_TEMPLATE_UNSAFE_CHARACTERS');
  }
  return Object.freeze({ body_hash: absentHash(body.text), buttons_hash: absentHash(buttons), unicode: 'NFC', character_validation: 'PASS', call_buttons: 0, template_buttons: 3, button_emojis_supported:false, all_options_inline: false, primary_options_inline: true });
}
export function absentTemplatePayload(name = ABSENT_TEMPLATE_NAME) {
  const payload = { name, language: 'es_ES', category: 'UTILITY', components: [
    { type: 'BODY', text: ABSENT_TEMPLATE_BODY, example: { body_text: [['Carlos', '1400000']] } },
    { type: 'BUTTONS', buttons: ABSENT_TEMPLATE_BUTTONS.map(b => ({ type: 'QUICK_REPLY', text: b.text })) }
  ] };
  validateAbsentTemplate(payload);
  return payload;
}
// Meta approval cannot grant execution. No operational adapter is exported.
export function assertAbsentShadowOnly() { return ABSENT_LIVE_FLAGS; }
