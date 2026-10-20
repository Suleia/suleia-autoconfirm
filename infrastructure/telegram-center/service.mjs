import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { loadConfig } from './config.mjs';
import { Store } from './store.mjs';
import { createApis } from './api.mjs';
import { Controller } from './controller.mjs';

export async function preflight(config, api) {
  const bot = await api.telegram('getMe');
  if (!bot?.is_bot || bot.username?.toLowerCase() !== config.expectedBotUsername) throw new Error('BOT_IDENTITY_MISMATCH');
  const webhook = await api.telegram('getWebhookInfo');
  if (webhook.url) throw new Error('WEBHOOK_STILL_ACTIVE: detener el consumidor anterior y retirar el webhook antes de iniciar polling');
  const account = await api.account();
  if (account.id !== config.accountId) throw new Error('META_ACCOUNT_MISMATCH');
  if (!account.timezone_name || !account.currency) throw new Error('META_ACCOUNT_METADATA_MISSING');
  await api.campaigns(); // Verify read access; deliberately does not test mutations.
  return { botId: String(bot.id), accountId: account.id };
}

export async function run(config, api, store, { signal, checkOnly = false } = {}) {
  const identity = await preflight(config, api);
  if (store.state.identity && JSON.stringify(store.state.identity) !== JSON.stringify(identity)) throw new Error('STATE_IDENTITY_MISMATCH');
  store.state.identity = identity; store.save();
  if (checkOnly) { store.health({ ok: true, mode: 'PREFLIGHT_ONLY' }); return; }
  const controller = new Controller({ config, api, store });
  store.health({ ok: true, mode: config.writesEnabled ? 'CONFIRMED_ACTIONS' : 'READ_ONLY' });
  while (!signal?.aborted) {
    try {
      const updates = await api.telegram('getUpdates', {
        offset: store.state.offset, limit: 20, timeout: 25, allowed_updates: ['message', 'callback_query']
      });
      if (!Array.isArray(updates)) throw new Error('TELEGRAM_UPDATES_INVALID');
      for (const update of updates) {
        if (signal?.aborted) break;
        if (!Number.isSafeInteger(update.update_id) || update.update_id < store.state.offset) continue;
        await controller.handle(update);
        store.state.offset = update.update_id + 1; store.save();
      }
      store.health({ ok: true, mode: config.writesEnabled ? 'CONFIRMED_ACTIONS' : 'READ_ONLY' });
    } catch (error) {
      // No raw exception/URL/body logging: transport URLs contain bot credentials.
      store.health({ ok: false, code: error.service ? `${error.service}_${error.status}` : 'LOCAL_OR_STORAGE_FAILURE' });
      if ([401, 403, 404, 409].includes(error.status) || !error.service) throw new Error('STOPPED_FOR_REVIEW');
      await delay(Math.min(60000, Math.max(5000, (error.retryAfter || 0) * 1000)), undefined, { signal }).catch(() => {});
    }
  }
  store.health({ ok: false, code: 'STOPPED' });
}

async function main() {
  if (process.argv.includes('--healthcheck')) {
    const dir = process.env.STATE_DIRECTORY || '/var/lib/suleia-telegram';
    const health = JSON.parse(fs.readFileSync(path.join(dir, 'health.json'), 'utf8'));
    const age = Date.now() - Date.parse(health.at);
    if (!health.ok || !Number.isFinite(age) || age < -5000 || age > 120000 || health.mode === 'PREFLIGHT_ONLY') process.exitCode = 1;
    return;
  }
  const config = loadConfig();
  const store = new Store(config.stateDir);
  const abort = new AbortController();
  const stop = () => abort.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try { await run(config, createApis(config), store, { signal: abort.signal, checkOnly: process.argv.includes('--check') }); }
  finally { store.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('Telegram service stopped. Review private health state and configuration; credentials are never logged.'); process.exitCode = 1; });
}
