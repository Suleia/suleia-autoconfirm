// Finance provenance only. Never calls providers or changes operational state.
const money = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const cents = value => money(value) ? Math.round(Number(value) * 100) : null;
const euro = value => value === null ? null : value / 100;
const status = value => String(value || '').toUpperCase();
const terminal = row => ['DELIVERED', 'RETURNED', 'FINISHED'].includes(status(row.status));

export function financeOrderEvidence({ order, row, charges = [] }) {
  const value = order.expenses_breakdown || {};
  const returned = status(row.status) === 'RETURNED';
  const published = cents(value.total_expenses);
  const settled = terminal(row);
  const basis = !settled ? 'PROVISIONAL_COMPONENTS'
    : published !== null && value.is_estimate === false ? 'PROVIDER_PUBLISHED_TOTAL'
    : value.is_estimate === false ? 'REBUILT_COMPONENTS' : 'ESTIMATE_OR_TARIFF';
  const componentKeys = ['shipping_outbound_price', 'fulfillment_outbound_price', 'fulfillment_extra_unit_price',
    ...(returned ? ['shipping_refused_price', 'fulfillment_refused_price'] : ['cod_commission'])];
  const componentValues = componentKeys.map(key => cents(value[key]));
  const base = componentValues.every(v => v !== null) ? componentValues.reduce((n,v) => n+v,0) : null;
  const rate = key => money(value[key]) ? Number(value[key]) : null;
  const tax = base !== null && rate('tax_rate_dropea') !== null ? Math.round(base*rate('tax_rate_dropea')/100) : null;
  const surcharge = base !== null && rate('equivalence_surcharge_rate') !== null ? Math.round(base*rate('equivalence_surcharge_rate')/100) : null;
  const providerProduct = cents(value.product_price);
  const supplierTax = providerProduct !== null && rate('tax_rate_supplier') !== null ? Math.round(providerProduct*rate('tax_rate_supplier')/100) : null;
  const residual = settled && published !== null && base !== null && providerProduct !== null && tax !== null && surcharge !== null && supplierTax !== null
    ? published-base-providerProduct-tax-surcharge-supplierTax : null;
  const physical = ['SHIPPED', 'IN_TRANSIT', 'IN_DELIVERY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'PAID', 'DELIVERY_EXCEPTION'].includes(status(order.sub_status))
    || returned && Boolean(order.tracking_number || order.tracking_code)
    || ['DELIVERED','RETURNED'].includes(status(order.status)) || Boolean(order.shipped_at || order.shipping_started_at || order.delivered_at || order.returned_at);
  const sources = Object.fromEntries(['product','shipping','fulfillment','cod','returns','dropeaAdjustments'].map(field => [field,
    [...new Set(charges.filter(c => c.field === field).map(c => c.sourceType === 'actual_order_cost' && basis !== 'PROVIDER_PUBLISHED_TOTAL'
      ? basis === 'REBUILT_COMPONENTS' ? 'reconstructed_provider_component' : 'provisional_provider_component' : c.sourceType))].join('+') || 'NOT_RECOGNIZED']));
  return {
    ...row,
    providerPublishedTotal: euro(published),
    costBasis: basis,
    costSources: sources,
    providerCalculatedAt: value.calculated_at || null,
    costEventDate: null, // A quote's calculated_at is not a Wallet debit date.
    cashSettlementDate: null,
    cashReceived: null, // PAID is a provider state, not a bank receipt.
    revenueBasis: status(row.status) === 'DELIVERED' ? 'DELIVERED_CURRENT_ORDER_AMOUNT' : 'NO_REALIZED_COD_SALE',
    paymentState: status(order.sub_status) === 'PAID' ? 'PROVIDER_REPORTED_PAID'
      : status(row.status) === 'DELIVERED' ? 'DELIVERED_SETTLEMENT_UNVERIFIED' : 'NOT_REALIZED',
    physicallyShipped: physical,
    discountApplied: null, // No inference from a conversation, offer or pack price.
    taxAudit: { base: euro(base), rate: rate('tax_rate_dropea'), taxAtRate: euro(tax),
      surchargeRate: rate('equivalence_surcharge_rate'), surchargeAtRate: euro(surcharge),
      supplierRate: rate('tax_rate_supplier'), supplierTaxAtRate: euro(supplierTax),
      unclassifiedAdjustment: euro(residual), basis: 'PROVIDER_RATES_NOT_TAX_INVOICE' },
    assurance: { source: basis, cash: 'MISSING', chargeDate: 'MISSING', status: 'PROVISIONAL' }
  };
}

export function buildFinanceAssurance(report) {
  const rows = report.orders || [], settled = rows.filter(terminal);
  const sum = (items,key) => euro(items.reduce((n,r) => n+(cents(r[key]) || 0),0));
  const fields = ['productCost','outboundShippingCost','outboundFulfillmentCost','codCost','returnCost','dropeaAdjustmentsCost'];
  const amountsComplete = rows.every(r => fields.every(k => money(r[k])) && money(r.recognizedCost));
  const sumsMatch = rows.length === Number(report.counts?.created)
    && fields.every(key => cents(sum(rows,key)) === cents(report.totals?.[key]));
  const arithmetic = money(report.totals?.exactNetProfit) && money(report.totals?.realRevenue) && money(report.totals?.totalCosts)
    && cents(report.totals.realRevenue)-cents(report.totals.totalCosts) === cents(report.totals.exactNetProfit)
    && sumsMatch && amountsComplete;
  const published = settled.filter(r => r.costBasis === 'PROVIDER_PUBLISHED_TOTAL');
  const reconstructed = settled.filter(r => r.costBasis === 'REBUILT_COMPONENTS');
  const provisional = rows.filter(r => !terminal(r) && (Number(r.recognizedCost) !== 0 || !money(r.recognizedCost)));
  const unknownAdjustments = published.filter(r => money(r.taxAudit?.unclassifiedAdjustment) && Number(r.taxAudit.unclassifiedAdjustment) !== 0);
  const paid = rows.filter(r => r.paymentState === 'PROVIDER_REPORTED_PAID');
  const notPaid = rows.filter(r => status(r.status)==='DELIVERED' && r.paymentState !== 'PROVIDER_REPORTED_PAID');
  return {
    version: 'FINANCIAL_EVIDENCE_V1',
    status: amountsComplete ? 'PROVISIONAL' : 'INCOMPLETE',
    arithmetic: arithmetic ? 'ARITHMETIC_RECONCILED' : 'INCOMPLETE',
    source: 'INCOMPLETE', // Current order state/quote does not prove every charge or receipt.
    providerFinal: 'INCOMPLETE',
    independentVerification: { meta: report.metaEvidence?.complete === true && report.metaEvidence.currency === 'EUR' && report.metaEvidence.timeZone === 'Europe/Madrid' ? 'SOURCE_RECONCILED' : 'NOT_EMBEDDED', cash: 'MISSING', invoices: 'MISSING' },
    publishedProviderTotals: { orders: published.length, amount: sum(published,'providerPublishedTotal') },
    rebuiltProviderTotals: { orders: reconstructed.length, amount: sum(reconstructed,'dropeaExpenses') },
    provisionalCosts: { orders: provisional.length, amount: sum(provisional,'recognizedCost') },
    unidentifiedAdjustments: { orders: unknownAdjustments.length,
      amount: euro(unknownAdjustments.reduce((n,r) => n+cents(r.taxAudit.unclassifiedAdjustment),0)),
      positiveAmount: euro(unknownAdjustments.reduce((n,r) => n+Math.max(0,cents(r.taxAudit.unclassifiedAdjustment)),0)),
      negativeAmount: euro(unknownAdjustments.reduce((n,r) => n+Math.min(0,cents(r.taxAudit.unclassifiedAdjustment)),0)) },
    revenue: { recognized: report.totals?.realRevenue ?? null, basis:'DELIVERED_ORDER_AMOUNT',
      providerReportedPaid:sum(paid,'realizedRevenue'),providerReportedPaidOrders:paid.length,
      deliveredUnverifiedSettlement:sum(notPaid,'realizedRevenue'),deliveredUnverifiedSettlementOrders:notPaid.length,
      cashVerified:null,realizedCashProfit:null },
    pendingOutcomeOrders: Number(report.counts?.inAir || 0)+Number(report.counts?.pending || 0),
    physicallyShippedOrders: rows.filter(r => r.physicallyShipped === true).length,
    purchaseDates: {
      source: 'DROPEA_CREATED_IN_PERIOD_INVENTORY',
      externalDateOrders: rows.filter(r => r.cohortDateBasis === 'PROVIDER_EXTERNAL_PURCHASE_DATE').length,
      fallbackOrders: rows.filter(r => r.cohortDateBasis !== 'PROVIDER_EXTERNAL_PURCHASE_DATE').length,
      importDayDifferences: rows.filter(r => r.dropeaCreatedDay && r.createdDay !== r.dropeaCreatedDay).length
    },
    warnings: [
      'Beneficio provisional por cohorte de compra; no acredita cobros bancarios ni un cierre definitivo.',
      'Inventario de altas Dropea del mes. Fecha de compra externa cuando consta; en pedidos manuales sin esa fecha se usa el alta y queda pendiente de verificar.',
      'Un total reconstruido con tarifas no es un cargo final publicado. calculated_at no es una fecha de cargo.',
      'Las cuotas calculadas con tipos del proveedor no sustituyen facturas; los residuos quedan separados.',
      'Publicidad y gastos generales se mantienen fuera de la contribución individual del pedido.'
    ]
  };
}

