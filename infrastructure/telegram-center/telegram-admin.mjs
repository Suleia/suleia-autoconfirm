import { createApis } from './api.mjs';

// Run only on the server with the existing secret injected as an environment variable.
// No token in arguments, stdout, error stacks or Git. No messages are sent here.
async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('MISSING_TOKEN');
  const api = createApis({ botToken: token });
  const bot = await api.telegram('getMe');
  const webhook = await api.telegram('getWebhookInfo');
  const command = process.argv[2] || 'inspect';
  if (command === 'inspect') {
    console.log(JSON.stringify({ username: bot.username, botId: String(bot.id), webhookActive: Boolean(webhook.url), pendingUpdates: webhook.pending_update_count, lastWebhookErrorAt: webhook.last_error_date || null }));
    return;
  }
  if (command !== 'detach' || !process.argv.includes('--previous-consumer-disabled')) throw new Error('EXPLICIT_CUTOVER_REQUIRED');
  const expected = (process.env.TELEGRAM_EXPECTED_BOT_USERNAME || '').replace(/^@/, '').toLowerCase();
  if (!expected || bot.username?.toLowerCase() !== expected) throw new Error('BOT_IDENTITY_MISMATCH');
  await api.telegram('deleteWebhook', { drop_pending_updates: false });
  const after = await api.telegram('getWebhookInfo');
  if (after.url) throw new Error('WEBHOOK_NOT_REMOVED');
  console.log('Webhook removed and verified; pending updates preserved. Start the VPS service.');
}
main().catch(() => { console.error('Telegram administration failed; check configuration privately.'); process.exitCode = 1; });
