import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function queueHarness(api) {
  const source = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  const elements = new Map();
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, {
      hidden: false, textContent: '', disabled: false, children: [],
      setAttribute(name, value) { this[name] = value; },
      replaceChildren(...children) { this.children = children; },
    });
    return elements.get(id);
  };
  const rendered = [], notices = [], requests = [];
  const state = { view: 'orders', offset: 0, limit: 10, filters: {}, summary: null,
    queueRequest: 0, config: { refresh_interval_seconds: 45 } };
  const context = { state, URLSearchParams, AbortController, $: get,
    api(path, options) { requests.push(path); return api(path, options); },
    renderSummary() { rendered.push(structuredClone(state.summary)); }, renderFilters() {},
    rowOrder: item => item, rowIncident: item => item, date: value => value,
    showNotice: value => notices.push(value) };
  vm.runInNewContext(source.slice(source.indexOf('async function loadQueue()'), source.indexOf('\nfunction field(')), context);
  return { state, rendered, notices, requests, get, load: () => context.loadQueue() };
}

test('opening Orders after another section loads counters together with the queue', async () => {
  const summary = { orders: { pending: 13, with_customer_response: 5, no_response: 8 } };
  const h = queueHarness(async path => path === '/api/operations/summary'
    ? summary : { total: 13, items: [{ id: 'fixture-order' }] });
  await h.load();
  assert.deepEqual(h.state.summary, summary);
  assert.deepEqual(h.rendered.at(-1), summary);
  assert.equal(h.state.total, 13);
  assert.equal(h.get('table-body').children.length, 1);
  assert.equal(h.requests.filter(path => path === '/api/operations/summary').length, 1);
  assert.equal(h.get('queue-card')['aria-busy'], 'false');
});

test('a late Orders response cannot replace the active Incidents summary or rows', async () => {
  let completeSummary;
  const pendingSummary = new Promise(resolve => { completeSummary = resolve; });
  const h = queueHarness(async path => path === '/api/operations/summary'
    ? pendingSummary : { total: 13, items: [{ id: 'old-order' }] });
  const pending = h.load();
  h.state.view = 'incidents';
  h.state.summary = { incidents: { total: 7 } };
  completeSummary({ orders: { pending: 13 } });
  await pending;
  assert.deepEqual(h.state.summary, { incidents: { total: 7 } });
  assert.equal(h.rendered.length, 0);
  assert.equal(h.get('table-body').children.length, 0);
});

test('Incidents keeps its scoped summary and does not load the Orders summary', async () => {
  const h = queueHarness(async () => ({ total: 1, items: [{ id: 'fixture-issue' }], summary: { scope: 'ACTIVE', total: 1 } }));
  h.state.view = 'incidents';
  h.state.summary = { orders: { pending: 13 } };
  await h.load();
  assert.equal(h.requests.length, 1);
  assert.match(h.requests[0], /incidents\/overview/);
  assert.equal(h.state.summary.orders.pending, 13);
  assert.equal(h.state.summary.incidents.total, 1);
});

test('an unavailable Orders summary preserves the previous consistent display and exposes the failure', async () => {
  const h = queueHarness(async path => {
    if (path === '/api/operations/summary') throw new Error('Lectura no disponible');
    return { total: 99, items: [{ id: 'new-order' }] };
  });
  h.state.summary = { orders: { pending: 4 } };
  h.state.total = 4;
  await h.load();
  assert.equal(h.state.summary.orders.pending, 4);
  assert.equal(h.state.total, 4);
  assert.equal(h.rendered.length, 0);
  assert.equal(h.notices.at(-1), 'Lectura no disponible');
  assert.equal(h.get('queue-card')['aria-busy'], 'false');
});
