import test from 'node:test';
import assert from 'node:assert/strict';
import { buildResultsFinanceReport } from '../src/finance/results-report.mjs';

const rates = [
  ['OUTBOUND_SHIPPING', 4.06, { carrier: 'GLS' }],
  ['OUTBOUND_FULFILLMENT', 1, { carrier: 'GLS' }],
  ['COD', 1.2, { carrier: 'GLS' }],
  ['RETURN_LOGISTICS_COMBINED', 5.26, { carrier: 'GLS' }],
  ['DROPEA_ADJUSTMENTS', 0, { carrier: 'GLS' }],
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
  assert.equal(result.counts.delivered + result.counts.inTransit + result.counts.returned + result.counts.otherOutcome, result.counts.sent);
  assert.equal(result.history.find((item) => item.month === '2026-06').eventCounts.delivered, 1);
  assert.equal(result.history.find((item) => item.month === '2026-06').eventCounts.returned, 1);
  assert.equal(result.history.find((item) => item.month === '2026-08').eventCounts.delivered, 1);
  assert.equal(result.history.find((item) => item.month === '2026-08').eventCounts.returned, 1);
  assert.equal(result.days.at(-1).closeStatus, 'CURRENT_PARTIAL');
  assert.equal(result.accounting.closedThrough, '2026-09-12');
  assert.equal(result.accounting.pendingDays, 0);
  assert.equal(result.accounting.currentDayPartial, true);
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

test('final Dropea order costs outrank rates, adjustments are preserved and return remains 5.26 per order', () => {
  const delivered = order('1393175', '2026-09-01T08:00:00Z', '2026-09-01T09:00:00Z', {
    lifecycle_status: 'FINISHED', delivered_at_utc: '2026-09-08T10:00:00Z', final_amount: 24.99
  });
  const returned = order('1393453', '2026-09-05T08:00:00Z', '2026-09-05T09:00:00Z', {
    lifecycle_status: 'REJECTED', returned_at_utc: '2026-09-11T10:00:00Z', product_summary: products('31547', 3)
  });
  const september = source('2026-09', 12, { orders: [
    { orderId: '1393175', createdDay: '2026-09-01', settlementDay: '2026-09-08', status: 'FINISHED', units: 1,
      realizedRevenue: 24.99, productCost: 1.01, outboundShippingCost: 4.5, outboundFulfillmentCost: 1.1,
      codCost: 1.3, returnCost: 0, dropeaAdjustmentsCost: 0.25, breakdownStatus: 'DROPEA_FINAL' },
    { orderId: '1393453', createdDay: '2026-09-05', settlementDay: '2026-09-11', status: 'REJECTED', units: 3,
      realizedRevenue: 0, productCost: 0, outboundShippingCost: 4.5, outboundFulfillmentCost: 1.1,
      codCost: 0, returnCost: 4.06, dropeaAdjustmentsCost: 2, breakdownStatus: 'DROPEA_FINAL' }
  ] });
  const result = buildResultsFinanceReport({ month: '2026-09', orders: [delivered, returned], rates,
    supplementalReports: [september], availableMonths: ['2026-09'], now: new Date('2026-09-12T18:00:00Z') });
  assert.equal(result.totals.realRevenue, 24.99);
  assert.equal(result.totals.productCost, 1.01);
  assert.equal(result.totals.outboundShippingCost, 9);
  assert.equal(result.totals.outboundFulfillmentCost, 2.2);
  assert.equal(result.totals.codCost, 1.3);
  assert.equal(result.totals.returnCost, 5.26);
  assert.equal(result.totals.dropeaAdjustmentsCost, 2.25);
  assert.equal(result.coverage.dropeaBreakdownPercent, 100);
  assert.equal(result.orderLedger.length, 2);
  assert.equal(result.orderLedger.find((row) => row.orderId === '1393453').returnCost, 5.26);
  assert.equal(result.orderLedger.find((row) => row.orderId === '1393453').productCost, 0);
  assert.equal(result.days.find((row) => row.day === '2026-09-11').dropeaAdjustmentsCost, 2);
});

test('a missing final cost stays null and marks the order and headline profit provisional', () => {
  const delivered = order('1387364', '2026-09-01T08:00:00Z', '2026-09-01T09:00:00Z', {
    lifecycle_status: 'DELIVERED', delivered_at_utc: '2026-09-11T10:00:00Z'
  });
  const september = source('2026-09', 12, { orders: [{ orderId: '1387364', createdDay: '2026-09-01', settlementDay: '2026-09-11',
    status: 'DELIVERED', realizedRevenue: 29.99, productCost: 1.01, outboundShippingCost: 4.06,
    outboundFulfillmentCost: 1, codCost: 1.2, dropeaAdjustmentsCost: null, breakdownStatus: 'DROPEA_FINAL' }] });
  const noAdjustmentFallback = rates.filter((rate) => rate.cost_type !== 'DROPEA_ADJUSTMENTS');
  const result = buildResultsFinanceReport({ month: '2026-09', orders: [delivered], rates: noAdjustmentFallback,
    supplementalReports: [september], availableMonths: ['2026-09'], now: new Date('2026-09-12T18:00:00Z') });
  assert.equal(result.totals.dropeaAdjustmentsCost, null);
  assert.equal(result.totals.exactNetProfit, null);
  assert.equal(result.orderLedger[0].completeness, 'INCOMPLETE');
  assert.equal(result.coverage.dropeaBreakdownPercent, 0);
});

test('Madrid timezone and non-transit residual outcomes are explicit in the creation cohort', () => {
  const timezoneEdge = order('1385490', '2026-08-31T22:13:00Z', null, { lifecycle_status: 'CANCELLED' });
  const incident = order('august-incident', '2026-08-20T08:00:00Z', '2026-08-20T09:00:00Z', { lifecycle_status: 'INCIDENCE' });
  const julyLost = order('july-lost', '2026-07-20T08:00:00Z', '2026-07-20T09:00:00Z', { lifecycle_status: 'LOST_OR_DAMAGED' });
  const reports = [source('2026-07'), source('2026-08'), source('2026-09', 12)];
  const september = buildResultsFinanceReport({ month: '2026-09', orders: [timezoneEdge, incident, julyLost], rates,
    supplementalReports: reports, availableMonths: ['2026-07', '2026-08', '2026-09'], now: new Date('2026-09-12T18:00:00Z') });
  assert.equal(september.counts.created, 1);
  assert.equal(september.counts.cancelledBeforeConfirmation, 1);
  const august = september.history.find((item) => item.month === '2026-08');
  const july = september.history.find((item) => item.month === '2026-07');
  assert.equal(august.counts.otherOutcome, 1);
  assert.equal(august.counts.inTransit, 0);
  assert.equal(july.counts.otherOutcome, 1);
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

test('audited Dropea monthly reports remain authoritative from May and cannot be inflated by later event dates', () => {
  const fixtures = [
    ['2026-05', 844.75, 784.44, 60.31, 301.04, 0, 0, 25, 10],
    ['2026-06', 4958.52, 3314.53, 1643.99, 1453.10, 35.26, 8.85, 148, 51],
    ['2026-07', 9616.50, 8057.51, 1558.99, 3744.52, 176.39, 101.72, 314, 137],
    ['2026-08', 4748.50, 3951.33, 797.17, 1902.14, 176.39, 0, 150, 54],
    ['2026-09', 3718.87, 3432.51, 286.36, 1702.96, 176.39, 0, 113, 21]
  ];
  const reports = fixtures.map(([month, revenue, totalCosts, profit, metaSpend, fixedCosts, oneOffCosts, delivered, returned]) => {
    const elapsedDays = month === '2026-09' ? 12 : new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
    const providerCosts = Number((totalCosts - metaSpend - fixedCosts - oneOffCosts).toFixed(2));
    const daily = Array.from({ length: elapsedDays }, (_, index) => ({
      day: `${month}-${String(index + 1).padStart(2, '0')}`,
      created: index ? 0 : delivered + returned,
      confirmed: index ? 0 : delivered + returned,
      sent: index ? 0 : delivered + returned,
      delivered: index ? 0 : delivered,
      returned: index ? 0 : returned,
      realRevenue: index ? 0 : revenue,
      productCost: index ? 0 : providerCosts,
      outboundShippingCost: 0,
      outboundFulfillmentCost: 0,
      codCost: 0,
      returnCost: 0,
      dropeaAdjustmentsCost: 0,
      metaSpend: index ? 0 : metaSpend,
      fixedCosts: fixedCosts ? Number((fixedCosts / elapsedDays + (index % 2 ? -0.001 : 0.001)).toFixed(2)) : 0,
      oneOffCosts: index ? 0 : oneOffCosts,
      otherCosts: 0
    }));
    return {
      period: { month, current: month === '2026-09', until: daily.at(-1).day, elapsedDays, daysInMonth: month === '2026-09' ? 30 : elapsedDays },
      counts: { created: delivered + returned, confirmed: delivered + returned, sent: delivered + returned,
        delivered, returned, inTransit: 0, pending: 0, rejected: 0, deliveredUnits: delivered, returnedUnits: returned,
        confirmationRatePercent: 100, deliveryRatePercent: Number((delivered * 100 / (delivered + returned)).toFixed(2)) },
      totals: { realRevenue: revenue, revenue, productCost: providerCosts, outboundShippingCost: 0,
        outboundFulfillmentCost: 0, codCost: 0, returnCost: 0, dropeaAdjustmentsCost: 0,
        logisticsCost: 0, metaSpend, fixedCosts, oneOffCosts, otherCosts: 0, totalCosts,
        exactNetProfit: profit, roiPercent: Number((profit * 100 / totalCosts).toFixed(2)),
        marginPercent: Number((profit * 100 / revenue).toFixed(2)), roas: Number((revenue / metaSpend).toFixed(2)) },
      days: daily,
      expenseLedger: fixedCosts ? [{ name: 'Recurrentes', type: 'recurring_monthly', amount: fixedCosts,
        appliedAmount: fixedCosts, startDate: `${month}-01`, endDate: null }] : [],
      quality: { status: 'OK', issues: [] }, controls: { sourceReady: true },
      coverage: { dropeaBreakdownPercent: 100 }, generatedAt: '2026-09-13T10:00:00Z'
    };
  });
  const result = buildResultsFinanceReport({ month: '2026-07', orders, rates, supplementalReports: reports,
    availableMonths: ['2026-03', '2026-04', ...fixtures.map(([month]) => month)], now: new Date('2026-09-13T12:00:00Z') });
  assert.equal(result.source, 'dropea_order_finance_v4');
  assert.equal(result.totals.exactNetProfit, 1558.99);
  assert.equal(result.totals.realRevenue, 9616.50);
  assert.equal(result.totals.totalCosts, 8057.51);
  assert.deepEqual(result.availableMonths, ['2026-09', '2026-08', '2026-07', '2026-06', '2026-05']);
  assert.deepEqual(result.history.map((item) => item.totals.exactNetProfit), [60.31, 1643.99, 1558.99, 797.17, 286.36]);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'orderLedger'), false);
  const september = buildResultsFinanceReport({ month: '2026-09', orders, rates, supplementalReports: reports,
    now: new Date('2026-09-13T12:00:00Z') });
  assert.equal(september.totals.exactNetProfit, 286.36);
  assert.equal(new Set(september.days.map((day) => Number(day.fixedCosts).toFixed(6))).size, 1);
  assert.equal(Number(september.days.reduce((sum, day) => sum + day.fixedCosts, 0).toFixed(2)), 176.39);
  assert.equal(september.quality.status, 'OK');
});

test('authoritative monthly source keeps funnel rates separate from economic event totals', () => {
  const july = source('2026-07', 31, {
    counts: {
      created: 613,
      sent: 452,
      delivered: 314,
      returned: 137,
      inTransit: 1,
      cancelled: 161,
      deliveredUnits: 500,
      returnedUnits: 200
    },
    eventCounts: { shipped: 440, delivered: 321, deliveredUnits: 511, returned: 142, returnedUnits: 207 },
    totals: { exactNetProfit: 1, realRevenue: 10, totalCosts: 9, fixedCosts: 0, oneOffCosts: 0, otherCosts: 0 }
  });
  const result = buildResultsFinanceReport({
    month: '2026-07', orders: [], rates, supplementalReports: [july], availableMonths: ['2026-07'],
    now: new Date('2026-09-13T12:00:00Z')
  });
  assert.equal(result.counts.confirmed, 452);
  assert.equal(result.counts.confirmationRatePercent, 73.74);
  assert.equal(result.eventCounts.delivered, 321);
  assert.equal(result.eventCounts.returned, 142);
});

test('results finance refresh remains fast with a production-sized order history', { timeout: 5_000 }, () => {
  const months = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
  const largeOrderSet = Array.from({ length: 1_500 }, (_, index) => {
    const month = months[index % months.length];
    const day = String((index % 24) + 1).padStart(2, '0');
    const deliveredDay = String((index % 24) + 3).padStart(2, '0');
    return order(`load-${index}`, `${month}-${day}T08:00:00Z`, `${month}-${day}T09:00:00Z`, {
      lifecycle_status: 'FINISHED', delivered_at_utc: `${month}-${deliveredDay}T10:00:00Z`
    });
  });
  const startedAt = performance.now();
  const result = buildResultsFinanceReport({
    month: '2026-09', orders: largeOrderSet, rates,
    supplementalReports: months.map((month) => source(month)), availableMonths: months,
    now: new Date('2026-09-25T18:00:00Z')
  });
  const elapsedMs = performance.now() - startedAt;
  assert.equal(result.history.length, months.length);
  assert.ok(elapsedMs < 3_000, `production-sized refresh took ${elapsedMs.toFixed(0)}ms`);
});

test('known lost orders are not presented as in transit and independent confirmed count outranks sent',()=>{
  const july=source('2026-07',31,{counts:{created:5,confirmed:4,sent:3,delivered:1,returned:1,inTransit:1,pending:0,cancelled:1,returnRatePercent:100,deliveryRatePercent:100},
    totals:{realRevenue:0,totalCosts:0,exactNetProfit:0},
    orders:[{orderId:'105',status:'INTRANSIT',productCost:0,outboundShippingCost:0,outboundFulfillmentCost:0,codCost:0,returnCost:0,dropeaAdjustmentsCost:0}]});
  const result=buildResultsFinanceReport({month:'2026-07',orders:[order('105','2026-07-01T10:00:00Z','2026-07-01T11:00:00Z',{lifecycle_status:'LOST_OR_DAMAGED'})],supplementalReports:[july],now:new Date('2026-09-17T04:00:00Z')});
  assert.equal(result.counts.inTransit,0);
  assert.equal(result.counts.otherOutcome,1);
  assert.equal(result.counts.confirmationRatePercent,80);
  assert.equal(result.counts.returnRatePercent,33.33);
  assert.equal(result.counts.deliveryRatePercent,33.33);
  assert.equal(result.accounting.closedThrough,null);
});
