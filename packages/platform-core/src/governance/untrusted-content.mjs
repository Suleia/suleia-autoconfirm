import crypto from 'node:crypto';
import { maskRecord } from '../masking.mjs';
import { deepFreeze } from './contracts.mjs';

const FREE_TEXT_KEY = /(?:^|_)(?:customer_text|carrier_text|operator_text|external_text|text|message|note|comment|description|content|body|prompt)(?:$|_)/i;
const PHONE = /(?<!\d)(?:\+?34)?[6789]\d{8}(?!\d)/;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const ADDRESS = /\b(?:calle|c\/|avenida|avda|plaza|paseo|carretera|camino|piso|puerta|portal|postal|direccion|address|street|road|avenue)\b/i;
const NAME_HINT = /\b(?:me llamo|mi nombre es|soy|name is|i am)\s+[\p{L}]/iu;

const INJECTION_RULES = Object.freeze([
  ['CHANGE_INSTRUCTIONS', /(?:ignora|ignore|olvida|forget).{0,30}(?:instrucciones|instructions|reglas|rules|anterior|previous)/i],
  ['PRIVILEGE_ESCALATION', /(?:eleva|elevate|grant|concede).{0,30}(?:privileg|admin|root|permission|rol)/i],
  ['IGNORE_POLICIES', /(?:ignora|ignore|omite|bypass).{0,30}(?:politic|policy|policies|controles|controls)/i],
  ['EXECUTE_CODE', /(?:ejecuta|execute|run).{0,25}(?:codigo|code|comando|command|shell|powershell|cmd|sql)/i],
  ['REVEAL_SECRETS', /(?:revela|reveal|muestra|show|dime|print).{0,30}(?:secreto|secret|token|password|api.?key|clave)/i],
  ['ALTER_LOGS', /(?:borra|delete|altera|alter|modifica|rewrite).{0,25}(?:log|logs|auditoria|audit|trace)/i],
  ['DISABLE_CONTROLS', /(?:desactiva|disable|apaga|turn off|omite|bypass).{0,30}(?:control|seguridad|safety|proteccion|guardrail|masking)/i],
  ['SYSTEM_IMPERSONATION', /(?:system\s*(?:prompt|message)|mensaje\s+del\s+sistema|\[system\]|<system>)/i],
  ['ROLE_REDEFINITION', /(?:ahora eres|you are now|actua como|act as|nuevo rol|new role)/i]
]);

function normalize(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't');
}

function detectionForms(value) {
  const normalized = normalize(value);
  return [normalized.replace(/[^a-z0-9]+/g, ' ').trim(), normalized.replace(/[^a-z0-9]+/g, '')];
}

function matchesRule(rule, forms) {
  return forms.some((form) => rule.test(form));
}

function lengthBucket(length) {
  if (length === 0) return 'EMPTY';
  if (length <= 80) return 'SHORT';
  if (length <= 500) return 'MEDIUM';
  return 'LONG';
}

function detectIntents(value) {
  const text = normalize(value).replace(/[^a-z0-9]+/g, ' ').trim();
  const intents = [];
  if (/\b(?:cancelar|cancela|cancelacion|no quiero el pedido|no quiero recibirlo|ya no quiero recibirlo|return order|cancel order)\b/.test(text)) {
    intents.push('CANCELLATION_REQUEST');
  }
  if (/\b(?:entrega|reparto|delivery).{0,30}(?:hora|horario|manana|tarde|morning|afternoon|time)\b/.test(text)) {
    intents.push('DELIVERY_TIME_REQUEST');
  }
  if (/\b(?:cambiar|cambio|nueva|correcta).{0,20}(?:direccion|address)\b/.test(text)) {
    intents.push('ADDRESS_CHANGE_REQUEST');
  }
  if (/\b(?:descuento|rebaja|discount)\b/.test(text)) intents.push('DISCOUNT_REQUEST');

  const conditionalAcceptance = /\b(?:si\s+)?(?:quiero|deseo)\s+recibirlo\s+pero\s+no\s+hoy\b/.test(text);
  const acceptanceExcluded = /\b(?:no\s+se\s+si\s+quiero|no\s+quiero|ya\s+no\s+quiero)\s+recibirlo\b/.test(text)
    || /\btransportista\s+dice\s+que\s+quiere\s+recibirlo\b/.test(text)
    || /\bpreguntaba\s+si\s+podia\s+recibirlo\b/.test(text);
  const positiveAcceptance = /\b(?:si\s+)?(?:quiero|deseo)\s+recibirlo\b/.test(text)
    || /\b(?:si\s+)?quiero\s+el\s+pedido\b/.test(text)
    || /\bquiero\s+que\s+me\s+lo\s+entreguen\b/.test(text)
    || /\bpueden\s+traerlo\b/.test(text)
    || /\b(?:confirmo|acepto\s+el\s+pedido|confirm\s+order)\b/.test(text);
  if (conditionalAcceptance) intents.push('DELIVERY_ACCEPTANCE_CONDITIONAL');
  else if (positiveAcceptance && !acceptanceExcluded) intents.push('ORDER_CONFIRMATION');
  return [...new Set(intents)];
}

