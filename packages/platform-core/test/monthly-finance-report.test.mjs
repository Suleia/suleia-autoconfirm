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
  assert.equal(result.totals.returned_units, 2);
  assert.equal(result.totals.delivered_units, 2);
  assert.equal(result.totals.costs.outbound_shipping, 12);
  assert.equal(result.totals.costs.returns, 5);
  assert.equal(result.totals.costs.product, 6);
  assert.equal(result.totals.dropea_expenses, 20.5);
  assert.equal(result.totals.dropea_profit, -0.5);
  assert.equal(result.totals.dropea_margin, -0.025);
  assert.equal(result.totals.dropea_profit_after_meta, -6.5);
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
  assert.equal(result.totals.dropea_expenses, 5.5);
  assert.equal(result.totals.dropea_profit, 14.5);
  assert.equal(result.totals.dropea_profit_after_meta, 14.5);
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

test('a rejected order that was already dispatched is counted as a return with exact return cost', () => {
  const rejected = order('rejected-after-dispatch', 'REJECTED', '2026-08-01', {
    returned_at_utc: '2026-08-01T16:00:00Z',
    order_costs: { fulfillment_outbound: 0.8, fulfillment_quantity_cost: 0.4, fulfillment_return: 1.5 }
  });
  const result = buildMonthlyFinanceReport({ month: '2026-08', now: new Date('2026-08-01T18:00:00Z'),
    orders: [rejected], rates, fixedExpensesComplete: true,
    adSpend: [{ business_date: '2026-08-01', spend: 0, sync_status: 'COMPLETE' }] });
  assert.equal(result.totals.returned, 1);
  assert.equal(result.totals.costs.outbound_fulfillment, 1.2);
  assert.equal(result.totals.costs.returns, 5.5);
});

test('Dropea refused lifecycle is shown as a returned order and returned product units', () => {
  const refused = order('refused-after-dispatch', 'REFUSED', '2026-08-01', {
    returned_at_utc: '2026-08-02T16:00:00Z'
  });
  const result = buildMonthlyFinanceReport({ month: '2026-08', now: new Date('2026-08-02T18:00:00Z'),
    orders: [refused], rates, fixedExpensesComplete: true,
    adSpend: [1, 2].map((day) => ({ business_date: `2026-08-0${day}`, spend: 0, sync_status: 'COMPLETE' })) });
  assert.equal(result.totals.returned, 1);
  assert.equal(result.totals.returned_units, 2);
  assert.equal(result.daily[1].returned, 1);
  assert.equal(result.daily[1].returned_units, 2);
  assert.equal(result.products[0].returned_units, 2);
  assert.equal(result.totals.return_cost_per_order, 5);
  assert.equal(result.audit.checks.find((check) => check.key === 'RETURNED_COUNT_EQUALS_DAILY_RETURNED').status, 'PASS');
  assert.equal(result.audit.checks.find((check) => check.key === 'RETURN_COST_EQUALS_DAILY_RETURN_COST').status, 'PASS');
});

test('product report exposes lifecycle, incidences and only attributable profit', () => {
  const delivered = order('product-profit', 'DELIVERED', '2026-08-01', {
    delivered_at_utc: '2026-08-01T13:00:00Z', active_issue_id: 'issue-fixture',
    order_costs: { fulfillment_outbound: 0.8, fulfillment_quantity_cost: 0.2, fulfillment_return: null }
  });
  const result = buildMonthlyFinanceReport({ month: '2026-08', now: new Date('2026-08-01T18:00:00Z'),
    orders: [delivered], rates, fixedExpensesComplete: true,
    adSpend: [{ business_date: '2026-08-01', spend: 0, sync_status: 'COMPLETE' }] });
  assert.equal(result.products[0].delivered_units, 2);
  assert.equal(result.products[0].in_air_units, 0);
  assert.equal(result.products[0].incidence_orders, 1);
  assert.equal(result.products[0].attributable_operational_cost, 11.5);
  assert.equal(result.products[0].attributable_operational_profit, 8.5);
});

test('recurring fixed expenses are allocated without changing their exact monthly total', () => {
  const result = buildMonthlyFinanceReport({ month: '2026-07', now: new Date('2026-08-01T12:00:00Z'), fixedExpenses: [{ expense_type: 'RECURRING', amount: 10, status: 'ACTIVE', start_date: '2026-07-01' }], adSpend: Array.from({ length: 31 }, (_, index) => ({ business_date: `2026-07-${String(index + 1).padStart(2, '0')}`, spend: 0, sync_status: 'COMPLETE' })) });
  assert.equal(result.totals.costs.fixed, 10);
});

test('current month uses accrued daily fixed expense and exposes the full commitment separately', () => {
  const result = buildMonthlyFinanceReport({ month: '2026-08', now: new Date('2026-08-03T12:00:00Z'), fixedExpenses: [{ expense_type: 'RECURRING', amount: 31, status: 'ACTIVE', start_date: '2026-08-01' }], adSpend: [1, 2, 3].map((day) => ({ business_date: `2026-08-0${day}`, spend: 0, sync_status: 'COMPLETE' })) });
  assert.equal(result.totals.costs.fixed, 3);
  assert.equal(result.totals.fixed_expenses_committed, 31);
  assert.equal(result.totals.fixed_expenses_remaining, 28);
  assert.equal(result.daily.at(-1).costs.fixed, 1);
});

