import crypto from 'node:crypto';

export const ABSENT_TEMPLATE_NAME = 'dropea_ausente_v1';
export const ABSENT_TEMPLATE_BODY = `Hola, {{1}}.

GLS nos indica que no ha podido entregarte tu pedido {{2}} porque no había nadie disponible en el momento de la entrega.

Para evitar que el paquete sea devuelto, indícanos cuándo te viene mejor recibirlo.

¿Qué opción prefieres?`;
export const ABSENT_BUTTONS = Object.freeze([
  Object.freeze({ text: 'Mañana por la mañana', payload: 'ABSENT_TOMORROW_AM' }),
  Object.freeze({ text: 'Mañana por la tarde', payload: 'ABSENT_TOMORROW_PM' }),
  Object.freeze({ text: 'Otra fecha u horario', payload: 'ABSENT_OTHER_SLOT' }),
  Object.freeze({ text: 'Recoger en agencia', payload: 'ABSENT_PICKUP_AGENCY' })
]);
export const ABSENT_FUTURE_RESPONSES = Object.freeze({
  ABSENT_TOMORROW_AM: 'Perfecto. Hemos registrado que prefieres recibirlo mañana por la mañana. Vamos a comprobar la disponibilidad de entrega y gestionar la solicitud.',
  ABSENT_TOMORROW_PM: 'Perfecto. Hemos registrado que prefieres recibirlo mañana por la tarde. Vamos a comprobar la disponibilidad de entrega y gestionar la nueva entrega.',
  ABSENT_OTHER_SLOT: 'Claro. Escríbenos qué día y a partir de qué hora puedes recibir el pedido. Por ejemplo: viernes a partir de las 16:00.',
  ABSENT_PICKUP_AGENCY: 'Perfecto. Vamos a comprobar si tu envío puede quedar disponible para recogida en agencia GLS. En cuanto tengamos la información validada, te indicaremos cómo proceder.'
});
export const ABSENT_LIVE_FLAGS = Object.freeze({ AUSENTE_AUTOMATION_LIVE: false,
  CHATBY_REAL_SENDS: false, DROPEA_ACTIONS_ENABLED: false, GLS_ACTIONS_ENABLED: false });
export function absentHash(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value), 'utf8').digest('hex');
}
export function validateAbsentTemplate(payload) {
  if (!/^dropea_ausente_v[12]$/.test(payload.name) || payload.language !== 'es_ES' || payload.category !== 'UTILITY') throw new Error('ABSENT_TEMPLATE_METADATA_INVALID');
  const body = payload.components.find(c => c.type === 'BODY');
  const buttons = payload.components.find(c => c.type === 'BUTTONS')?.buttons;
  if (payload.components.length !== 2 || body?.text !== ABSENT_TEMPLATE_BODY
    || JSON.stringify(buttons) !== JSON.stringify(ABSENT_BUTTONS.map(b => ({ type: 'QUICK_REPLY', text: b.text })))) throw new Error('ABSENT_TEMPLATE_CONTENT_INVALID');
  for (const text of [body.text, ...buttons.map(b => b.text)]) {
    if (text !== text.normalize('NFC') || /[\p{Cf}\p{Cs}\u00a0\u202f\ufffd\u2018-\u201f\u0000-\u0009\u000b-\u001f\u007f]|<[^>]*>|\\[nr]|[*_`]/u.test(text)) throw new Error('ABSENT_TEMPLATE_UNSAFE_CHARACTERS');
  }
  return Object.freeze({ body_hash: absentHash(body.text), buttons_hash: absentHash(buttons), unicode: 'NFC', character_validation: 'PASS', call_buttons: 0 });
}
export function absentTemplatePayload(name = ABSENT_TEMPLATE_NAME) {
  const payload = { name, language: 'es_ES', category: 'UTILITY', components: [
    { type: 'BODY', text: ABSENT_TEMPLATE_BODY, example: { body_text: [['Carlos', '1400000']] } },
    { type: 'BUTTONS', buttons: ABSENT_BUTTONS.map(b => ({ type: 'QUICK_REPLY', text: b.text })) }
  ] };
  validateAbsentTemplate(payload);
  return payload;
}
// Meta approval cannot grant execution. No operational adapter is exported.
export function assertAbsentShadowOnly() { return ABSENT_LIVE_FLAGS; }
