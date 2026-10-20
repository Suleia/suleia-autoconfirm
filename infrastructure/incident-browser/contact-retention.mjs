import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { decide, phone } from './contact-retention-policy.mjs';
import { contactRequestSpacing } from './contact-retention-rate.mjs';

// Isolated from incident decisions and message delivery. Deploy in the persistent
// /state mount; provider credentials stay in the existing private secret store.
const root = '/state/contact-retention';
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const write = (name, value) => {
  const target = path.join(root, name);
  fs.writeFileSync(`${target}.tmp`, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(`${target}.tmp`, target);
};
const read = name => {
  try { return JSON.parse(fs.readFileSync(path.join(root, name), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
};
const hash = value => createHash('sha256').update(String(value)).digest('hex');
const emit = data => console.log(JSON.stringify(data));
const journal = data => fs.appendFileSync(path.join(root, 'journal.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), ...data })}\n`, { mode: 0o600 });
const execute = process.argv.includes('--execute');
const due = process.argv.includes('--due');
const previous = read('schedule.json');
if (due && previous && Date.now() < Date.parse(previous.nextRunAt)) process.exit(0);

let lastChat = 0;
let chatSpacing = 8000;
async function chat(endpoint, method = 'GET', body) {
  await pause(Math.max(0, chatSpacing - (Date.now() - lastChat)));
  lastChat = Date.now();
  const response = await fetch(`${process.env.CHATBY_BASE_URL || 'https://app.chatby.io/api'}${endpoint}`, {
    method, headers: { Authorization: `Bearer ${process.env.CHATBY_TOKEN}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(45000),
  });
  chatSpacing = contactRequestSpacing(response.headers);
  if (!response.ok) {
    const error=Error(`CHATBY_HTTP_${response.status}`);
    if(response.status===429){
      const seconds=Number(response.headers.get('retry-after'));
      error.retryAt=new Date(Date.now()+Math.max(60000,Number.isFinite(seconds)&&seconds>0?seconds*1000:20*60000)).toISOString();
    }
    throw error;
  }
  const data = await response.json();
  if (data.status === 'error' || data.success === false || data.error) throw Error('CHATBY_API_ERROR');
  return data;
}
async function contacts() {
  const all = [], seen = new Set();
  for (let page = 1; page <= 200; page++) {
    const response = await chat(`/subscribers?limit=100&page=${page}`);
    if (!Array.isArray(response.data)) throw Error('CONTACT_SCHEMA');
    for (const contact of response.data) {
      if (!contact.user_ns || seen.has(contact.user_ns)) throw Error('CONTACT_PAGINATION_INVALID');
      seen.add(contact.user_ns); all.push(contact);
    }
    if (response.data.length < 100) return all;
  }
  throw Error('CONTACT_PAGINATION_INCOMPLETE');
}

async function main() {
  const { loadProviderEnv } = await import('/app/worker.mjs');
  await loadProviderEnv();
  const { createDropeaV2IncidentClient, loadDropeaV2IncidentStoreConfigs } = await import('/autoconfirm/src/clients/dropea-v2-incidents.mjs');
  const stores = loadDropeaV2IncidentStoreConfigs();
  if (stores.length !== 1) throw Error('STORE_AMBIGUOUS');
  const client = createDropeaV2IncidentClient(stores[0]);
  let orders, issues, refreshedAt;
  async function refresh() {
    orders = (await client.listAll('listOrders', {
      store_id: Number(stores[0].store_id), sort_by: 'created_at', sort_order: 'asc',
      date_from: '2020-01-01T00:00:00Z', date_to: new Date().toISOString(), date_type: 'created_at',
    }, { maxPages: 200, maxRecords: 20000 })).items;
    issues = (await client.listAll('listIssues', {}, { maxPages: 200, maxRecords: 20000 })).items;
    refreshedAt = Date.now();
  }
  await refresh();
  const all = await contacts();
  const phones = new Set(all.map(c => phone(c.phone || c.user_id)).filter(Boolean));
  // The list endpoint omits return timestamps. Read details, never infer return
  // completion from a rejection or from a return request.
  for (let i = 0; i < orders.length; i++) {
    if ((['REFUSED', 'RETURNED'].includes(orders[i].sub_status)
        || (['DELIVERED','PAID'].includes(orders[i].sub_status)
          && issues.some(issue => String(issue.order_id) === String(orders[i].id) && issue.status !== 'RESOLVED')))
        && phones.has(phone(orders[i].shipping_address?.phone_number))) {
      const detail = (await client.request('getOrder', { id: orders[i].id })).data;
      if (!detail || String(detail.id) !== String(orders[i].id)) throw Error('ORDER_SCHEMA');
      orders[i] = detail;
    }
  }
  // Never repeat an ambiguous DELETE. Reconcile it against the complete inventory.
  const pending = read('pending.json');
  if (pending) {
    if (!Array.isArray(pending)) throw Error('PENDING_SCHEMA');
    if (all.some(c => pending.some(p => hash(c.user_ns) === p.contactHash))) throw Error('PREVIOUS_DELETE_NEEDS_REVIEW');
    for (const event of pending) journal({ ...event, result: 'reconciled_absent' });
    fs.unlinkSync(path.join(root, 'pending.json'));
  }
  const counts = {}, candidates = [];
  for (const contact of all) {
    const decision = decide(contact, orders, issues);
    counts[decision.reason] = (counts[decision.reason] || 0) + 1;
    if (decision.eligible) candidates.push({ contact, decision });
  }
  const summary = { startedAt: new Date().toISOString(), mode: execute ? 'execute' : 'dry_run', contacts: all.length, orders: orders.length, candidates: candidates.length, counts, deleted: 0, skipped: 0 };
  write('latest.json', summary); emit(summary);
  if (!execute) return;
  const completed = [];
  let unverified = [];
  async function verify() {
    const remaining = await contacts();
    const hashes = new Set(remaining.map(c => hash(c.user_ns)));
    if (unverified.some(event => hashes.has(event.contactHash))) throw Error('DELETE_VERIFICATION_FAILED');
    for (const event of unverified) journal({ ...event, result: 'verified_absent' });
    completed.push(...unverified); unverified = [];
    fs.unlinkSync(path.join(root, 'pending.json'));
    summary.deleted = completed.length;
    summary.updatedAt = new Date().toISOString(); write('latest.json', summary);
    emit({ deleted: completed.length, candidates: candidates.length, skipped: summary.skipped });
  }
  for (const candidate of candidates) {
    // Refresh all associations at least once a minute, including newly created orders.
    if (Date.now() - refreshedAt > 60000) await refresh();
    const current = (await chat(`/subscriber/get-info?user_ns=${encodeURIComponent(candidate.contact.user_ns)}`)).data;
    if (!current || current.user_ns !== candidate.contact.user_ns) throw Error('CONTACT_CHANGED');
    const freshOrder = (await client.request('getOrder', { id: candidate.decision.orderId })).data;
    if (!freshOrder || String(freshOrder.id) !== String(candidate.decision.orderId)) throw Error('ORDER_SCHEMA');
    const recent = (await client.listAll('listOrders', {
      store_id: Number(stores[0].store_id), sort_by: 'created_at', sort_order: 'asc',
      date_from: new Date(refreshedAt - 60000).toISOString(), date_to: new Date().toISOString(), date_type: 'created_at',
    }, { maxPages: 200, maxRecords: 20000 })).items;
    const combined = new Map(orders.map(o => [String(o.id), o]));
    for (const order of recent) combined.set(String(order.id), order);
    combined.set(String(freshOrder.id), freshOrder);
    // Preserve timestamp evidence only by rereading affected terminal orders,
    // never by carrying stale details across inventory refreshes.
    for (const order of combined.values()) {
      if (String(order.id)!==String(freshOrder.id)
          && phone(order.shipping_address?.phone_number)===phone(current.phone||current.user_id)
          && ['DELIVERED','PAID'].includes(order.sub_status)
          && issues.some(i=>String(i.order_id)===String(order.id)&&i.status!=='RESOLVED')) {
        const detail=(await client.request('getOrder',{id:order.id})).data;
        if(!detail||String(detail.id)!==String(order.id))throw Error('ORDER_SCHEMA');
        combined.set(String(order.id),detail);
      }
    }
    const currentOrders = [...combined.values()];
    const decision = decide(current, currentOrders, issues);
    if (!decision.eligible || String(decision.orderId) !== String(candidate.decision.orderId)) { summary.skipped++; continue; }
    const event = { contactHash: hash(current.user_ns), orderId: decision.orderId, reason: decision.reason };
    // Private backup is written successfully before the irreversible API call.
    write(`backup-${event.contactHash}.json`, { at: new Date().toISOString(), contact: current, order: freshOrder });
    unverified.push(event);
    write('pending.json', unverified); journal({ ...event, result: 'attempting' });
    let response;
    try { response = await chat('/subscriber/delete', 'DELETE', { user_ns: current.user_ns }); }
    catch(error){
      if(error.message==='CHATBY_HTTP_429'){
        // Explicit throttle rejection means this DELETE was not accepted.
        // Prior accepted mutations still require absence reconciliation.
        unverified.pop();
        if(unverified.length)write('pending.json',unverified);
        else fs.unlinkSync(path.join(root,'pending.json'));
        journal({...event,result:'rate_limit_rejected'});
      }
      throw error;
    }
    if (!['ok', 'success'].includes(String(response.status).toLowerCase()) && response.success !== true) throw Error('DELETE_RESPONSE_AMBIGUOUS');
    journal({ ...event, result: 'api_success' });
    // First deletion immediately, then bounded batches. Any uncertain DELETE
    // remains journalled and stops retries until absence has been reconciled.
    if (completed.length === 0 || unverified.length >= 25) await verify();
  }
  if (unverified.length) await verify();
  summary.finishedAt = new Date().toISOString();
  write('latest.json', summary);
  write('schedule.json', { lastSuccessAt: summary.finishedAt, nextRunAt: new Date(Date.now() + 72 * 3600000).toISOString() });
  emit(summary);
}
main().catch(error => {
  const safeError = /^[A-Z_0-9]+$/.test(error.message) ? error.message : 'RUN_FAILED';
  write('failure.json', { at: new Date().toISOString(), error: safeError });
  if(error.retryAt)write('schedule.json',{...read('schedule.json'),nextRunAt:error.retryAt,retryReason:safeError});
  emit({ error: safeError }); process.exitCode = 1;
});