test('an open Meta day stays provisional without blanking the audited month-to-date profit', () => {
  const delivered = order('closed-day-delivery', 'DELIVERED', '2026-08-01', {
    delivered_at_utc: '2026-08-01T13:00:00Z'
  });
  const result = buildMonthlyFinanceReport({
    month: '2026-08', now: new Date('2026-08-02T18:00:00Z'), orders: [delivered], rates,
    fixedExpenses: [{ expense_type: 'RECURRING', amount: 31, status: 'ACTIVE', start_date: '2026-08-01' }],
    adSpend: [{ business_date: '2026-08-01', platform: 'META', spend: 2, currency: 'EUR', sync_status: 'COMPLETE' }]
  });
  assert.equal(result.accounting_closed_through, '2026-08-01');
  assert.equal(result.pending_accounting_days, 1);
  assert.equal(result.totals.real_revenue, 20);
  assert.equal(result.totals.total_expenses, 14.5);
  assert.equal(result.totals.net_profit, 5.5);
  assert.equal(result.daily[1].net_profit, null);
  assert.match(result.missing_sources.join(','), /ADVERTISING:2026-08-02/);
});

test('multiple trailing Meta days keep the last contiguous audited close instead of inflating benefit', () => {
  const delivered = order('closed-day-delivery', 'DELIVERED', '2026-08-01', {
    delivered_at_utc: '2026-08-01T13:00:00Z'
  });
  const result = buildMonthlyFinanceReport({
    month: '2026-08', now: new Date('2026-08-03T18:00:00Z'), orders: [delivered], rates,
    fixedExpenses: [{ expense_type: 'RECURRING', amount: 31, status: 'ACTIVE', start_date: '2026-08-01' }],
    adSpend: [{ business_date: '2026-08-01', platform: 'META', spend: 2, currency: 'EUR', sync_status: 'COMPLETE' }]
  });
  assert.equal(result.accounting_closed_through, '2026-08-01');
  assert.equal(result.pending_accounting_days, 2);
  assert.equal(result.totals.real_revenue, 20);
  assert.equal(result.totals.total_expenses, 14.5);
  assert.equal(result.totals.net_profit, 5.5);
  assert.equal(result.daily[1].net_profit, null);
  assert.equal(result.daily[2].net_profit, null);
});

