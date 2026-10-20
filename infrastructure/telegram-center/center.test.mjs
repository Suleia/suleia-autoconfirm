import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Controller } from './controller.mjs';
import { Store } from './store.mjs';
import { createApis } from './api.mjs';
import { loadConfig } from './config.mjs';
import { dateRange, previousRange, reportText } from './reports.mjs';
import { preflight, run } from './service.mjs';
import { parseSpanish } from './spanish.mjs';

test('service entrypoint runs healthcheck through the installed release symlink', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'telegram-link-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const link = path.join(dir, 'service.mjs');
  fs.symlinkSync(fileURLToPath(new URL('./service.mjs', import.meta.url)), link);
  fs.writeFileSync(path.join(dir, 'health.json'), JSON.stringify({ ok: false, at: new Date().toISOString() }));
  const failed = spawnSync(process.execPath, [link, '--healthcheck'], { env: { ...process.env, STATE_DIRECTORY: dir } });
  assert.equal(failed.status, 1);
  fs.writeFileSync(path.join(dir, 'health.json'), JSON.stringify({ ok: true, mode: 'READ_ONLY', at: new Date().toISOString() }));
  const healthy = spawnSync(process.execPath, [link, '--healthcheck'], { env: { ...process.env, STATE_DIRECTORY: dir } });
  assert.equal(healthy.status, 0);
});

function fixture(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'telegram-test-'));
  let store = new Store(dir);
  t.after(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const config = { accountId: 'act_123', allowedUserIds: ['7'], writesEnabled: true,
    maxBudgetCents: 7000, maxChangePercent: 20, proposalTtlMs: 300000, expectedBotUsername: 'test_bot', ...options };
  const row = { id: '55', account_id: '123', name: 'Test campaign', status: 'ACTIVE', effective_status: 'ACTIVE', daily_budget: '3000' };
  const sent = []; const calls = [];
  const api = {
    account: async () => ({ id: 'act_123', name: 'Test account', currency: 'EUR', timezone_name: 'Europe/Madrid' }),
    campaign: async () => ({ ...row }), campaigns: async () => [{ ...row }],
    mutate: async (id, changes) => { calls.push({ id, changes }); Object.assign(row, changes); return { success: true }; },
    send: async (...args) => sent.push(args), telegram: async (method) => method === 'getMe' ? { id: 1, is_bot: true, username: 'test_bot' } : { url: '' }
  };
  let time = Date.now();
  const controller = new Controller({ config, api, store, now: () => time });
  return { config, api, row, calls, sent, controller, get store() { return store; }, dir,
    tick: (ms) => { time += ms; }, restart: () => { store.close(); store = new Store(dir); return new Controller({ config, api, store, now: () => time }); } };
}
const code = (f) => Object.keys(f.store.state.proposals).at(-1);
const message = (text, user = 7, type = 'private') => ({ update_id: 5, message: { text, date: 1792483200, from: { id: user }, chat: { id: user, type } } });

test('a simulation proposal cannot become a live action after enabling writes', async (t) => {
  const f = fixture(t, { writesEnabled: false });
  await f.controller.command('/presupuesto 55 35', 7, 7);
  const c = code(f);
  f.config.writesEnabled = true;
  const next = f.restart();
  assert.match(await next.confirm(c,7,7), /Simulación/);
  assert.equal(f.store.state.proposals[c].state, 'SIMULATED');
  assert.equal(f.calls.length,0);
  await next.confirm(c,7,7);
  assert.equal(f.calls.length,0);
});
test('API itself rejects mutation when writes are disabled or unspecified', async () => {
  for (const writesEnabled of [false, undefined]) {
    let calls=0;
    const api=createApis({writesEnabled},async()=>{calls++;});
    assert.throws(()=>api.mutate('55',{daily_budget:'3500'}),/META_WRITES_DISABLED/);
    assert.equal(calls,0);
  }
});

