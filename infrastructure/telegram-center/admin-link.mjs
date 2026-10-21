import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.mjs';
import { createApis } from './api.mjs';

// Identification only. This module has no grant/revoke, sendMessage, Meta call,
// environment write, state save, service control or offset-advancement operation.
const fail = (code) => { throw new Error(`ADMIN_LINK_${code}`); };
const digest = (value) => createHash('sha256').update(value).digest('hex');
const policy = (config) => ({ writesEnabled: config.writesEnabled,
  maxBudgetCents: config.maxBudgetCents, maxChangePercent: config.maxChangePercent,
  proposalTtlMs: config.proposalTtlMs });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function createLinkRequest(config, bot, username, ownerId, now = Date.now()) {
  if (typeof username !== 'string' || !Number.isSafeInteger(now)) fail('USERNAME_INVALID');
  const expectedUsername = String(username).replace(/^@/, '').toLowerCase();
  if (!/^[a-z][a-z0-9_]{4,31}$/.test(expectedUsername)) fail('USERNAME_INVALID');
  if (!config.allowedUserIds.includes(String(ownerId))) fail('OWNER_NOT_ALLOWED');
  if (config.writesEnabled !== false) fail('WRITES_MUST_REMAIN_DISABLED');
  if (!bot?.is_bot || bot.username?.toLowerCase() !== config.expectedBotUsername) fail('BOT_MISMATCH');
  return { version: 1, requestId: randomBytes(8).toString('hex'), nonce: randomBytes(24).toString('base64url'),
    expectedUsername, ownerId: String(ownerId), botId: String(bot.id), botUsername: bot.username,
    createdAt: now, expiresAt: now + 600000, allowedUserIds: [...config.allowedUserIds], policy: policy(config) };
}

function checkRequest(request, config, now) {
  if (request?.version !== 1 || !/^[a-f0-9]{16}$/.test(request.requestId || '') ||
      !/^[A-Za-z0-9_-]{32}$/.test(request.nonce || '') ||
      !/^[a-z][a-z0-9_]{4,31}$/.test(request.expectedUsername || '') ||
      !Number.isSafeInteger(request.createdAt) || request.expiresAt !== request.createdAt + 600000 ||
      request.createdAt > now || now >= request.expiresAt) fail('REQUEST_INVALID_OR_EXPIRED');
  if (!same(request.allowedUserIds, config.allowedUserIds) || !same(request.policy, policy(config)) ||
      !config.allowedUserIds.includes(request.ownerId) || config.writesEnabled !== false ||
      request.botUsername?.toLowerCase() !== config.expectedBotUsername) fail('CONFIG_CHANGED');
}

function privateFreshMessage(update, request, now) {
  const m = update?.message;
  return Number.isSafeInteger(update?.update_id) && m && Number.isSafeInteger(m.message_id) &&
    Number.isSafeInteger(m.from?.id) && m.from.id > 0 && m.from.is_bot === false &&
    m.chat?.type === 'private' && m.chat.id === m.from.id &&
    !m.forward_origin && !m.forward_date && !m.is_automatic_forward && !m.sender_chat && !m.via_bot && !m.edit_date &&
    Number.isSafeInteger(m.date) && m.date * 1000 >= request.createdAt - 1000 &&
    now - m.date * 1000 <= 300000 && m.date * 1000 <= now + 60000;
}

