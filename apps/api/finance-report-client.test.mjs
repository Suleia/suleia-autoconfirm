import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FinanceReportClient, createFinanceReportClient } from './finance-report-client.mjs';

test('finance client authenticates once and keeps only the sanitized per-order finance breakdown', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/api/dashboard-login')) {
      return new Response(null, { status: 303, headers: { 'set-cookie': 'suleia_dashboard=signed-session; HttpOnly; Secure; Path=/' } });
    }
    return Response.json({ ok: true, finance: {
      period: { month: '2026-07', current: false, elapsedDays: 31 }, status: 'reconstructed', statusLabel: 'Mes cerrado',
      counts: { created: 10, delivered: 7 }, totals: { realRevenue: 100, totalCosts: 70, exactNetProfit: 30 },
      days: [{ day: '2026-07-01', realRevenue: 100, totalCosts: 70, netProfit: 30 }], history: [{ month: '2026-07', totals: { exactNetProfit: 30 } }],
      availableRange: { from: '2026-05', to: '2026-09' }, orders: [
        { orderId: 1384509, externalOrderId: 'ES-PRIVATE', createdDay: '2026-09-01', settlementDay: '2026-09-09', status: 'finished',
          units: 2, realizedRevenue: '29.99', productCost: 2.02, outboundShippingCost: 4.06,
          outboundFulfillmentCost: 1, codCost: 1.2, returnCost: null, dropeaAdjustmentsCost: 0,
          recognizedCost: 8.28, breakdownStatus: 'DROPEA_FINAL', calculatedAt: 'private' },
        { orderId: 'not-a-number', externalOrderId: 'ES-REJECTED' }
      ], drilldowns: { '2026-07-01': { delivered: ['private-order'] } }
    } });
  };
  const client = new FinanceReportClient({ baseUrl: 'https://finance.example.test', password: 'secret-fixture', fetchImpl });
  const report = await client.getMonthly('2026-07');
  assert.deepEqual(report.availableMonths, ['2026-09', '2026-08', '2026-07', '2026-06', '2026-05']);
  assert.equal(report.totals.exactNetProfit, 30);
  assert.deepEqual(report.orders, [{ orderId: '1384509', createdDay: '2026-09-01', settlementDay: '2026-09-09', status: 'FINISHED',
    breakdownStatus: 'DROPEA_FINAL', units: 2, orderAmount: null, realizedRevenue: 29.99, dropeaExpenses: null,
    productCost: 2.02, outboundShippingCost: 4.06, outboundFulfillmentCost: 1, codCost: 1.2,
    returnCost: null, dropeaAdjustmentsCost: 0, recognizedCost: 8.28, dropeaOrderProfit: null,
    contributionAfterProduct: null }]);
  assert.equal('drilldowns' in report, false);
  assert.equal(report.productionWrites, 0);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.headers.cookie, 'suleia_dashboard=signed-session');
});

test('finance client validates month and retries an expired session once', async () => {
  let logins = 0; let reports = 0;
  const client = new FinanceReportClient({ baseUrl: 'https://finance.example.test', password: 'fixture', fetchImpl: async (url) => {
    if (url.endsWith('/api/dashboard-login')) { logins += 1; return new Response(null, { status: 303, headers: { 'set-cookie': `suleia_dashboard=session-${logins}; Path=/` } }); }
    reports += 1;
    if (reports === 1) return Response.json({ error: 'expired' }, { status: 401 });
    return Response.json({ finance: { period: { month: '2026-08' }, totals: {}, days: [], history: [] } });
  } });
  await assert.rejects(() => client.getMonthly('July 2026'), { message: 'invalid_finance_month' });
  const report = await client.getMonthly('2026-08');
  assert.equal(report.period.month, '2026-08');
  assert.equal(logins, 2);
  assert.equal(reports, 2);
});

test('finance client is disabled unless both trusted server-side settings exist', () => {
  assert.equal(createFinanceReportClient({ financeReportBaseUrl: '', financeReportPassword: '' }), null);
  assert.equal(createFinanceReportClient({ financeReportBaseUrl: 'https://finance.example.test', financeReportPassword: '' }), null);
});

test('finance client requests a read-only refresh for a stale current-month snapshot', async () => {
  const calls = [];
  const now = Date.parse('2026-09-13T12:00:00Z');
  const client = new FinanceReportClient({
    baseUrl: 'https://finance.example.test', password: 'fixture', now: () => now,
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.endsWith('/api/dashboard-login')) return new Response(null, { status: 303, headers: { 'set-cookie': 'suleia_dashboard=session; Path=/' } });
      return Response.json({ finance: { period: { month: '2026-09', current: true }, totals: { exactNetProfit: 1 },
        days: [{ day: '2026-09-12' }], history: [], generatedAt: '2026-09-12T10:00:00Z' } });
    }
  });
  await client.getMonthly('2026-09');
  assert.equal(calls.filter((url) => url.includes('refresh=1')).length, 1);
  assert.match(calls.at(-1), /month=2026-09&refresh=1$/);
});

test('Operations API has narrowly scoped HTTPS egress for the finance read model', () => {
  const composeUrl = new URL('../../infrastructure/docker/compose.yaml', import.meta.url);
  if (!fs.existsSync(composeUrl)) {
    assert.match(process.env.FINANCE_REPORT_BASE_URL || '', /^https:\/\//);
    assert.ok(process.env.FINANCE_REPORT_PASSWORD);
    assert.equal(process.env.PRODUCTION_WRITES_ENABLED || 'false', 'false');
    return;
  }
  const compose = fs.readFileSync(composeUrl, 'utf8');
  const api = (compose.split(/\r?\n  api:\r?\n/)[1] || '').split(/\r?\n  mcp-server:/)[0];
  assert.match(api, /FINANCE_REPORT_BASE_URL/);
  assert.match(api, /FINANCE_REPORT_PASSWORD/);
  assert.match(api, /FINANCE_REPORT_CACHE_TTL_MS/);
  assert.match(api, /FINANCE_REPORT_CACHE_STALE_MS/);
  assert.match(api, /FINANCE_UI_REFRESH_INTERVAL_SECONDS/);
  assert.match(api, /networks:\s*\n\s*- public_network\s*\n\s*- application_network\s*\n\s*- database_network/);
  assert.match(compose, /PRODUCTION_WRITES_ENABLED:\s*\$\{PRODUCTION_WRITES_ENABLED:-false\}/);
});
