const JULY_2026_ROWS = [
  ['2026-07-01', 17, 16, 459.84, 9, 264.91, 17.17, 64.96, 9, 19.20, 36.82, 92.37, 8.97],
  ['2026-07-02', 21, 15, 454.85, 9, 284.91, 21.21, 60.90, 9, 18.00, 31.56, 110.92, 8.97],
  ['2026-07-03', 17, 11, 309.89, 8, 224.92, 13.13, 44.66, 8, 13.20, 15.78, 111.78, 8.97],
  ['2026-07-04', 18, 12, 359.88, 8, 239.92, 16.16, 48.72, 8, 14.40, 21.04, 96.02, 8.97],
  ['2026-07-05', 27, 21, 599.52, 13, 369.69, 24.18, 85.26, 13, 25.20, 42.08, 182.86, 8.97],
  ['2026-07-06', 17, 15, 458.67, 9, 264.82, 18.14, 60.90, 9, 18.00, 31.56, 121.83, 8.97],
  ['2026-07-07', 22, 19, 519.81, 11, 299.89, 16.16, 77.14, 11, 22.80, 42.08, 105.46, 8.97],
  ['2026-07-08', 14, 12, 344.88, 11, 314.89, 19.19, 48.72, 11, 14.40, 5.26, 94.63, 8.97],
  ['2026-07-09', 26, 20, 569.80, 10, 279.90, 16.16, 81.20, 10, 24.00, 52.60, 92.59, 8.97],
  ['2026-07-10', 15, 13, 359.87, 8, 219.92, 12.12, 52.78, 8, 15.60, 26.30, 92.82, 8.97],
  ['2026-07-11', 16, 13, 374.87, 10, 284.90, 17.17, 52.78, 10, 15.60, 15.78, 95.40, 8.97],
  ['2026-07-12', 27, 18, 544.82, 11, 339.89, 23.79, 73.08, 11, 21.60, 36.82, 152.83, 8.97],
  ['2026-07-13', 24, 17, 514.83, 11, 349.89, 25.38, 69.02, 11, 20.40, 31.56, 133.70, 8.97],
  ['2026-07-14', 29, 22, 699.78, 20, 644.80, 47.86, 89.32, 20, 26.40, 10.52, 150.35, 8.97],
  ['2026-07-15', 29, 21, 629.79, 16, 479.84, 31.87, 85.26, 16, 25.20, 26.30, 141.40, 8.97],
  ['2026-07-16', 16, 14, 429.86, 11, 339.89, 23.64, 56.84, 11, 16.80, 15.78, 115.58, 8.97],
  ['2026-07-17', 18, 14, 449.86, 11, 359.89, 26.95, 56.84, 11, 16.80, 15.78, 124.53, 8.97],
  ['2026-07-18', 27, 16, 499.84, 14, 434.86, 30.56, 64.96, 14, 19.20, 10.52, 140.67, 8.97],
  ['2026-07-19', 16, 10, 279.90, 6, 164.94, 9.09, 40.60, 6, 12.00, 21.04, 119.60, 8.97],
  ['2026-07-20', 13, 12, 344.88, 8, 229.92, 14.14, 48.72, 8, 14.40, 21.04, 106.94, 8.97],
  ['2026-07-21', 11, 9, 264.91, 5, 144.95, 9.09, 36.54, 5, 10.80, 21.04, 134.29, 8.97],
  ['2026-07-22', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 54.57, 8.97],
  ['2026-07-23', 3, 3, 89.97, 0, 0, 0, 12.18, 0, 3.60, 15.78, 37.30, 8.97],
  ['2026-07-24', 41, 25, 799.66, 19, 604.72, 43.65, 101.50, 19, 30.00, 31.56, 229.86, 8.97],
  ['2026-07-25', 42, 27, 844.73, 19, 599.81, 42.10, 109.62, 19, 32.40, 36.82, 244.51, 8.97],
  ['2026-07-26', 41, 27, 874.73, 19, 624.81, 45.52, 109.62, 19, 32.40, 42.08, 229.56, 8.97],
  ['2026-07-27', 25, 18, 579.82, 13, 424.87, 30.26, 73.08, 13, 21.60, 26.30, 170.51, 8.97],
  ['2026-07-28', 15, 11, 344.89, 9, 284.91, 20.03, 44.66, 9, 13.20, 10.52, 109.32, 8.97],
  ['2026-07-29', 33, 21, 704.79, 16, 539.84, 40.62, 85.26, 16, 25.20, 26.30, 140.84, 8.97],
  ['2026-07-30', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 8.97],
  ['2026-07-31', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 8.97]
];

