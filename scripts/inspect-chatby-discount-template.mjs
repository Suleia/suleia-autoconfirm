import { getAppConfig } from '../autoconfirm/src/config.mjs';
import { INCIDENT_DISCOUNT_TEMPLATE_NAME } from '../autoconfirm/src/workflows/incident-discount-template.mjs';

const config = getAppConfig();
if (!config.chatbyToken) throw new Error('Falta CHATBY_TOKEN.');

function collectTemplates(value) {
  const found = [];
  const visited = new Set();
  function visit(item, depth = 0) {
    if (!item || typeof item !== 'object' || depth > 10 || visited.has(item)) return;
    visited.add(item);
    if (!Array.isArray(item) && typeof item.name === 'string') found.push(item);
    for (const child of Array.isArray(item) ? item : Object.values(item)) visit(child, depth + 1);
  }
  visit(value);
  return found;
}

function normalized(value) {
  return String(value || '').toLowerCase().replace(/^es_es[_ -]*/, '').replace(/[^a-z0-9]+/g, '_');
}

const target = normalized(INCIDENT_DISCOUNT_TEMPLATE_NAME);
const candidates = new Map();
for (let page = 1; page <= 30; page += 1) {
  const response = await fetch(`${config.chatbyBaseUrl.replace(/\/$/, '')}/whatsapp-template/list`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.chatbyToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ page, limit: 200 })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Chatby ${response.status}: ${JSON.stringify(payload)}`);
  const items = collectTemplates(payload);
  for (const item of items) {
    const key = normalized(item.name);
    if (key === target || key.includes('incidencia_descuento_5')) {
      candidates.set(String(item.id || item.wa_template_id || item.name), {
        id: item.id || null,
        waTemplateId: item.wa_template_id || null,
        name: item.name,
        language: item.language || null,
        status: item.status || null,
        rejectedReason: item.rejected_reason || null
      });
    }
  }
  if (!items.length) break;
}

console.log(JSON.stringify({
  ok: true,
  requestedName: INCIDENT_DISCOUNT_TEMPLATE_NAME,
  candidates: [...candidates.values()]
}));
