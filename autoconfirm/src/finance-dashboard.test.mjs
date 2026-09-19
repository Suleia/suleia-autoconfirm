import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';

const dashboard = fs.readFileSync(new URL('../dashboard/index.html', import.meta.url), 'utf8');
const script = fs.readFileSync(new URL('../dashboard/main.js', import.meta.url), 'utf8');
const vendor = fs.readFileSync(new URL('../dashboard/vendor/echarts-6.1.0.min.js', import.meta.url), 'utf8');

test('finance dashboard loads the pinned ECharts build before its controller', () => {
  assert.match(dashboard, /vendor\/echarts-6\.1\.0\.min\.js[^]*dashboard\/main\.js/);
  // Git may materialize CRLF on Windows. Hash the canonical LF payload so the
  // integrity check remains identical to the asset served by Linux/Render.
  const canonicalVendor = vendor.replace(/\r\n/g, '\n');
  assert.equal(crypto.createHash('sha512').update(canonicalVendor).digest('base64'), 'Uyq/AgtqFM4vT+unIGTDr4wMJDTUK9O5w2PXMQeBCSR8koqHpVz+qBmcQ+9Oeo5H+EmvT4pp/5QrsqhIbyjHTQ==');
});

test('finance dashboard exposes all requested analytical views', () => {
  for (const id of ['finance-trend-chart', 'finance-cumulative-chart', 'finance-funnel', 'finance-cost-chart', 'finance-status-chart', 'finance-volume-chart', 'finance-daily-profit-chart', 'finance-history-chart', 'finance-days-table', 'finance-orders-cost-table', 'finance-expenses-table']) {
    assert.match(dashboard, new RegExp(`id="${id}"`));
  }
  assert.match(script, /type: 'funnel'/);
  assert.match(script, /type: 'bar'/);
  assert.match(script, /type: 'pie'/);
  assert.match(script, /PER_RETURNED_ORDER|pedido devuelto/);
});

test('results panel leads with monthly profit and a visible daily ledger', () => {
  assert.match(dashboard, />Panel de resultados</);
  assert.match(dashboard, /id="finance-result-profit"/);
  assert.match(dashboard, /Beneficio mensual total/);
  assert.match(dashboard, /Beneficio o pérdida de cada día/);
  assert.ok(dashboard.indexOf('id="finance-result-profit"') < dashboard.indexOf('id="finance-coverage"'));
  assert.ok(dashboard.indexOf('id="finance-days-table"') < dashboard.indexOf('id="finance-trend-chart"'));
  assert.doesNotMatch(dashboard, /finance-product-detail|finance-products-table/);
  assert.match(script, /FINANCE_DEFAULT_COLUMNS/);
  assert.match(script, /\['estimatedRevenue', 'Facturación prevista'/);
});

test('finance dashboard exposes editable fixed expenses and per-order Dropea provenance', () => {
  assert.match(dashboard, /id="finance-expense-form"/);
  assert.match(dashboard, /Coste y beneficio desglosado desde Dropea/);
  assert.match(script, /DROPEA_FINAL/);
  assert.match(script, /api\/finance-expenses/);
});

test('returned orders and returned units remain separate in UI and calculations', () => {
  assert.match(dashboard, /id="finance-returned"/);
  assert.match(dashboard, /id="finance-returned-units"/);
  assert.match(script, /\['returnedUnits', 'Unidades devueltas'/);
  assert.match(dashboard, /tarifa es por pedido/);
});

test('incidents panel exposes verified customer activity and the detected action', () => {
  assert.match(dashboard, /Con respuesta \/ acción/);
  assert.match(script, /customerActivityActionLabel/);
  assert.match(script, /customerActivityReferenceLabel/);
  assert.match(script, /Última actividad/);
  assert.match(script, /Incluye una acción mediante botón de Chatby/);
});
