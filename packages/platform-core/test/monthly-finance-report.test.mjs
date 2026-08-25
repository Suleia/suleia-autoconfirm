import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMonthlyFinanceReport } from '../src/finance/monthly-report.mjs';

const rates = [
  ['OUTBOUND_SHIPPING', 4, { carrier: 'GLS' }],
  ['OUTBOUND_FULFILLMENT', 1, { carrier: 'GLS' }],
  ['COD', 0.5, { carrier: 'GLS' }],
  ['RETURN_SHIPPING', 4, { carrier: 'GLS' }],
  ['RETURN_FULFILLMENT', 1, { carrier: 'GLS' }],
  ['PRODUCT_COGS', 3, { variant_id: 'v1' }]
].map(([cost_type, amount, dimensions]) => ({ cost_type, amount, effective_from: '2026-08-01', ...dimensions }));

function order(id, lifecycle_status, day, extra = {}) {
  return { canonical_order_id: id, lifecycle_status, created_at_utc: `${day}T10:00:00Z`, confirmed_at_utc: `${day}T11:00:00Z`, total_amount: 20, currency: 'EUR', carrier: 'GLS', product_summary: { products: [{ variant_id: 'v1', product_id: 'p1', name: 'Fixture product', quantity: 2 }] }, ...extra };
}

test('monthly report separates delivered, in-air and returned orders and applies costs by lifecycle', () => {
  const result = buildMonthlyFinanceReport({
    month: '2026-08', now: new Date('2026-08-03T12:00:00Z'), rates, fixedExpensesComplete: true,
    orders: [
      order('delivered', 'DELIVERED', '2026-08-01', { delivered_at_utc: '2026-08-02T10:00:00Z' }),
      order('air', 'SHIPPING', '2026-08-01'),
      order('returned', 'RETURNED', '2026-08-02', { returned_at_utc: '2026-08-03T10:00:00Z' })
    ],
    adSpend: [1, 2, 3].map((day) => ({ business_date: `2026-08-0${day}`, spend: day, sync_status: 'COMPLETE' }))
  });
  assert.equal(result.totals.orders_sent, 3);
  assert.equal(result.totals.delivered, 1);
  assert.equal(result.totals.in_air, 1);
  assert.equal(result.totals.returned, 1);
  assert.equal(result.totals.costs.outbound_shipping, 12);
  assert.equal(result.totals.costs.returns, 5);
  assert.equal(result.totals.costs.product, 6);
  assert.equal(result.exactness, 'COMPLETE');
});

test('missing rates and missing advertising days remain incomplete instead of becoming zero', () => {
  const result = buildMonthlyFinanceReport({ month: '2026-08', now: new Date('2026-08-02T12:00:00Z'), orders: [order('air', 'SHIPPING', '2026-08-01')], rates: [], adSpend: [] });
  assert.equal(result.totals.costs.outbound_shipping, null);
  assert.equal(result.totals.costs.advertising, null);
  assert.equal(result.totals.total_expenses, null);
  assert.equal(result.totals.net_profit, null);
  assert.equal(result.exactness, 'PARTIAL');
  assert.match(result.missing_sources.join(','), /OUTBOUND_SHIPPING:GLS/);
});

test('Dropea wholesale price calculates operational profit while missing ads only block net profit', () => {
  const delivered = order('delivered-wholesale', 'DELIVERED', '2026-08-01', {
    delivered_at_utc: '2026-08-01T13:00:00Z',
    product_summary: { products: [{ variant_id: 'v1', product_id: 'p1', name: 'Fixture product', quantity: 2, wholesale_price: 3.5 }] }
  });
  const result = buildMonthlyFinanceReport({
    month: '2026-08', now: new Date('2026-08-01T18:00:00Z'), orders: [delivered],
    rates: rates.filter((rate) => rate.cost_type !== 'PRODUCT_COGS'), fixedExpensesComplete: true, adSpend: []
  });
  assert.equal(result.totals.costs.product, 7);
  assert.equal(result.totals.operational_expenses, 12.5);
  assert.equal(result.totals.operational_profit, 7.5);
  assert.equal(result.totals.operational_margin, 0.375);
  assert.equal(result.totals.net_profit, null);
  assert.match(result.missing_sources.join(','), /ADVERTISING:2026-08-01/);
});

test('a zero Dropea wholesale sentinel never fabricates a free product or inflated profit', () => {
  const delivered = order('delivered-zero-wholesale', 'DELIVERED', '2026-08-01', {
    delivered_at_utc: '2026-08-01T13:00:00Z',
    product_summary: { products: [{ variant_id: 'unknown', product_id: 'legacy', name: 'Fixture legacy product', quantity: 1, wholesale_price: 0 }] }
  });
  const result = buildMonthlyFinanceReport({
    month: '2026-08', now: new Date('2026-08-01T18:00:00Z'), orders: [delivered],
    rates: rates.filter((rate) => rate.cost_type !== 'PRODUCT_COGS'), fixedExpensesComplete: true,
    adSpend: [{ business_date: '2026-08-01', platform: 'META', spend: 0, currency: 'EUR', sync_status: 'COMPLETE' }]
  });
  assert.equal(result.totals.costs.product, null);
  assert.equal(result.totals.operational_profit, null);
  assert.equal(result.totals.net_profit, null);
  assert.match(result.missing_sources.join(','), /PRODUCT_COGS/);
});

