import { getAppConfig } from '../config.mjs';

const config = getAppConfig();

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function parseTemplateName(templateName) {
  const parts = String(templateName || '').trim().split(/\s+/);
  if (parts.length >= 2 && /^[a-z]{2}_[A-Z]{2}$/.test(parts[0])) {
    return { language: parts[0], name: parts.slice(1).join(' ') };
  }
  return { language: config.metaWhatsappLanguage || 'es_ES', name: parts.join(' ') };
}

function orderedBodyParams(params = {}) {
  return Object.entries(params)
    .map(([key, value]) => {
      const match = String(key).match(/^BODY_\{\{(\d+)\}\}$/);
      return match ? { index: Number(match[1]), value } : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.index - right.index)
    .map((item) => ({
      type: 'text',
      text: String(item.value ?? '')
    }));
}

export async function sendMetaWhatsappTemplate({ to, templateName, params = {} }) {
  if (!config.metaAccessToken) throw new Error('Falta META_ACCESS_TOKEN.');
  if (!config.metaWhatsappPhoneNumberId) throw new Error('Falta META_WHATSAPP_PHONE_NUMBER_ID.');

  const phone = digits(to);
  if (!phone) throw new Error('Falta telefono del cliente para WhatsApp.');

  const { language, name } = parseTemplateName(templateName);
  const bodyParams = orderedBodyParams(params);
  const components = bodyParams.length
    ? [{ type: 'body', parameters: bodyParams }]
    : [];

  const url = `https://graph.facebook.com/${config.metaApiVersion}/${config.metaWhatsappPhoneNumberId}/messages`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.metaAccessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: phone,
      type: 'template',
      template: {
        name,
        language: { code: language },
        ...(components.length ? { components } : {})
      }
    })
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok || data?.error) {
    throw new Error(`Meta WhatsApp respondio ${response.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  }

  return data;
}
