import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FinanceReportClient, createFinanceReportClient } from './finance-report-client.mjs';

test('finance client authenticates once, returns the reconciled report and strips order drilldowns', async () => {
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
      availableRange: { from: '2026-05', to: '2026-09' }, orders: [{ orderId: 'private-order' }], drilldowns: { '2026-07-01': { delivered: ['private-order'] } }
    } });
  };
  const client = new FinanceReportClient({ baseUrl: 'https://finance.example.test', password: 'secret-fixture', fetchImpl });
  const report = await client.getMonthly('2026-07');
  assert.deepEqual(report.availableMonths, ['2026-09', '2026-08', '2026-07', '2026-06', '2026-05']);
  assert.equal(report.totals.exactNetProfit, 30);
  assert.equal('orders' in report, false);
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
  assert.match(api, /networks:\s*\n\s*- public_network\s*\n\s*- application_network\s*\n\s*- database_network/);
  assert.match(compose, /PRODUCTION_WRITES_ENABLED:\s*\$\{PRODUCTION_WRITES_ENABLED:-false\}/);
});