// Uses only provider-delivered sender fields, never names/IDs inside message text.
export async function identifyCandidate({ request, config, updates, api, now = Date.now() }) {
  checkRequest(request, config, now);
  if (!Array.isArray(updates)) fail('UPDATES_INVALID');
  const fresh = updates.filter((u) => privateFreshMessage(u, request, now));
  const ownerText = `/vincular_admin ${request.nonce} @${request.expectedUsername}`;
  const owner = fresh.find((u) => String(u.message.from.id) === request.ownerId && u.message.text === ownerText);
  const candidates = fresh.filter((u) => u.message.text === `/start link_${request.nonce}` &&
    u.message.from.username?.toLowerCase() === request.expectedUsername &&
    !config.allowedUserIds.includes(String(u.message.from.id)));
  if (new Set(candidates.map((u) => u.message.from.id)).size > 1) fail('AMBIGUOUS_CANDIDATE');
  if (!owner || !candidates.length) return { status: 'WAITING_FOR_BOTH_PRIVATE_MESSAGES', requestId: request.requestId };
  const candidate = candidates.at(-1);
  const me = await api.telegram('getMe');
  const chat = await api.telegram('getChat', { chat_id: candidate.message.from.id });
  if (String(me?.id) !== request.botId || !me.is_bot ||
      me.username?.toLowerCase() !== request.botUsername.toLowerCase()) fail('BOT_MISMATCH');
  if (chat?.type !== 'private' || String(chat.id) !== String(candidate.message.from.id) ||
      chat.username?.toLowerCase() !== request.expectedUsername) fail('CANDIDATE_READBACK_MISMATCH');
  const evidence = (u) => ({ userId: String(u.message.from.id), chatId: String(u.message.chat.id),
    updateId: u.update_id, messageId: u.message.message_id, messageAt: new Date(u.message.date * 1000).toISOString() });
  return { version: 1, status: 'IDENTIFIED_AWAITING_ACTIVATION_APPROVAL', requestId: request.requestId,
    challengeDigest: digest(request.nonce), botId: request.botId, botUsername: request.botUsername,
    owner: evidence(owner), candidate: { ...evidence(candidate), username: chat.username },
    beforeAllowedUserIds: [...config.allowedUserIds], policy: policy(config),
    verifiedAt: now, expiresAt: request.expiresAt, productionChangeApplied: false };
}

export function planAddition(config, proof, now = Date.now()) {
  if (proof?.status !== 'IDENTIFIED_AWAITING_ACTIVATION_APPROVAL' || now >= proof.expiresAt ||
      !Number.isSafeInteger(proof.expiresAt) || proof.expiresAt > proof.verifiedAt + 600000 ||
      proof.verifiedAt > now || !Number.isSafeInteger(proof.verifiedAt) ||
      !/^[1-9]\d*$/.test(proof.candidate?.userId || '') ||
      proof.candidate.userId !== proof.candidate.chatId ||
      proof.owner?.userId !== proof.owner?.chatId || !config.allowedUserIds.includes(proof.owner.userId) ||
      !same(config.allowedUserIds, proof.beforeAllowedUserIds) || !same(policy(config), proof.policy) ||
      config.writesEnabled !== false || config.allowedUserIds.includes(proof.candidate.userId)) fail('PROOF_NOT_CURRENT');
  return { operation: 'APPEND_NUMERIC_ID_ONLY', ownerId: proof.owner.userId, candidateId: proof.candidate.userId,
    before: [...config.allowedUserIds], after: [...config.allowedUserIds, proof.candidate.userId],
    role: 'Existing uniform allowlist administrator',
    permissions: ['Meta read queries', 'Budget/pause proposals in simulation',
      'Confirm/cancel/reconcile own proposals', 'Shared action history and bot status'],
    commercialPanel: 'Not available in deployed legacy bot; web OAuth access is separate',
    unchangedPolicy: policy(config), requiresExplicitOwnerApproval: true, productionChangeApplied: false };
}

// One non-advancing queue read. The caller must hold the existing consumer lock.
export async function collectOnce({ request, config, api, offset, now = Date.now() }) {
  checkRequest(request, config, now);
  if (!Number.isSafeInteger(offset) || offset < 0) fail('OFFSET_INVALID');
  const webhook = await api.telegram('getWebhookInfo');
  if (webhook?.url) fail('OTHER_CONSUMER');
  const updates = await api.telegram('getUpdates', {
    offset, limit: 100, timeout: 0, allowed_updates: ['message', 'callback_query']
  });
  if (!Array.isArray(updates) || updates.some((u) => !Number.isSafeInteger(u.update_id) || u.update_id < offset)) fail('UPDATES_INVALID');
  return identifyCandidate({ request, config, updates, api, now });
}