test('rejections after the accounting close remain visible without entering closed benefit', () => {
  const rejected = order('provisional-return', 'REFUSED', '2026-08-01', {
    returned_at_utc: '2026-08-02T13:00:00Z'
  });
  const result = buildMonthlyFinanceReport({
    month: '2026-08', now: new Date('2026-08-02T18:00:00Z'), orders: [rejected], rates,
    fixedExpensesComplete: true,
    adSpend: [{ business_date: '2026-08-01', platform: 'META', spend: 0, currency: 'EUR', sync_status: 'COMPLETE' }]
  });
  assert.equal(result.accounting_closed_through, '2026-08-01');
  assert.equal(result.totals.returned, 0);
  assert.equal(result.totals.costs.returns, 0);
  assert.equal(result.observed_snapshot.returned, 1);
  assert.equal(result.observed_snapshot.returned_units, 2);
  assert.equal(result.observed_snapshot.return_cost, 5);
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

test('confirmed Collagum and NIDA unit costs reproduce the audited product subtotal', () => {
  const productRates = [
    ...rates.filter((rate) => rate.cost_type !== 'PRODUCT_COGS'),
    { cost_type: 'PRODUCT_COGS', amount: 1.01, variant_id: '31666', effective_from: '2026-06-01' },
    { cost_type: 'PRODUCT_COGS', amount: 1.44, variant_id: '31547', effective_from: '2026-06-01' }
  ];
  const result = buildMonthlyFinanceReport({
    month: '2026-08', now: new Date('2026-08-01T18:00:00Z'), rates: productRates, fixedExpensesComplete: true,
    orders: [
      order('collagum-audit', 'DELIVERED', '2026-08-01', {
        delivered_at_utc: '2026-08-01T13:00:00Z', total_amount: 2000,
        product_summary: { products: [{ variant_id: '31666', product_id: '31666', name: 'Collagum', quantity: 125 }] }
      }),
      order('nida-audit', 'DELIVERED', '2026-08-01', {
        delivered_at_utc: '2026-08-01T13:00:00Z', total_amount: 1100,
        product_summary: { products: [{ variant_id: '31547', product_id: '31547', name: 'NIDA', quantity: 63 }] }
      })
    ],
    adSpend: [{ business_date: '2026-08-01', platform: 'META', spend: 0, currency: 'EUR', sync_status: 'COMPLETE' }]
  });
  assert.equal(result.products.find((item) => item.variant_id === '31666').product_cost, 126.25);
  assert.equal(result.products.find((item) => item.variant_id === '31547').product_cost, 90.72);
  assert.equal(result.totals.costs.product, 216.97);
  assert.equal(2 * 1.01, 2.02);
  assert.equal(2 * 1.44, 2.88);
  assert.equal(result.audit.formula_version, 'FINANCE_REALIZED_DAILY_V2');
  assert.ok(result.audit.checks.every((check) => check.status === 'PASS'));
});

test('operator-confirmed product rates override a conflicting provider wholesale hint', () => {
  const governedRates = [
    ...rates.filter((rate) => rate.cost_type !== 'PRODUCT_COGS'),
    { cost_type: 'PRODUCT_COGS', amount: 1.01, variant_id: '31666', effective_from: '2026-06-01' }
  ];
  const result = buildMonthlyFinanceReport({
    month: '2026-08', now: new Date('2026-08-01T18:00:00Z'), rates: governedRates, fixedExpensesComplete: true,
    orders: [order('governed-cogs', 'DELIVERED', '2026-08-01', {
      delivered_at_utc: '2026-08-01T13:00:00Z',
      product_summary: { products: [{ variant_id: '31666', product_id: '31666', name: 'Collagum', quantity: 2, wholesale_price: 9.99 }] }
    })],
    adSpend: [{ business_date: '2026-08-01', platform: 'META', spend: 0, currency: 'EUR', sync_status: 'COMPLETE' }]
  });
  assert.equal(result.totals.costs.product, 2.02);
});

test('a delivered order returned later blocks revenue and profit until its refund value is known', () => {
  const result = buildMonthlyFinanceReport({
    month: '2026-08', now: new Date('2026-08-03T18:00:00Z'), rates, fixedExpensesComplete: true,
    orders: [order('delivered-then-returned', 'RETURNED', '2026-08-01', {
      delivered_at_utc: '2026-08-02T13:00:00Z', returned_at_utc: '2026-08-03T13:00:00Z'
    })],
    adSpend: [1, 2, 3].map((day) => ({ business_date: `2026-08-0${day}`, spend: 0, currency: 'EUR', sync_status: 'COMPLETE' }))
  });
  assert.equal(result.totals.real_revenue, null);
  assert.equal(result.totals.net_profit, null);
  assert.equal(result.exactness, 'PARTIAL');
  assert.match(result.missing_sources.join(','), /REFUND_VALUE/);
});

test('historical product and carrier views never present the current in-air snapshot as a past fact', () => {
  const result = buildMonthlyFinanceReport({
    month: '2026-07', now: new Date('2026-08-29T12:00:00Z'), rates, fixedExpensesComplete: true,
    orders: [order('still-shipping', 'SHIPPING', '2026-07-30')],
    adSpend: Array.from({ length: 31 }, (_, index) => ({ business_date: `2026-07-${String(index + 1).padStart(2, '0')}`, spend: 0, currency: 'EUR', sync_status: 'COMPLETE' }))
  });
  assert.equal(result.totals.in_air, null);
  assert.equal(result.products[0].in_air_units, 0);
  assert.equal(result.logistics[0].in_air, 0);
});

test('daily realised profit includes orders delivered in the month even when created in a prior month', () => {
  const previousMonth = order('cross-month-delivery', 'DELIVERED', '2026-07-30', {
    delivered_at_utc: '2026-08-02T13:00:00Z', confirmed_at_utc: '2026-07-30T11:00:00Z'
  });
  const result = buildMonthlyFinanceReport({ month: '2026-08', now: new Date('2026-08-02T18:00:00Z'),
    orders: [previousMonth], rates, fixedExpensesComplete: true,
    adSpend: [1, 2].map((day) => ({ business_date: `2026-08-0${day}`, spend: 0, currency: 'EUR', sync_status: 'COMPLETE' })) });
  assert.equal(result.totals.orders_created, 0);
  assert.equal(result.totals.delivered, 1);
  assert.equal(result.totals.real_revenue, 20);
  assert.equal(result.totals.costs.product, 6);
  assert.equal(result.daily[1].delivered, 1);
  assert.equal(result.daily[1].real_revenue, 20);
  assert.equal(result.perspective, 'REALIZED_EVENT_DATE');
});

test('monthly audit exposes the same seven cost blocks and ratios as the reference finance workbook', () => {
  const result = buildMonthlyFinanceReport({
    month: '2026-08', now: new Date('2026-08-01T18:00:00Z'), rates, fixedExpensesComplete: true,
    orders: [order('audit-order', 'DELIVERED', '2026-08-01', { delivered_at_utc: '2026-08-01T13:00:00Z' })],
    adSpend: [{ business_date: '2026-08-01', platform: 'META', spend: 10, currency: 'EUR', sync_status: 'COMPLETE' }]
  });
  assert.equal(result.totals.total_expenses, 21.5);
  assert.equal(result.totals.net_profit, -1.5);
  assert.equal(result.totals.estimated_cpa, 10);
  assert.equal(result.totals.real_cpa, 10);
  assert.equal(result.totals.confirmation_rate, 1);
  assert.equal(result.totals.delivery_rate, 1);
  assert.equal(result.audit.model_status, 'PASS');
});
