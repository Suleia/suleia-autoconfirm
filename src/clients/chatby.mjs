import { getAppConfig } from '../config.mjs';

const config = getAppConfig();

async function request(path, options = {}) {
  if (!config.chatbyToken) throw new Error('Falta CHATBY_TOKEN.');
  const response = await fetch(`${config.chatbyBaseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.chatbyToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    throw new Error(`Chatby respondió ${response.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  }
  return data;
}

export async function createSubscriber(payload) {
  return request('/subscriber/create', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function sendWhatsappTemplate(payload) {
  if (!payload.content) {
    payload = await buildWhatsappTemplatePayload(payload);
  }

  return request('/subscriber/send-whatsapp-template', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function listWhatsappTemplates() {
  const response = await request('/whatsapp-template/list', {
    method: 'POST',
    body: JSON.stringify({ page: 1, limit: 200 })
  });
  return response?.data ?? response;
}

function parseTemplateName(templateName) {
  const parts = String(templateName || '').trim().split(/\s+/);
  if (parts.length >= 2 && /^[a-z]{2}_[A-Z]{2}$/.test(parts[0])) {
    return { lang: parts[0], name: parts.slice(1).join(' ') };
  }
  return { lang: null, name: parts.join(' ') };
}

async function buildWhatsappTemplatePayload(payload) {
  const { lang, name } = parseTemplateName(payload.template_name || payload.templateName);
  const templates = await listWhatsappTemplates();
  const template = templates.find((item) => item.name === name && item.status === 'APPROVED')
    || templates.find((item) => item.name === name);

  if (!template) {
    throw new Error(`No se encontrÃ³ plantilla WhatsApp aprobada: ${name}`);
  }

  const defaultParams = template.default_values?.params && typeof template.default_values.params === 'object'
    ? template.default_values.params
    : {};

  const quickReplyParams = Object.fromEntries(
    Object.entries(defaultParams).filter(([key]) => key.startsWith('QUICK_REPLY_'))
  );

  return {
    user_ns: payload.user_ns,
    user_id: payload.user_id,
    content: {
      name: template.name,
      lang: template.default_values?.lang || template.language || lang || 'es_ES',
      namespace: template.namespace,
      params: {
        ...quickReplyParams,
        ...(payload.params || {})
      }
    }
  };
}

export async function getChatMessages(userNs) {
  const response = await request(`/subscriber/chat-messages?user_ns=${encodeURIComponent(userNs)}`, {
    method: 'GET'
  });
  return response?.data ?? response;
}

export async function listSubscribers({ page = 1, limit = 100 } = {}) {
  const response = await request(`/subscribers?limit=${limit}&page=${page}`, {
    method: 'GET'
  });
  return response?.data ?? response;
}

export async function deleteSubscriber(payload) {
  return request('/subscriber/delete', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}