function readPrivate(file) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || (stat.mode & 0o077) || stat.uid !== process.getuid()) fail('PRIVATE_FILE_REQUIRED');
    return fs.readFileSync(fd, 'utf8');
  } finally { fs.closeSync(fd); }
}
function writePrivate(file, value) {
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2)); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
}
function stopped() {
  const state = execFileSync('systemctl', ['show', 'suleia-telegram.service', '-p', 'ActiveState', '--value'], { encoding: 'utf8' }).trim();
  if (state !== 'inactive') fail('STOP_EXISTING_CONSUMER_FIRST');
}
async function main() {
  if (process.platform !== 'linux' || process.getuid() !== 0) fail('PRIVATE_ROOT_OPERATOR_REQUIRED');
  const [command, ...args] = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--env-file', '--request', '--output', '--username', '--owner-id'].includes(args[i]) || !args[i + 1] || options[args[i]]) fail('ARGUMENTS');
    options[args[i]] = args[i + 1];
  }
  if (!options['--request'] || !['prepare', 'collect'].includes(command)) fail('ARGUMENTS');
  const config = loadConfig(parseEnv(readPrivate(options['--env-file'] || '/etc/suleia/telegram.env')));
  const api = createApis(config);
  if (command === 'prepare') {
    const ownerId = options['--owner-id'] || (config.allowedUserIds.length === 1 ? config.allowedUserIds[0] : null);
    const request = createLinkRequest(config, await api.telegram('getMe'), options['--username'], ownerId);
    writePrivate(options['--request'], { ...request, instructions: {
      owner: `/vincular_admin ${request.nonce} @${request.expectedUsername}`,
      candidate: `https://t.me/${request.botUsername}?start=link_${request.nonce}`,
      note: 'Identification only, not permission approval. Send both messages only during the separately approved polling pause.' } });
    console.log(JSON.stringify({ status: 'PREPARED_ONLY', requestId: request.requestId, privateInstructionsFile: options['--request'] }));
    return;
  }
  if (!options['--output']) fail('ARGUMENTS');
  const request = JSON.parse(readPrivate(options['--request']));
  stopped();
  const lock = path.join(config.stateDir, 'process.lock');
  const fd = fs.openSync(lock, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, String(process.pid));
    stopped();
    const stateFile = path.join(config.stateDir, 'state.json');
    // The service account owns this file, so verify mode separately from readPrivate.
    if (!fs.existsSync(path.join(config.stateDir, 'initialized')) || (fs.statSync(stateFile).mode & 0o077)) fail('STATE_INVALID');
    const before = fs.readFileSync(stateFile);
    const state = JSON.parse(before);
    if (state.version !== 1 || String(state.identity?.botId) !== request.botId) fail('STATE_INVALID');
    const proof = await collectOnce({ request, config, api, offset: state.offset });
    if (!fs.readFileSync(stateFile).equals(before)) fail('STATE_CHANGED');
    if (proof.status === 'WAITING_FOR_BOTH_PRIVATE_MESSAGES') { console.log(JSON.stringify(proof)); return; }
    const plan = planAddition(config, proof);
    writePrivate(options['--output'], { proof, plan });
    console.log(JSON.stringify({ status: proof.status, requestId: proof.requestId, privateProofFile: options['--output'], productionChangeApplied: false }));
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main().catch((error) => {
    const code = /^ADMIN_LINK_[A-Z_]+$/.test(error.message) ? error.message : 'ADMIN_LINK_PRIVATE_REVIEW_REQUIRED';
    console.error(`${code}: no access granted and no production configuration changed.`); process.exitCode = 1;
  });
}
