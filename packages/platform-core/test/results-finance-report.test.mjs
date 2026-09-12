import test from 'node:test';
import assert from 'node:assert/strict';
import { buildResultsFinanceReport } from '../src/finance/results-report.mjs';

const rates = [
  ['OUTBOUND_SHIPPING', 4.06, { carrier: 'GLS' }],
  ['OUTBOUND_FULFILLMENT', 1.2, { carrier: 'GLS' }],
  ['COD', 1, { carrier: 'GLS' }],
  ['RETURN_LOGISTICS_COMBINED', 5.26, { carrier: 'GLS' }],
  ['PRODUCT_COGS', 4, { variant_id: '30133' }],
  ['PRODUCT_COGS', 1.44, { variant_id: '31547' }],
  ['PRODUCT_COGS', 1.01, { variant_id: '31666' }]
].map(([cost_type, amount, dimensions]) => ({ cost_type, amount, effective_from: '2026-05-01', ...dimensions }));

function products(variant = '31666', quantity = 1) {
  return { total_units: quantity, products: [{ product_id: variant, variant_id: variant, name: variant, quantity, wholesale_price: 0 }] };
}

function order(id, created, confirmed, extra = {}) {
  return { canonical_order_id: `order-${id}`, dropea_order_id: id, lifecycle_status: 'CONFIRMED', created_at_utc: created,
    confirmed_at_utc: confirmed, delivered_at_utc: null, returned_at_utc: null, total_amount: 29.99,
    final_amount: 29.99, currency: 'EUR', carrier: 'GLS', product_summary: products(), ...extra };
}

function source(month, days, overrides = {}) {
  const count = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  return { period: { month }, days: Array.from({ length: days ?? count }, (_, index) => ({
    day: `${month}-${String(index + 1).padStart(2, '0')}`, metaSpend: 0, fixedCosts: 0, oneOffCosts: 0, otherCosts: 0
  })), totals: { fixedCosts: 0, oneOffCosts: 0, otherCosts: 0 }, coverage: { dropeaBreakdownPercent: 100 }, ...overrides };
}

const orders = [
  order('1212673', '2026-05-27T20:22:56Z', '2026-05-27T21:00:00Z', { lifecycle_status: 'FINISHED', delivered_at_utc: '2026-06-02T10:03:31Z', product_summary: products('30133') }),
  order('1325871', '2026-07-29T19:24:26Z', '2026-07-29T20:00:00Z', { lifecycle_status: 'FINISHED', delivered_at_utc: '2026-08-04T13:38:35Z' }),
  order('1379027', '2026-08-28T21:26:57Z', '2026-08-28T22:00:00Z', { lifecycle_status: 'FINISHED', delivered_at_utc: '2026-09-04T17:33:48Z', total_amount: 29.99, final_amount: 24.99 }),
  order('1212256', '2026-05-27T15:57:08Z', '2026-05-27T16:10:00Z', { lifecycle_status: 'REJECTED', returned_at_utc: '2026-06-15T15:01:31Z' }),
  order('1318812', '2026-07-25T23:09:19Z', '2026-07-26T08:00:00Z', { lifecycle_status: 'REJECTED', returned_at_utc: '2026-08-17T09:30:13Z' }),
  order('1384491', '2026-08-31T13:54:41Z', '2026-08-31T14:00:00Z', { lifecycle_status: 'REJECTED', returned_at_utc: '2026-09-11T16:33:11Z' }),
  order('1393453', '2026-09-05T07:14:17Z', '2026-09-05T08:00:00Z', { lifecycle_status: 'REJECTED', returned_at_utc: '2026-09-11T10:34:18Z', product_summary: products('31666', 3), total_amount: 44.99, final_amount: 44.99 })
];

test('results finance separates creation cohorts from realised delivery and return events', () => {
  const supplementalReports = ['2026-05', '2026-06', '2026-07', '2026-08'].map((month) => source(month));
  supplementalReports.push(source('2026-09', 12, { dataAvailability: { status: 'MTD', label: 'MTD · día 12' } }));
  const result = buildResultsFinanceReport({ month: '2026-09', orders, rates, supplementalReports,
    availableMonths: supplementalReports.map((item) => item.period.month), now: new Date('2026-09-12T18:00:00Z'),
    dropeaLastSyncAt: '2026-09-12T17:55:00Z' });
  assert.equal(result.temporalModels.pnl, 'REALIZED_EVENT_DATE');
  assert.equal(result.eventCounts.delivered, 1);
  assert.equal(result.totals.realRevenue, 24.99);
  assert.equal(result.eventCounts.returned, 2);
  assert.equal(result.eventCounts.returnedUnits, 4);
  assert.equal(result.totals.returnCost, 10.52);
  assert.equal(result.days.find((day) => day.day === '2026-09-11').returnCost, 10.52);
  assert.equal(result.counts.created, 1);
  assert.equal(result.counts.confirmed + result.counts.pendingConfirmation + result.counts.cancelledBeforeConfirmation, result.counts.created);
  assert.equal(result.counts.delivered + result.counts.inTransit + result.counts.returned, result.counts.sent);
  assert.equal(result.history.find((item) => item.month === '2026-06').eventCounts.delivered, 1);
  assert.equal(result.history.find((item) => item.month === '2026-06').eventCounts.returned, 1);
  assert.equal(result.history.find((item) => item.month === '2026-08').eventCounts.delivered, 1);
  assert.equal(result.history.find((item) => item.month === '2026-08').eventCounts.returned, 1);
  assert.equal(result.days.at(-1).closeStatus, 'CURRENT_PARTIAL');
  assert.equal(result.source, 'operations_canonical_finance_v3');
});

test('May remains visibly partial and a three-unit return is charged once per order', () => {
  const reports = [source('2026-05', 31, { dataAvailability: { status: 'PARTIAL_SOURCE', label: 'Datos desde 10/05', sourceSince: '2026-05-10' } }), source('2026-09', 12)];
  const result = buildResultsFinanceReport({ month: '2026-09', orders: [orders.at(-1)], rates, supplementalReports: reports,
    availableMonths: ['2026-05', '2026-09'], now: new Date('2026-09-12T18:00:00Z') });
  assert.equal(result.totals.returnCost, 5.26);
  assert.equal(result.eventCounts.returnedUnits, 3);
  assert.equal(result.history.find((item) => item.month === '2026-05').dataAvailability.label, 'Datos desde 10/05');
});

test('recurring monthly expenses use one stable daily accrual and reconcile to MTD', () => {
  const september = source('2026-09', 12, {
    totals: { fixedCosts: 70.56, oneOffCosts: 0, otherCosts: 0 },
    expenseLedger: [{ name: 'Recurrente', type: 'recurring_monthly', amount: 176.39, startDate: '2026-09-01', endDate: null }]
  });
  const result = buildResultsFinanceReport({ month: '2026-09', orders: [], rates, supplementalReports: [september],
    availableMonths: ['2026-09'], now: new Date('2026-09-12T18:00:00Z') });
  assert.equal(new Set(result.days.map((day) => Number(day.fixedCosts).toFixed(2))).size, 1);
  assert.equal(result.totals.fixedCosts, 70.56);
  assert.equal(result.totals.totalCosts, 70.56);
});
