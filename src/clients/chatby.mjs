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
  return request('/subscriber/send-whatsapp-template', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
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
