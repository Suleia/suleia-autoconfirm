import { getAppConfig } from '../config.mjs';

const config = getAppConfig();

function apiUrl(method) {
  if (!config.telegramBotToken) throw new Error('Falta TELEGRAM_BOT_TOKEN.');
  return `https://api.telegram.org/bot${config.telegramBotToken}/${method}`;
}

async function telegramRequest(method, payload = {}) {
  const response = await fetch(apiUrl(method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.ok === false) {
    throw new Error(`Telegram ${method} respondio ${response.status}: ${JSON.stringify(data)}`);
  }
  return data?.result ?? data;
}

function chunks(text, size = 3600) {
  const value = String(text || '').trim() || 'Sin respuesta.';
  const result = [];
  for (let index = 0; index < value.length; index += size) {
    result.push(value.slice(index, index + size));
  }
  return result.length ? result : ['Sin respuesta.'];
}

export async function sendTelegramMessage({ chatId, text, replyToMessageId = null }) {
  if (!chatId) throw new Error('telegram_chat_id_required');
  const sent = [];
  for (const part of chunks(text)) {
    sent.push(await telegramRequest('sendMessage', {
      chat_id: chatId,
      text: part,
      disable_web_page_preview: true,
      ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {})
    }));
  }
  return sent;
}

export async function getTelegramMe() {
  return telegramRequest('getMe');
}

export async function setTelegramWebhook({ url, secretToken }) {
  if (!url) throw new Error('telegram_webhook_url_required');
  return telegramRequest('setWebhook', {
    url,
    allowed_updates: ['message'],
    drop_pending_updates: false,
    ...(secretToken ? { secret_token: secretToken } : {})
  });
}

export async function deleteTelegramWebhook() {
  return telegramRequest('deleteWebhook', { drop_pending_updates: false });
}