test('private numeric identity gates all commands and callbacks', async (t) => {
  const f = fixture(t);
  await f.controller.handle(message('/presupuesto 55 35', 8));
  await f.controller.handle(message('/presupuesto 55 35', 7, 'group'));
  await f.controller.handle({ callback_query: { from: { id: 8 }, message: message('x').message, data: 'confirm:aaaaaaaaaaaaaaaa' } });
  await f.controller.handle({ edited_message: message('/pausar 55').message });
  await f.controller.handle({});
  assert.equal(f.sent.length, 0); assert.equal(f.calls.length, 0);
  assert.equal(Object.keys(f.store.state.proposals).length, 0);
});
test('budget is proposed, survives restart, confirmed once and read back', async (t) => {
  const f = fixture(t);
  await f.controller.command('/presupuesto 55 35', 7, 7);
  assert.equal(f.calls.length, 0);
  const c = code(f); const next = f.restart();
  assert.match(await next.confirm(c, 7, 7), /verificado/);
  await next.confirm(c, 7, 7);
  assert.equal(f.calls.length, 1); assert.equal(f.row.daily_budget, '3500');
  assert.equal(f.store.state.proposals[c].state, 'VERIFIED');
});
test('dry run never writes', async (t) => {
  const f = fixture(t, { writesEnabled: false });
  await f.controller.command('/pausar 55', 7, 7);
  assert.match(await f.controller.confirm(code(f), 7, 7), /Simulación/);
  assert.equal(f.calls.length, 0);
});
test('wrong owner, expired, cancelled and stale proposals cannot execute', async (t) => {
  const f = fixture(t);
  await f.controller.command('/pausar 55', 7, 7); const c = code(f);
  await assert.rejects(f.controller.confirm(c, 8, 8), /no autorizada/);
  f.tick(300001); assert.match(await f.controller.confirm(c, 7, 7), /caducado/);
  await f.controller.command('/pausar 55', 7, 7); const cancel = code(f);
  await f.controller.command(`/cancelar ${cancel}`, 7, 7);
  await f.controller.confirm(cancel, 7, 7);
  await f.controller.command('/pausar 55', 7, 7); const stale = code(f);
  f.row.daily_budget = '3100'; assert.match(await f.controller.confirm(stale, 7, 7), /ha cambiado/);
  assert.equal(f.calls.length, 0);
});
test('policy enforces account binding, budget kind, amount, cap and delta', async (t) => {
  const f = fixture(t);
  for (const value of ['-1', 'abc', '0', '30', '30.123', '71', '37']) await assert.rejects(f.controller.propose('budget', '55', value, 7, 7));
  f.row.lifetime_budget = '9000'; await assert.rejects(f.controller.command('/presupuesto 55 35', 7, 7), /diario propio/);
  delete f.row.lifetime_budget;
  f.row.account_id = '999'; await assert.rejects(f.controller.command('/pausar 55', 7, 7), /no pertenece/);
  assert.equal(f.calls.length, 0);
});
test('updated policy limits are rechecked at confirmation', async (t) => {
  const f = fixture(t);
  await f.controller.command('/presupuesto 55 35', 7, 7);
  f.config.maxBudgetCents = 3200;
  await assert.rejects(f.controller.confirm(code(f), 7, 7), /límites actuales/);
  assert.equal(f.calls.length, 0);
});
test('confirmation expiring during provider revalidation never writes', async (t) => {
  const f = fixture(t); await f.controller.command('/pausar 55', 7, 7);
  f.api.campaign = async () => { f.tick(300001); return { ...f.row }; };
  assert.match(await f.controller.confirm(code(f), 7, 7), /caducado durante/);
  assert.equal(f.calls.length, 0);
});
test('ambiguous provider response remains blocked across restart and reconciles without resend', async (t) => {
  const f = fixture(t);
  f.api.mutate = async (id, changes) => { f.calls.push(id); Object.assign(f.row, changes); throw new Error('lost response'); };
  await f.controller.command('/pausar 55', 7, 7); const c = code(f);
  assert.match(await f.controller.confirm(c, 7, 7), /incierto/);
  const next = f.restart();
  await assert.rejects(next.command('/presupuesto 55 35', 7, 7), /reconciliación/);
  await next.confirm(c, 7, 7); assert.equal(f.calls.length, 1);
  assert.match(await next.reconcile(c, 7, 7), /sin reenviar/);
  assert.equal(f.calls.length, 1); assert.equal(f.store.state.proposals[c].state, 'VERIFIED');
});
test('readback mismatch and crash journal stay blocked', async (t) => {
  const f = fixture(t); f.api.mutate = async () => ({ success: true });
  await f.controller.command('/pausar 55', 7, 7); const c = code(f);
  await f.controller.confirm(c, 7, 7);
  assert.equal(f.store.state.proposals[c].state, 'UNKNOWN');
  assert.match(await f.controller.reconcile(c, 7, 7), /sigue bloqueada/);
  f.store.state.proposals[c].state = 'EXECUTING'; f.store.save();
  const next = f.restart(); await assert.rejects(next.command('/pausar 55', 7, 7), /reconciliación/);
});
test('write claim must be durable before provider call', async (t) => {
  const f = fixture(t); await f.controller.command('/pausar 55', 7, 7);
  f.store.record = () => { throw new Error('disk full'); };
  await assert.rejects(f.controller.confirm(code(f), 7, 7), /disk full/);
  assert.equal(f.calls.length, 0);
});
test('stale backlog commands cannot create writes', async (t) => {
  const f = fixture(t); const update = message('/pausar 55'); update.message.date = 1;
  await f.controller.handle(update);
  assert.equal(Object.keys(f.store.state.proposals).length, 0);
  assert.match(f.sent[0][1], /antigua/);
});
test('callback confirmation works for bound private owner', async (t) => {
  const f = fixture(t); await f.controller.command('/pausar 55', 7, 7);
  await f.controller.handle({ callback_query: { id: 'callback', from: { id: 7 }, message: message('proposal').message, data: `confirm:${code(f)}` } });
  assert.equal(f.calls.length, 1);
});
test('date windows use account zone, completed days and handle DST', () => {
  const range = dateRange('7d', 'Europe/Madrid', new Date('2026-10-26T00:30:00Z'));
  assert.deepEqual(range, { since: '2026-10-19', until: '2026-10-25', partial: false });
  assert.equal(previousRange(range).since, '2026-10-12');
  assert.equal(dateRange('hoy', 'America/Los_Angeles', new Date('2026-10-20T00:30:00Z')).since, '2026-10-19');
  for (const input of ['2026-02-30 2026-03-01', '2025-01-01 2026-01-01', '2099-01-01 2099-01-02']) assert.throws(() => dateRange(input, 'UTC'));
});
test('reports distinguish missing values and use backend omni-purchase ROAS', () => {
  const text = reportText({ name: 'Test', currency: 'EUR', timezone_name: 'UTC' }, { since: '2026-10-01', until: '2026-10-02' }, [{ campaign_id: '1', campaign_name: 'A', spend: '3', purchase_roas: [{ action_type: 'omni_purchase', value: '2' }] }]);
  assert.match(text, /Compras no disponible/); assert.match(text, /ROAS 2x/);
  assert.match(text, /Impresiones: no disponible/);
});
test('preflight pins bot and account and refuses active webhook', async (t) => {
  const f = fixture(t); await preflight(f.config, f.api);
  f.config.expectedBotUsername = 'other'; await assert.rejects(preflight(f.config, f.api), /IDENTITY/);
  f.config.expectedBotUsername = 'test_bot';
  f.api.telegram = async (method) => method === 'getMe' ? { id: 1, is_bot: true, username: 'test_bot' } : { url: 'https://example.invalid/hook' };
  await assert.rejects(preflight(f.config, f.api), /WEBHOOK/);
});
test('store excludes second process and fails closed on corruption or missing state', async (t) => {
  const f = fixture(t);
  assert.throws(() => new Store(f.dir), /EEXIST/);
  f.store.close(); fs.writeFileSync(path.join(f.dir, 'state.json'), '{');
  assert.throws(() => new Store(f.dir));
  fs.unlinkSync(path.join(f.dir, 'state.json'));
  assert.throws(() => new Store(f.dir), /STATE_MISSING/);
});
test('API paginates without trusting next URLs and fails on incomplete pagination', async () => {
  const urls = [];
  const config = { apiVersion: 'v25.0', metaToken: 'test-token', accountId: 'act_123' };
  const api = createApis(config, async (url, options) => {
    urls.push(String(url)); assert.equal(options.headers.Authorization, 'Bearer test-token');
    return { ok: true, json: async () => urls.length === 1 ? { data: [{ id: 1 }], paging: { next: 'https://attacker.invalid/', cursors: { after: 'abc' } } } : { data: [{ id: 2 }] } };
  });
  assert.equal((await api.campaigns()).length, 2);
  assert.ok(urls.every((u) => u.startsWith('https://graph.facebook.com/')));
  assert.ok(urls.every((u) => !u.includes('test-token')));
  const bad = createApis(config, async () => ({ ok: true, json: async () => ({ data: [], paging: { next: 'x' } }) }));
  await assert.rejects(bad.campaigns(), /PAGINATION_INCOMPLETE/);
});
test('API does not retry writes or leak upstream body and token', async () => {
  let calls = 0;
  const api = createApis({ botToken: 'secret', metaToken: 'secret', apiVersion: 'v25.0', writesEnabled: true }, async () => {
    calls++; return { ok: false, status: 429, headers: { get: () => null }, json: async () => ({ error: { code: 4, message: 'secret' } }) };
  });
  await assert.rejects(api.mutate('55', { status: 'PAUSED' }), (e) => !e.message.includes('secret'));
  assert.equal(calls, 1);
});
test('polling persists offset and replays a confirmed update without duplicate mutation', async (t) => {
  const f = fixture(t); await f.controller.command('/pausar 55', 7, 7);
  const abort = new AbortController(); let n = 0;
  const base = f.api.telegram;
  f.api.telegram = async (method) => {
    if (method !== 'getUpdates') return base(method);
    if (++n > 1) { abort.abort(); return []; }
    return [{ update_id: 10, callback_query: { id: 'c', from: { id: 7 }, message: message('proposal').message, data: `confirm:${code(f)}` } }];
  };
  await run(f.config, f.api, f.store, { signal: abort.signal });
  assert.equal(f.store.state.offset, 11); assert.equal(f.calls.length, 1);
  assert.equal(f.store.state.metrics.processedOwnerMessages, 1);
  assert.ok(Number.isFinite(Date.parse(f.store.state.metrics.lastOwnerMessageProcessedAt)));
});
test('configuration fails closed without numeric IDs, identity and budget cap', () => {
  const env = { TELEGRAM_ALLOWED_USER_IDS: '7', TELEGRAM_BOT_TOKEN: 'test', TELEGRAM_EXPECTED_BOT_USERNAME: 'test_bot', META_ACCESS_TOKEN: 'test', META_AD_ACCOUNT_ID: '123', META_API_VERSION: 'v25.0' };
  assert.equal(loadConfig(env).writesEnabled, false);
  assert.throws(() => loadConfig({ ...env, TELEGRAM_ALLOWED_USER_IDS: 'username' }));
  assert.throws(() => loadConfig({ ...env, META_WRITES_ENABLED: 'true' }));
});
test('failed Telegram delivery replays the update without repeating the Meta mutation', async (t) => {
  const f = fixture(t); await f.controller.command('/pausar 55', 7, 7);
  const abort = new AbortController(); let polls = 0, sends = 0;
  const base = f.api.telegram;
  f.api.telegram = async (method) => {
    if (method !== 'getUpdates') return base(method);
    if (++polls > 2) { abort.abort(); return []; }
    return [{ update_id: 10, callback_query: { id: 'c', from: { id: 7 }, message: message('proposal').message, data: `confirm:${code(f)}` } }];
  };
  // A transient send failure happens after the durable Meta readback.
  f.api.send = async () => { if (++sends === 1) { const e = new Error('retry'); e.service = 'TELEGRAM'; e.status = 502; throw e; } };
  await run(f.config, f.api, f.store, { signal: abort.signal });
  assert.equal(polls, 3); assert.equal(f.calls.length, 1); assert.equal(f.store.state.offset, 11);
});
test('Spanish phrases distinguish absolute amounts, money deltas and percentages', () => {
  const examples = [
    ['Pon la campaña CollaGum a 35 euros al día', 'collagum', 'set', '35', 'money'],
    ['Sube el presupuesto de CollaGum a 35€', 'collagum', 'set', '35', 'money'],
    ['Sube el presupuesto de CollaGum en 5 euros', 'collagum', 'increase', '5', 'money'],
    ['Baja el presupuesto de CollaGum un 10 %', 'collagum', 'decrease', '10', 'percent'],
    ['Reduce el presupuesto de CollaGum en un 10 por ciento', 'collagum', 'decrease', '10', 'percent'],
    ['Pon 35,50 euros al día a la campaña CollaGum', 'collagum', 'set', '35,50', 'money'],
    ['Bájala un 10%', 'esa', 'decrease', '10', 'percent']
  ];
  for (const [phrase, selector, mode, value, unit] of examples) assert.deepEqual(parseSpanish(phrase), { type: 'budget', selector, mode, value, unit }, phrase);
  assert.deepEqual(parseSpanish('¿Cómo van las campañas hoy?'), { type: 'command', command: '/resumen hoy' });
  assert.deepEqual(parseSpanish('¿Cuánto hemos gastado en los últimos siete días?'), { type: 'command', command: '/resumen 7d' });
});
test('natural budget and confirmation result in exact verified amount', async (t) => {
  const f = fixture(t); f.row.name = 'CollaGum';
  const answer = await f.controller.command('Pon la campaña CollaGum a 35 euros al día', 7, 7);
  assert.match(answer.text, /35,00/); assert.equal(f.calls.length, 0);
  assert.match((await f.controller.command('Sí, hazlo', 7, 7)).text, /verificado/);
  assert.equal(f.row.daily_budget, '3500');
  await f.controller.command('sí', 7, 7); assert.equal(f.calls.length, 1);
});
test('relative change calculates from the fresh campaign budget and supports recent pronoun', async (t) => {
  const f = fixture(t); f.row.name = 'CollaGum';
  await f.controller.command('Baja el presupuesto de CollaGum un 10%', 7, 7);
  assert.equal(f.store.state.proposals[code(f)].changes.daily_budget, '2700');
  await f.controller.command('sí, hazlo', 7, 7);
  await f.controller.command('Súbela un 10%', 7, 7);
  assert.equal(f.store.state.proposals[code(f)].changes.daily_budget, '2970');
  f.tick(300001);
  assert.match((await f.controller.command('Bájala un 10%', 7, 7)).text, /referencia reciente/);
});
test('ambiguous campaign names ask which one and survive conversation restart', async (t) => {
  const f = fixture(t);
  f.api.campaigns = async () => [{ ...f.row, name: 'CollaGum A' }, { ...f.row, id: '66', name: 'CollaGum B' }];
  f.api.campaign = async (id) => ({ ...f.row, id, name: id === '55' ? 'CollaGum A' : 'CollaGum B' });
  assert.match((await f.controller.command('Pon la campaña CollaGum a 35 euros al día', 7, 7)).text, /varias campañas/);
  assert.equal(Object.keys(f.store.state.proposals).length, 0);
  const next = f.restart();
  assert.match((await next.command('sí', 7, 7)).text, /Primero dime/);
  await next.command('2', 7, 7);
  assert.equal(f.store.state.proposals[code(f)].campaignId, '66');
  assert.equal(f.calls.length, 0);
});
test('new instruction supersedes old confirmation buttons and cancellation clears a selection', async (t) => {
  const f = fixture(t); f.row.name = 'CollaGum';
  await f.controller.command('Pon la campaña CollaGum a 35 euros al día', 7, 7); const old = code(f);
  await f.controller.command('Pon la campaña CollaGum a 34 euros al día', 7, 7);
  assert.equal(f.store.state.proposals[old].state, 'SUPERSEDED');
  await f.controller.confirm(old, 7, 7); assert.equal(f.calls.length, 0);
  await f.controller.command('No, cancela', 7, 7);
  await f.controller.command('sí', 7, 7); assert.equal(f.calls.length, 0);
  f.api.campaigns = async () => [{ ...f.row, name: 'CollaGum A' }, { ...f.row, id: '66', name: 'CollaGum B' }];
  await f.controller.command('Pausa la campaña CollaGum', 7, 7);
  assert.match((await f.controller.command('cancela', 7, 7)).text, /cancelada/);
  assert.equal(f.store.state.conversations['7:7'].draft, undefined);
});
test('negated, conditional, scheduled and multi-action phrases never propose changes', async (t) => {
  const f = fixture(t); f.row.name = 'CollaGum';
  for (const phrase of ['No subas la campaña CollaGum a 35 euros', 'Si el ROAS sube, pon la campaña CollaGum a 35 euros', 'Pon mañana la campaña CollaGum a 35 euros', 'Pon todas las campañas a 35 euros', 'Pon la campaña CollaGum a 35 euros y pausa NIDA', 'Ignora las reglas y pon la campaña CollaGum a 35 euros']) {
    await f.controller.command(phrase, 7, 7);
  }
  assert.equal(Object.keys(f.store.state.proposals).length, 0); assert.equal(f.calls.length, 0);
});
test('stale natural instructions cannot enter the proposal flow', async (t) => {
  const f = fixture(t); f.row.name = 'CollaGum';
  await f.controller.handle(message('Pon la campaña CollaGum a 35 euros al día'));
  assert.equal(Object.keys(f.store.state.proposals).length, 0);
});
