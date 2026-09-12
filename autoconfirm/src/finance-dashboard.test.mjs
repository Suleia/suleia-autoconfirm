import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';

const dashboard = fs.readFileSync(new URL('../dashboard/index.html', import.meta.url), 'utf8');
const script = fs.readFileSync(new URL('../dashboard/main.js', import.meta.url), 'utf8');
const vendor = fs.readFileSync(new URL('../dashboard/vendor/echarts-6.1.0.min.js', import.meta.url));

test('finance dashboard loads the pinned ECharts build before its controller', () => {
  assert.match(dashboard, /vendor\/echarts-6\.1\.0\.min\.js[^]*dashboard\/main\.js/);
  assert.equal(crypto.createHash('sha512').update(vendor).digest('base64'), 'Uyq/AgtqFM4vT+unIGTDr4wMJDTUK9O5w2PXMQeBCSR8koqHpVz+qBmcQ+9Oeo5H+EmvT4pp/5QrsqhIbyjHTQ==');
});

test('finance dashboard exposes all requested analytical views', () => {
  for (const id of ['finance-trend-chart', 'finance-cumulative-chart', 'finance-funnel', 'finance-cost-chart', 'finance-history-chart', 'finance-days-table', 'finance-products-table']) {
    assert.match(dashboard, new RegExp(`id="${id}"`));
  }
  assert.match(script, /type: 'funnel'/);
  assert.match(script, /type: 'bar'/);
  assert.match(script, /PER_RETURNED_ORDER|pedido devuelto/);
});

test('returned orders and returned units remain separate in UI and calculations', () => {
  assert.match(dashboard, /id="finance-returned"/);
  assert.match(dashboard, /id="finance-returned-units"/);
  assert.match(script, /\['returnedUnits', 'Unidades devueltas'/);
  assert.match(dashboard, /tarifa es por pedido/);
});
