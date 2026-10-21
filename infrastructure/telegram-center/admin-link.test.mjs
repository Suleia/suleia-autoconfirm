import test from 'node:test';
import assert from 'node:assert/strict';
import { createLinkRequest, identifyCandidate, collectOnce, planAddition } from './admin-link.mjs';
import { Controller } from './controller.mjs';
import { loadConfig } from './config.mjs';

const now = Date.UTC(2026, 9, 21, 12);
const bot = { id: 99, is_bot: true, username: 'example_bot' };
function fixture() {
  const config = { expectedBotUsername: 'example_bot', allowedUserIds: ['7'], writesEnabled: false,
    maxBudgetCents: 10000, maxChangePercent: 10, proposalTtlMs: 300000, accountId: 'act_123' };
  const request = createLinkRequest(config, bot, '@Second_admin', '7', now);
  const msg = (id, text, username, updateId) => ({ update_id: updateId, message: {
    message_id: updateId, text, date: now / 1000, from: { id, username, is_bot: false }, chat: { id, type: 'private' } } });
  const updates = [msg(7, `/vincular_admin ${request.nonce} @second_admin`, 'owner_example', 100),
    msg(8, `/start link_${request.nonce}`, 'Second_admin', 101)];
  const calls = [];
  const api = { telegram: async (method, body) => {
    calls.push({ method, body });
    if (method === 'getMe') return bot;
    if (method === 'getChat') return { id: 8, type: 'private', username: 'Second_admin' };
    if (method === 'getWebhookInfo') return { url: '' };
    if (method === 'getUpdates') return updates;
    throw Error('Unexpected outbound operation');
  } };
  const identify = () => identifyCandidate({ request, config, updates, api, now });
  return { config, request, updates, api, calls, identify };
}

test('fresh private provider sender + existing administrator consent + readback produce a plan only', async () => {
  const f = fixture(); const before = structuredClone(f.config);
  const proof = await f.identify(); const plan = planAddition(f.config, proof, now);
  assert.equal(proof.status, 'IDENTIFIED_AWAITING_ACTIVATION_APPROVAL');
  assert.equal(proof.owner.userId, '7'); assert.equal(proof.candidate.userId, '8');
  assert.equal(proof.candidate.username, 'Second_admin'); assert.equal(proof.productionChangeApplied, false);
  assert.equal(JSON.stringify(proof).includes(f.request.nonce), false);
  assert.deepEqual(plan.before, ['7']); assert.deepEqual(plan.after, ['7', '8']);
  assert.equal(plan.requiresExplicitOwnerApproval, true); assert.equal(plan.productionChangeApplied, false);
  assert.equal(plan.unchangedPolicy.writesEnabled, false); assert.deepEqual(f.config, before);
  assert.deepEqual(f.calls.map((c) => c.method), ['getMe', 'getChat']);
});

for (const condition of ['noOwner', 'wrongOwner', 'ownerGroup', 'candidateGroup', 'botSender', 'wrongChat',
  'forwarded', 'edited', 'viaBot', 'stale', 'future', 'wrongNonce', 'wrongUsername', 'missingUsername', 'alreadyAllowed']) {
  test(`identity remains unverified: ${condition}`, async () => {
    const f = fixture(); const owner = f.updates[0].message, candidate = f.updates[1].message;
    if (condition === 'noOwner') f.updates.shift();
    if (condition === 'wrongOwner') { owner.from.id = 9; owner.chat.id = 9; }
    if (condition === 'ownerGroup') owner.chat.type = 'group';
    if (condition === 'candidateGroup') candidate.chat.type = 'supergroup';
    if (condition === 'botSender') candidate.from.is_bot = true;
    if (condition === 'wrongChat') candidate.chat.id = 9;
    if (condition === 'forwarded') candidate.forward_origin = { type: 'user', sender_user: { id: 8 } };
    if (condition === 'edited') candidate.edit_date = now / 1000;
    if (condition === 'viaBot') candidate.via_bot = { id: 9 };
    if (condition === 'stale') candidate.date -= 301;
    if (condition === 'future') candidate.date += 61;
    if (condition === 'wrongNonce') candidate.text += 'x';
    if (condition === 'wrongUsername') candidate.from.username = 'someone_else';
    if (condition === 'missingUsername') delete candidate.from.username;
    if (condition === 'alreadyAllowed') { candidate.from.id = 7; candidate.chat.id = 7; }
    assert.equal((await f.identify()).status, 'WAITING_FOR_BOTH_PRIVATE_MESSAGES');
    assert.deepEqual(f.calls, []);
  });
}