export const FINANCE_COST_POLICY = Object.freeze({
  currency: 'EUR',
  effectiveFrom: '2026-05-01',
  outboundShippingPerSent: 4.06,
  outboundFulfillmentPerSent: 1.20,
  codPerDelivered: 1.00,
  returnPerReturned: 5.26,
  fixedCostPerCalendarDay: 8.97,
  productUnitCostsBySku: Object.freeze({
    '038_CREMAHIDRATANTE': 3.70,
    'CREMAHIDRATANTE': 3.70,
    'COLLAGUM': 1.01,
    'CREMANIDA': 1.44,
    'WHITEO2': 2.00,
    '1969_COLLAGUM': 1.01,
    '1969_CREMANIDA': 1.44,
    '1989_WHITEO2': 2.00
  })
});

function toCents(value) {
  const [whole, decimal = ''] = String(value ?? 0).replace(',', '.').split('.');
  return Number(whole) * 100 + Number(decimal.padEnd(2, '0').slice(0, 2));
}

function fromCents(value) {
  return value / 100;
}

function ratio(numerator, denominator, multiplier = 1) {
  return denominator ? Math.round((numerator / denominator) * multiplier * 100) / 100 : 0;
}

function normalizeRow(values) {
  const [
    day,
    sourceOrderCount,
    sent,
    estimatedRevenue,
    delivered,
    realRevenue,
    productCost,
    outboundShippingCost,
    codCost,
    outboundFulfillmentCost,
    returnCost,
    metaSpend,
    fixedCosts
  ] = values;
  const returned = Math.round(returnCost / FINANCE_COST_POLICY.returnPerReturned);
  const totalCostsCents = [productCost, outboundShippingCost, codCost, outboundFulfillmentCost, returnCost, metaSpend, fixedCosts].reduce((sum, value) => sum + toCents(value), 0);
  const netProfitCents = toCents(realRevenue) - totalCostsCents;
  const totalCosts = fromCents(totalCostsCents);
  const netProfit = fromCents(netProfitCents);
  return {
    day,
    sourceOrderCount,
    sent,
    estimatedRevenue,
    delivered,
    returned,
    realRevenue,
    productCost,
    outboundShippingCost,
    codCost,
    outboundFulfillmentCost,
    returnCost,
    metaSpend,
    fixedCosts,
    totalCosts,
    netProfit,
    roiPercent: ratio(netProfit, totalCosts, 100),
    estimatedCpa: ratio(metaSpend, sent),
    realCpa: ratio(metaSpend, delivered),
    deliveryRatePercent: ratio(delivered, sent, 100)
  };
}

function sum(rows, field) {
  return fromCents(rows.reduce((total, row) => total + toCents(row[field]), 0));
}

function buildJulyActual() {
  const days = JULY_2026_ROWS.map(normalizeRow).sort((a, b) => b.day.localeCompare(a.day));
  const totals = {
    estimatedRevenue: sum(days, 'estimatedRevenue'),
    realRevenue: sum(days, 'realRevenue'),
    productCost: sum(days, 'productCost'),
    outboundShippingCost: sum(days, 'outboundShippingCost'),
    codCost: sum(days, 'codCost'),
    outboundFulfillmentCost: sum(days, 'outboundFulfillmentCost'),
    returnCost: sum(days, 'returnCost'),
    metaSpend: sum(days, 'metaSpend'),
    fixedCosts: sum(days, 'fixedCosts')
  };
  totals.logisticsCost = fromCents(toCents(totals.outboundShippingCost) + toCents(totals.codCost) + toCents(totals.outboundFulfillmentCost) + toCents(totals.returnCost));
  totals.totalCosts = fromCents(toCents(totals.productCost) + toCents(totals.logisticsCost) + toCents(totals.metaSpend) + toCents(totals.fixedCosts));
  totals.exactNetProfit = fromCents(toCents(totals.realRevenue) - toCents(totals.totalCosts));
  totals.roiPercent = ratio(totals.exactNetProfit, totals.totalCosts, 100);
  const counts = {
    sourceOrderCount: sum(days, 'sourceOrderCount'),
    sent: sum(days, 'sent'),
    delivered: sum(days, 'delivered'),
    returned: sum(days, 'returned')
  };
  counts.deliveryRatePercent = ratio(counts.delivered, counts.sent, 100);
  totals.estimatedCpa = ratio(totals.metaSpend, counts.sent);
  totals.realCpa = ratio(totals.metaSpend, counts.delivered);
  return {
    month: '2026-07',
    status: 'closed_actual',
    label: 'Cierre contable verificado',
    source: 'Finanzas_07-2026 (1).xlsx · hoja 07-2026',
    audit: {
      previousPanelAmount: 5859.53,
      correctedNetProfit: 1537.91,
      overstatement: 4321.62,
      missingProductCost: 642.89,
      missingLogisticsCost: 3412.14,
      missingFixedCosts: 278.07,
      lateMetaDifference: 11.48
    },
    counts,
    totals,
    days
  };
}

const CLOSED_ACTUALS = new Map([['2026-07', buildJulyActual()]]);

export function getClosedFinanceActual(month) {
  const actual = CLOSED_ACTUALS.get(month);
  return actual ? structuredClone(actual) : null;
}