test('an unconfigured fixed-expense source remains unknown instead of becoming zero', () => {
  const result = buildMonthlyFinanceReport({ month: '2026-08', now: new Date('2026-08-01T18:00:00Z'), adSpend: [
    { business_date: '2026-08-01', platform: 'META', spend: 0, currency: 'EUR', sync_status: 'COMPLETE' }
  ] });
  assert.equal(result.totals.costs.fixed, null);
  assert.equal(result.totals.total_expenses, null);
  assert.match(result.missing_sources.join(','), /FIXED_EXPENSES:2026-08/);
});

test('rejected but never returned orders are not charged as returns', () => {
  const rejected = order('rejected', 'REJECTED', '2026-08-01', { confirmed_at_utc: null });
  const result = buildMonthlyFinanceReport({ month: '2026-08', now: new Date('2026-08-01T18:00:00Z'), orders: [rejected], rates, fixedExpensesComplete: true, adSpend: [{ business_date: '2026-08-01', spend: 0, sync_status: 'COMPLETE' }] });
  assert.equal(result.totals.returned, 0);
  assert.equal(result.totals.costs.returns, 0);
});

test('recurring fixed expenses are allocated without changing their exact monthly total', () => {
  const result = buildMonthlyFinanceReport({ month: '2026-07', now: new Date('2026-08-01T12:00:00Z'), fixedExpenses: [{ expense_type: 'RECURRING', amount: 10, status: 'ACTIVE', start_date: '2026-07-01' }], adSpend: Array.from({ length: 31 }, (_, index) => ({ business_date: `2026-07-${String(index + 1).padStart(2, '0')}`, spend: 0, sync_status: 'COMPLETE' })) });
  assert.equal(result.totals.costs.fixed, 10);
});

test('current month totals include the complete monthly fixed expense allocation', () => {
  const result = buildMonthlyFinanceReport({ month: '2026-08', now: new Date('2026-08-03T12:00:00Z'), fixedExpenses: [{ expense_type: 'RECURRING', amount: 31, status: 'ACTIVE', start_date: '2026-08-01' }], adSpend: [1, 2, 3].map((day) => ({ business_date: `2026-08-0${day}`, spend: 0, sync_status: 'COMPLETE' })) });
  assert.equal(result.totals.costs.fixed, 31);
  assert.equal(result.daily.at(-1).costs.fixed, 1);
});

test('delivered orders without product lines or amounts block profit instead of fabricating zero', () => {
  const incomplete = order('missing', 'DELIVERED', '2026-08-01', { total_amount: null, product_summary: {}, delivered_at_utc: '2026-08-01T13:00:00Z' });
  const result = buildMonthlyFinanceReport({ month: '2026-08', now: new Date('2026-08-01T18:00:00Z'), orders: [incomplete], rates, adSpend: [{ business_date: '2026-08-01', spend: 0, currency: 'EUR', sync_status: 'COMPLETE' }] });
  assert.equal(result.totals.real_revenue, null);
  assert.equal(result.totals.costs.product, null);
  assert.equal(result.totals.net_profit, null);
  assert.match(result.missing_sources.join(','), /ORDER_ITEMS_MISSING/);
});

test('monthly rates are recalculated from monthly totals instead of averaging daily percentages', () => {
  const result = buildMonthlyFinanceReport({
    month: '2026-08', now: new Date('2026-08-02T18:00:00Z'), rates, fixedExpensesComplete: true,
    orders: [
      order('d1-a', 'DELIVERED', '2026-08-01', { delivered_at_utc: '2026-08-01T13:00:00Z' }),
      order('d1-b', 'SHIPPING', '2026-08-01'),
      order('d2-a', 'DELIVERED', '2026-08-02', { delivered_at_utc: '2026-08-02T13:00:00Z' })
    ],
    adSpend: [1, 2].map((day) => ({ business_date: `2026-08-0${day}`, spend: 0, currency: 'EUR', sync_status: 'COMPLETE' }))
  });
  assert.equal(result.daily[0].delivery_rate, 0.5);
  assert.equal(result.daily[1].delivery_rate, 1);
  assert.equal(result.totals.delivery_rate, 0.6667);
  assert.notEqual(result.totals.delivery_rate, (result.daily[0].delivery_rate + result.daily[1].delivery_rate) / 2);
});

test('advertising totals combine complete platforms and reject a currency mismatch', () => {
  const complete = buildMonthlyFinanceReport({
    month: '2026-08', now: new Date('2026-08-01T18:00:00Z'), fixedExpensesComplete: true,
    adSpend: [
      { business_date: '2026-08-01', platform: 'META', spend: 10, currency: 'EUR', sync_status: 'COMPLETE' },
      { business_date: '2026-08-01', platform: 'GOOGLE', spend: 5, currency: 'EUR', sync_status: 'COMPLETE' }
    ]
  });
  assert.equal(complete.totals.costs.advertising, 15);
  assert.deepEqual(complete.advertising_by_platform, [{ platform: 'META', spend: 10 }, { platform: 'GOOGLE', spend: 5 }]);

  const mismatch = buildMonthlyFinanceReport({ month: '2026-08', now: new Date('2026-08-01T18:00:00Z'), fixedExpensesComplete: true, adSpend: [
    { business_date: '2026-08-01', platform: 'META', spend: 10, currency: 'USD', sync_status: 'COMPLETE' }
  ] });
  assert.equal(mismatch.totals.costs.advertising, null);
  assert.equal(mismatch.exactness, 'PARTIAL');
});