test('claimed username in text, callback or forwarded sender never substitutes provider from fields', async () => {
  const f = fixture(); f.updates[1] = { update_id: 101, callback_query: {
    from: { id: 8, username: 'Second_admin' }, message: f.updates[1].message,
    data: `/start link_${f.request.nonce}` } };
  assert.equal((await f.identify()).status, 'WAITING_FOR_BOTH_PRIVATE_MESSAGES');
});

test('multiple distinct numeric IDs using the target username fail closed', async () => {
  const f = fixture(); const other = structuredClone(f.updates[1]);
  other.message.from.id = other.message.chat.id = 9; other.update_id = 102;
  f.updates.push(other); await assert.rejects(f.identify, /AMBIGUOUS_CANDIDATE/);
});

test('provider readback must still bind numeric private chat and target username to the pinned bot', async () => {
  for (const change of ['username', 'chatId', 'chatType', 'botId']) {
    const f = fixture();
    f.api.telegram = async (method) => method === 'getMe'
      ? { ...bot, id: change === 'botId' ? 98 : 99 }
      : { id: change === 'chatId' ? 9 : 8, type: change === 'chatType' ? 'group' : 'private', username: change === 'username' ? 'someone_else' : 'Second_admin' };
    await assert.rejects(f.identify, /MISMATCH/);
  }
});

test('expired, altered-policy or changed allowlist requests fail before Telegram reads', async () => {
  for (const change of ['expiry', 'writes', 'limit', 'allowlist']) {
    const f = fixture();
    if (change === 'expiry') f.request.createdAt -= 600000, f.request.expiresAt -= 600000;
    if (change === 'writes') f.config.writesEnabled = true;
    if (change === 'limit') f.config.maxChangePercent = 20;
    if (change === 'allowlist') f.config.allowedUserIds.push('9');
    await assert.rejects(f.identify, /ADMIN_LINK_/); assert.deepEqual(f.calls, []);
  }
});

test('the maintenance collector reads one batch at the durable offset, with no send or advancing acknowledgement', async () => {
  const f = fixture();
  const proof = await collectOnce({ request: f.request, config: f.config, api: f.api, offset: 100, now });
  assert.equal(proof.candidate.userId, '8');
  assert.deepEqual(f.calls.map((c) => c.method), ['getWebhookInfo', 'getUpdates', 'getMe', 'getChat']);
  assert.deepEqual(f.calls[1].body, { offset: 100, limit: 100, timeout: 0, allowed_updates: ['message', 'callback_query'] });
});

test('webhook, invalid offset and out-of-range updates block collection', async () => {
  const f = fixture();
  await assert.rejects(() => collectOnce({ request: f.request, config: f.config, api: f.api, offset: -1, now }), /OFFSET_INVALID/);
  f.api.telegram = async () => ({ url: 'https://example.invalid/webhook' });
  await assert.rejects(() => collectOnce({ request: f.request, config: f.config, api: f.api, offset: 100, now }), /OTHER_CONSUMER/);
  const g = fixture();
  await assert.rejects(() => collectOnce({ request: g.request, config: g.config, api: g.api, offset: 101, now }), /UPDATES_INVALID/);
});

test('addition plan expires and cannot replace an administrator, relax policy or accept a changed allowlist', async () => {
  const f = fixture(); const proof = await f.identify();
  assert.throws(() => planAddition(f.config, proof, proof.expiresAt), /PROOF_NOT_CURRENT/);
  const altered = structuredClone(proof); altered.owner.userId = '9';
  assert.throws(() => planAddition(f.config, altered, now), /PROOF_NOT_CURRENT/);
  const badExpiry = structuredClone(proof); delete badExpiry.expiresAt;
  assert.throws(() => planAddition(f.config, badExpiry, now), /PROOF_NOT_CURRENT/);
  f.config.allowedUserIds.push('9');
  assert.throws(() => planAddition(f.config, proof, now), /PROOF_NOT_CURRENT/);
});