export function summarizeUntrustedText(value, {
  source = 'UNTRUSTED_EXTERNAL_SOURCE',
  sourceMessageId = null,
  observedAt = null
} = {}) {
  const text = String(value ?? '');
  const forms = detectionForms(text);
  const detectedIntents = detectIntents(text);
  const injectionIndicators = INJECTION_RULES.filter(([, rule]) => matchesRule(rule, forms)).map(([indicator]) => indicator);
  const containsPromptInjection = injectionIndicators.length > 0;
  return deepFreeze({
    sanitization_schema_version: '1.0.0',
    customer_signal: {
      detected_intents: detectedIntents,
      contains_phone: PHONE.test(text),
      contains_email: EMAIL.test(text),
      contains_address: ADDRESS.test(text),
      contains_name: NAME_HINT.test(text),
      contains_prompt_injection: containsPromptInjection,
      text_retained: false,
      normalized_length_bucket: lengthBucket([...text].length),
      source_message_hash: crypto.createHash('sha256').update(text).digest('hex'),
      source_message_id: sourceMessageId,
      source,
      observed_at: observedAt
    },
    untrusted_content_detected: containsPromptInjection ? {
      type: 'PROMPT_INJECTION',
      severity: 'HIGH',
      indicators: injectionIndicators,
      source,
      content_retained: false,
      handling: 'IGNORED_AS_INSTRUCTION'
    } : null
  });
}

function isSanitizedSummary(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const signal = value.customer_signal;
  return value.sanitization_schema_version === '1.0.0'
    && signal && typeof signal === 'object' && !Array.isArray(signal)
    && signal.text_retained === false
    && typeof signal.contains_phone === 'boolean'
    && typeof signal.contains_email === 'boolean'
    && typeof signal.contains_address === 'boolean'
    && typeof signal.contains_name === 'boolean'
    && typeof signal.contains_prompt_injection === 'boolean'
    && Array.isArray(signal.detected_intents)
    && signal.detected_intents.every((intent) => typeof intent === 'string')
    && /^[a-f0-9]{64}$/.test(signal.source_message_hash);
}

export function minimizeUntrustedPayload(value, options = {}) {
  if (Array.isArray(value)) return value.map((item) => minimizeUntrustedPayload(item, options));
  if (!value || typeof value !== 'object') return typeof value === 'string' ? value : value;
  if (isSanitizedSummary(value)) return structuredClone(value);
  const minimized = Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (FREE_TEXT_KEY.test(key) && typeof item === 'string') {
      return [key, summarizeUntrustedText(item, {
        ...options,
        source: value.source ?? options.source,
        sourceMessageId: value.source_message_id ?? value.message_id ?? options.sourceMessageId,
        observedAt: value.observed_at ?? value.occurred_at ?? options.observedAt
      })];
    }
    if (FREE_TEXT_KEY.test(key) && Array.isArray(item)) {
      return [key, item.map((entry) => typeof entry === 'string'
        ? summarizeUntrustedText(entry, { ...options, source: value.source ?? options.source })
        : minimizeUntrustedPayload(entry, options))];
    }
    if (typeof item === 'string') return [key, maskRecord({ [key]: item })[key]];
    return [key, minimizeUntrustedPayload(item, options)];
  }));
  return minimized;
}

export function collectUntrustedContentSignals(value, signals = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectUntrustedContentSignals(item, signals));
  } else if (value && typeof value === 'object') {
    if (value.customer_signal?.source_message_hash) signals.push(value);
    else Object.values(value).forEach((item) => collectUntrustedContentSignals(item, signals));
  }
  return signals;
}
