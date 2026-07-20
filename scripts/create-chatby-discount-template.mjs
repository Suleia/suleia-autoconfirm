import { getAppConfig } from '../autoconfirm/src/config.mjs';
import {
  assertIncidentDiscountTemplateDisabled,
  incidentDiscountTemplatePayload
} from '../autoconfirm/src/workflows/incident-discount-template.mjs';

const config = getAppConfig();
assertIncidentDiscountTemplateDisabled(config);
if (!config.chatbyToken) throw new Error('Falta CHATBY_TOKEN.');

async function request(path, body) {
  const response = await fetch(`${config.chatbyBaseUrl.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.chatbyToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Chatby ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

const template = incidentDiscountTemplatePayload();
function templateItems(result) {
  const found = [];
  const visited = new Set();

  function visit(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 8 || visited.has(value)) return;
    visited.add(value);

    if (!Array.isArray(value) && typeof value.name === 'string') found.push(value);
    for (const child of Array.isArray(value) ? value : Object.values(value)) {
      visit(child, depth + 1);
    }
  }

  visit(result);
  return found;
}

let existing = null;
for (let page = 1; page <= 10 && !existing; page += 1) {
  const result = await request('/whatsapp-template/list', { page, limit: 200 });
  const items = templateItems(result);
  existing = items.find((item) => item?.name === template.name) || null;
  if (items.length === 0) break;
}

if (existing) {
  console.log(JSON.stringify({ ok: true, created: false, id: existing.id, waTemplateId: existing.wa_template_id, status: existing.status, name: existing.name }));
} else {
  const result = await request('/whatsapp-template/create', template);
  console.log(JSON.stringify({ ok: true, created: true, name: template.name, response: result }));
}
