import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOrderCreationCohortFinanceReport } from '../src/finance/monthly-report.mjs';

const rates = [
  { cost_type: 'OUTBOUND_SHIPPING', carrier: 'GLS', amount: 4.06, currency: 'EUR', effective_from: '2026-07-01' },
  { cost_type: 'OUTBOUND_FULFILLMENT', carrier: 'GLS', amount: 1.2, currency: 'EUR', effective_from: '2026-07-01' },
  { cost_type: 'COD', carrier: 'GLS', amount: 1, currency: 'EUR', effective_from: '2026-07-01' },
  { cost_type: 'RETURN_SHIPPING', carrier: 'GLS', amount: 4.06, currency: 'EUR', effective_from: '2026-07-01' },
  { cost_type: 'RETURN_FULFILLMENT', carrier: 'GLS', amount: 1.2, currency: 'EUR', effective_from: '2026-07-01' },
  { cost_type: 'PRODUCT_COGS', variant_id: 'COLLAGUM', amount: 1.01, currency: 'EUR', effective_from: '2026-06-01' },
  { cost_type: 'PRODUCT_COGS', variant_id: 'NIDA', amount: 1.44, currency: 'EUR', effective_from: '2026-06-01' }
];
const ads = Array.from({ length: 31 }, (_, index) => ({ business_date: `2026-08-${String(index + 1).padStart(2, '0')}`, platform: 'META', spend: 1, currency: 'EUR', sync_status: 'COMPLETE' }));
const product = (variant) => ({ products: [{ variant_id: variant, product_id: variant, name: variant, quantity: 2 }] });
function order(id, state, variant, amount, extra = {}) {
  return {
    canonical_order_id: id, lifecycle_status: state, created_at_utc: '2026-08-18T10:00:00Z',
    confirmed_at_utc: state === 'CANCELLED' ? null : '2026-08-18T11:00:00Z',
    total_amount: amount, currency: 'EUR', carrier: 'GLS', product_summary: product(variant), ...extra
  };
}

test('creation cohort reproduces the workbook perimeter without mixing return-event cohorts', () => {
  const result = buildOrderCreationCohortFinanceReport({
    month: '2026-08', now: new Date('2026-09-01T18:00:00Z'), rates, adSpend: ads,
    fixedExpenses: [{ expense_type: 'RECURRING', amount: 31, status: 'ACTIVE', start_date: '2026-08-01' }],
    orders: [
      order('delivered-collagum', 'DELIVERED', 'COLLAGUM', 29.99, { delivered_at_utc: '2026-09-01T09:00:00Z' }),
      order('delivered-nida', 'FINISHED', 'NIDA', 34.99, { delivered_at_utc: '2026-08-20T09:00:00Z' }),
      order('returned', 'REJECTED', 'COLLAGUM', 29.99, { returned_at_utc: '2026-08-31T09:00:00Z' }),
      order('in-air', 'PREPARED', 'NIDA', 34.99),
      { ...order('prior-month-return', 'REJECTED', 'COLLAGUM', 29.99, { returned_at_utc: '2026-08-19T09:00:00Z' }), created_at_utc: '2026-07-30T10:00:00Z' }
    ]
  });
  assert.equal(result.perspective, 'ORDER_CREATION_COHORT_CURRENT_STATUS');
  assert.equal(result.audit.formula_version, 'FINANCE_ORDER_CREATION_COHORT_V1');
  assert.deepEqual({ sent: result.totals.orders_sent, delivered: result.totals.delivered, in_air: result.totals.in_air, returned: result.totals.returned }, { sent: 4, delivered: 2, in_air: 1, returned: 1 });
  assert.equal(result.totals.real_revenue, 64.98);
  assert.equal(result.totals.estimated_revenue, 129.96);
  assert.equal(result.totals.costs.product, 4.9);
  assert.equal(result.totals.costs.outbound_shipping, 16.24);
  assert.equal(result.totals.costs.outbound_fulfillment, 4.8);
  assert.equal(result.totals.costs.cod, 2);
  assert.equal(result.totals.costs.returns, 5.26);
  assert.equal(result.totals.costs.advertising, 31);
  assert.equal(result.totals.costs.fixed, 31);
  assert.equal(result.totals.total_expenses, 95.2);
  assert.equal(result.totals.net_profit, -30.22);
  assert.equal(result.totals.return_cost_per_order, 5.26);
  assert.ok(result.audit.checks.every((check) => check.status === 'PASS'));
});

test('a historical month fails closed when an advertising day is absent', () => {
  const result = buildOrderCreationCohortFinanceReport({
    month: '2026-08', now: new Date('2026-09-01T18:00:00Z'), rates,
    fixedExpenses: [{ expense_type: 'RECURRING', amount: 31, status: 'ACTIVE', start_date: '2026-08-01' }],
    orders: [order('delivered', 'DELIVERED', 'COLLAGUM', 29.99, { delivered_at_utc: '2026-08-20T09:00:00Z' })],
    adSpend: ads.slice(0, 30)
  });
  assert.equal(result.totals.costs.advertising, null);
  assert.equal(result.totals.net_profit, null);
  assert.equal(result.audit.model_status, 'PARTIAL');
  assert.match(result.missing_sources.join(','), /ADVERTISING:2026-08-31/);
});