test('username or unallowlisted owner cannot prepare a grant and writes must remain off', () => {
  const f = fixture();
  assert.throws(() => createLinkRequest(f.config, bot, '@second_admin', 'someone'), /OWNER_NOT_ALLOWED/);
  assert.throws(() => createLinkRequest(f.config, bot, undefined, '7'), /USERNAME_INVALID/);
  assert.throws(() => createLinkRequest({ ...f.config, writesEnabled: true }, bot, '@second_admin', '7'), /WRITES_MUST_REMAIN_DISABLED/);
  const env = { TELEGRAM_ALLOWED_USER_IDS: '7,8', TELEGRAM_BOT_TOKEN: 'test', TELEGRAM_EXPECTED_BOT_USERNAME: 'example_bot',
    META_ACCESS_TOKEN: 'test', META_AD_ACCOUNT_ID: '123', META_API_VERSION: 'v25.0' };
  assert.deepEqual(loadConfig(env).allowedUserIds, ['7', '8']);
  assert.throws(() => loadConfig({ ...env, TELEGRAM_ALLOWED_USER_IDS: '7,@second_admin' }), /IDs numéricos/);
});

test('both allowlisted administrators have equivalent reads and independent, bounded simulated proposals', async () => {
  const f = fixture(); f.config.allowedUserIds.push('8');
  const state = { proposals: {}, audit: [], conversations: {} };
  const store = { state, save() {}, record(e) { state.audit.push(e); } };
  const sent = []; const calls = [];
  const api = { ...f.api, send: async (id, text) => sent.push({ id, text }),
    account: async () => ({ id: 'act_123', name: 'Example', currency: 'EUR', timezone_name: 'Europe/Madrid' }),
    campaign: async () => ({ id: '55', account_id: '123', name: 'Example', status: 'ACTIVE', daily_budget: '3000' }),
    campaigns: async () => [], insights: async () => [], mutate: async () => calls.push('UNEXPECTED_WRITE') };
  const c = new Controller({ config: f.config, store, api, now: () => now });
  for (const text of ['/start', '/resumen hoy', '/campanas', '/analizar', '/estado', '/historial']) {
    const left = await c.command(text, 7, 7), right = await c.command(text, 8, 8);
    assert.equal(left.text, right.text);
  }
  for (const user of [7, 8]) {
    const update = { update_id: user, message: { date: now / 1000, from: { id: user }, chat: { id: user, type: 'private' }, text: '/presupuesto 55 32' } };
    assert.equal((await c.handle(update)).authorized, true);
  }
  const [a, b] = Object.values(state.proposals);
  assert.equal(a.userId, '7'); assert.equal(b.userId, '8'); assert.equal(a.state, 'PENDING');
  await assert.rejects(() => c.confirm(a.code, 8, 8), /no autorizada/);
  await assert.rejects(() => c.confirm(b.code, 7, 7), /no autorizada/);
  for (const p of [a, b]) { assert.match(await c.confirm(p.code, p.userId, p.chatId), /Simulación/); await c.confirm(p.code, p.userId, p.chatId); }
  assert.equal(state.proposals[a.code].state, 'SIMULATED'); assert.equal(state.proposals[b.code].state, 'SIMULATED');
  for (const user of [7, 8]) {
    await assert.rejects(() => c.propose('budget', '55', '101', user, user), /límite diario/);
    await assert.rejects(() => c.propose('budget', '55', '35', user, user), /límite de 10%/);
  }
  assert.deepEqual(calls, []); assert.equal(sent.length, 2);
  // Existing audit codes resolve to the exact actor in durable proposals.
  for (const event of state.audit) assert.ok(['7', '8'].includes(state.proposals[event.code].userId));
  f.config.allowedUserIds = ['7'];
  assert.equal(c.authorized({ chat: { type: 'private', id: 8 }, from: { id: 8 } }), false);
  assert.equal(c.authorized({ chat: { type: 'private', id: 7 }, from: { id: 7 } }), true);
});
