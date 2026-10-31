const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
import {normalizeProductCostRates,productCostRateVersion} from '../../autoconfirm/src/finance-product-cost-policy.mjs';
import {buildFinanceAssurance} from '../../autoconfirm/src/finance-assurance.mjs';

function nextMonth(month) {
  const [year, value] = month.split('-').map(Number);
  const next = new Date(Date.UTC(year, value, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
}

function availableMonths(report) {
  const from = report?.availableRange?.from;
  const to = report?.availableRange?.to;
  if (!MONTH.test(String(from)) || !MONTH.test(String(to)) || from > to) {
    return [...new Set([report?.period?.month, ...(report?.history || []).map((item) => item?.month)].filter((value) => MONTH.test(String(value))))].sort().reverse();
  }
  const months = [];
  for (let cursor = from; cursor <= to && months.length < 120; cursor = nextMonth(cursor)) months.push(cursor);
  return months.reverse();
}

const FINANCE_ORDER_MONEY_FIELDS = [
  'orderAmount', 'realizedRevenue', 'dropeaExpenses', 'productCost',
  'outboundShippingCost', 'outboundFulfillmentCost', 'codCost', 'returnCost',
  'dropeaAdjustmentsCost', 'recognizedCost', 'dropeaOrderProfit', 'contributionAfterProduct'
];

function nullableMoney(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null;
}

function safeFinanceOrders(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const orderId = String(row?.orderId ?? '');
    if (!/^\d{1,18}$/.test(orderId)) return [];
    const safe = {
      orderId,
      createdDay: /^\d{4}-\d{2}-\d{2}$/.test(String(row?.createdDay)) ? row.createdDay : null,
      settlementDay: /^\d{4}-\d{2}-\d{2}$/.test(String(row?.settlementDay)) ? row.settlementDay : null,
      settlementDateSource: ['PROVIDER_EVENT_DATE','PRIOR_FINANCE_SNAPSHOT_DATE_ONLY'].includes(row.settlementDateSource) ? row.settlementDateSource : 'MISSING',
      status: String(row?.status || 'UNKNOWN').slice(0, 40).toUpperCase(),
      breakdownStatus: String(row?.breakdownStatus || 'MISSING').slice(0, 40).toUpperCase(),
      units: Number.isFinite(Number(row?.units)) ? Math.max(0, Number(row.units)) : null
    };
    for (const field of [...FINANCE_ORDER_MONEY_FIELDS,'providerPublishedTotal']) safe[field] = nullableMoney(row?.[field]);
    safe.costBasis = ['PROVIDER_PUBLISHED_TOTAL','REBUILT_COMPONENTS','PROVISIONAL_COMPONENTS','ESTIMATE_OR_TARIFF'].includes(row.costBasis) ? row.costBasis : 'LEGACY_SNAPSHOT_UNVERIFIED';
    safe.paymentState = ['PROVIDER_REPORTED_PAID','DELIVERED_SETTLEMENT_UNVERIFIED','NOT_REALIZED'].includes(row.paymentState) ? row.paymentState : 'UNVERIFIED';
    safe.physicallyShipped = typeof row.physicallyShipped === 'boolean' ? row.physicallyShipped : null;
    safe.providerCalculatedAt = /^\d{4}-\d{2}-\d{2}T/.test(String(row.providerCalculatedAt)) ? String(row.providerCalculatedAt).slice(0,40) : null;
    safe.cashReceived = null; safe.cashSettlementDate = null; safe.costEventDate = null; safe.discountApplied = null;
    const allowedSources = new Set(['actual_order_cost','estimated_order_cost','reconstructed_provider_component','provisional_provider_component','versioned_product_tariff','versioned_logistics_tariff','legacy_product_tariff','legacy_logistics_tariff','NOT_RECOGNIZED']);
    safe.costSources = Object.fromEntries(['product','shipping','fulfillment','cod','returns','dropeaAdjustments'].map(key=>[key,
      String(row.costSources?.[key]||'').split('+').filter(value=>allowedSources.has(value)).join('+')||'MISSING']));
    if(row.taxAudit) safe.taxAudit = {...Object.fromEntries(['base','rate','taxAtRate','surchargeRate','surchargeAtRate','supplierRate','supplierTaxAtRate','unclassifiedAdjustment'].map(key=>[key,nullableMoney(row.taxAudit[key])])),basis:'PROVIDER_RATES_NOT_TAX_INVOICE'};
    return [safe];
  });
}

function safeReport(report) {
  if (!report || typeof report !== 'object' || !MONTH.test(String(report?.period?.month))) throw new Error('finance_report_invalid');
  const orders = safeFinanceOrders(report.orders);
  return {
    period: report.period,
    status: report.status,
    statusLabel: report.statusLabel,
    temporalModels: report.temporalModels || {},
    dataAvailability: report.dataAvailability || null,
    counts: report.counts || {},
    eventCounts: report.eventCounts || {},
    totals: report.totals || {},
    days: Array.isArray(report.days) ? report.days : [],
    history: Array.isArray(report.history) ? report.history : [],
    comparison: report.comparison || null,
    projection: report.projection || null,
    coverage: report.coverage || {},
    quality: report.quality || {},
    warnings: Array.isArray(report.warnings) ? report.warnings : [],
    controls: report.controls || {},
    freshness: report.freshness || {},
    sources: report.sources || {},
    definitions: report.definitions || {},
    costTraceability: report.costTraceability || {},
    productCostFindings: Array.isArray(report.productCostFindings) ? report.productCostFindings : [],
    productCostCoverage: report.productCostCoverage || null,
    productCostVersion: report.productCostVersion || null,
    expenseLedger: Array.isArray(report.expenseLedger) ? report.expenseLedger : [],
    // The Operations engine needs the final per-order Dropea breakdown to
    // reconcile event-date P&L. Keep only a strict finance whitelist: no
    // customer identifiers, external references or raw drilldowns cross this
    // server-to-server boundary.
    orders,
    metaEvidence: report.metaEvidence?.complete === true && report.metaEvidence.currency === 'EUR' && report.metaEvidence.timeZone === 'Europe/Madrid'
      ? {complete:true,currency:'EUR',timeZone:'Europe/Madrid',since:String(report.metaEvidence.since||'').slice(0,10),until:String(report.metaEvidence.until||'').slice(0,10),readAt:String(report.metaEvidence.readAt||'').slice(0,40),basis:'ACCOUNT_LEVEL_MONETARY_SPEND'} : null,
    financialAssurance: report.financialAssurance ? buildFinanceAssurance({...report,orders}) : null,
    generatedAt: report.generatedAt || null,
    availableRange: report.availableRange || null,
    availableMonths: availableMonths(report),
    currency: 'EUR',
    source: 'render_finance_read_model',
    productionWrites: 0
  };
}

function cookieFrom(headers) {
  const values = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [headers.get('set-cookie')];
  const cookie = values.find(Boolean)?.split(';', 1)[0];
  if (!cookie?.startsWith('suleia_dashboard=')) throw new Error('finance_report_login_cookie_missing');
  return cookie;
}

export class FinanceReportClient {
  constructor({ baseUrl, password, fetchImpl = globalThis.fetch, now = () => Date.now(), refreshAfterMs = 15 * 60 * 1000 }) {
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
    this.password = String(password || '');
    this.fetch = fetchImpl;
    this.now = now;
    this.refreshAfterMs = refreshAfterMs;
    this.cookie = '';
    this.cache = new Map();
    this.refreshRequestedAt = new Map();
    if (!/^https:\/\//.test(this.baseUrl)) throw new Error('finance_report_base_url_must_use_https');
    if (!this.password) throw new Error('finance_report_password_required');
    if (typeof this.fetch !== 'function') throw new Error('finance_report_fetch_required');
  }

  async login() {
    const response = await this.fetch(`${this.baseUrl}/api/dashboard-login`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ password: this.password }),
      signal: AbortSignal.timeout(12_000)
    });
    if (![302, 303].includes(response.status)) throw new Error('finance_report_login_failed');
    this.cookie = cookieFrom(response.headers);
  }

  async request(path, options = {}, retried = false) {
    if (!this.cookie) await this.login();
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      ...options,
      redirect: 'manual',
      headers: { accept: 'application/json', cookie: this.cookie, ...(options.headers || {}) },
      signal: AbortSignal.timeout(20_000)
    });
    if (response.status === 401 && !retried) {
      this.cookie = '';
      return this.request(path, options, true);
    }
    if (!response.ok) throw Object.assign(new Error(`finance_report_http_${response.status}`), { status: response.status });
    return response.json();
  }

  async getMonthly(month) {
    if (!MONTH.test(String(month))) throw Object.assign(new Error('invalid_finance_month'), { status: 400 });
    const cached = this.cache.get(month);
    if (cached && this.now() - cached.at < 120_000) return cached.report;
    const payload = await this.request(`/api/finance?month=${encodeURIComponent(month)}`);
    if (!payload?.finance) throw Object.assign(new Error('finance_report_not_ready'), { status: 503 });
    const report = safeReport(payload.finance);
    report.financialSync = payload.financialSync ? {enabled:payload.financialSync.enabled===true,intervalMinutes:Number(payload.financialSync.intervalMinutes)||null,
      inFlight:Array.isArray(payload.financialSync.inFlight)?payload.financialSync.inFlight.filter(value=>MONTH.test(String(value))):[]} : null;
    const relevantRate=this.productCostRates?.some(rate=>rate.effective_from<=`${month}-31`&&(!rate.effective_to||rate.effective_to>=`${month}-01`));
    if(relevantRate&&this.productCostVersion!==report.productCostVersion){
      report.costConfiguration={status:'RECALCULATING',expectedVersion:this.productCostVersion,sourceVersion:report.productCostVersion};
      report.warnings=[...report.warnings,'Recálculo pendiente con la tarifa de producto actualizada; se muestra el último informe disponible.'];
      report.quality={...report.quality,status:'PARTIAL'};
    }
    this.cache.set(month, { at: this.now(), report });
    await this.refreshIfStale(report, month);
    return report;
  }

  async refreshIfStale(report, month) {
    if (!report?.period?.current) return false;
    const generatedAt = Date.parse(report.generatedAt || '');
    if (Number.isFinite(generatedAt) && this.now() - generatedAt <= this.refreshAfterMs) return false;
    const lastRequestedAt = this.refreshRequestedAt.get(month) || 0;
    if (this.now() - lastRequestedAt < this.refreshAfterMs) return false;
    this.refreshRequestedAt.set(month, this.now());
    try {
      await this.request(`/api/finance?month=${encodeURIComponent(month)}&refresh=1`);
      return true;
    } catch {
      this.refreshRequestedAt.delete(month);
      return false;
    }
  }

  async getMonthlyBundle(month) {
    const selected = await this.getMonthly(month);
    const months = selected.availableMonths.slice(0, 12);
    const rest = await Promise.all(months.filter((candidate) => candidate !== month).map((candidate) => this.getMonthly(candidate)));
    return [selected, ...rest];
  }

  async syncProductCosts(rows) {
    const rates=normalizeProductCostRates(rows.filter(row=>row.source==='OWNER_VERIFIED_PRODUCT_COST'));
    const version=productCostRateVersion(rates);
    const revision=String(rows[0]?.snapshot_revision||'0');
    if(this.productCostVersion===version&&this.productCostRevision===revision)return {changed:false,version};
    const payload=await this.request('/api/finance-product-costs/snapshot',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({rates,version,revision})});
    if(!payload?.ok||payload.result?.version!==version)throw Error('finance_product_cost_sync_failed');
    this.productCostVersion=version;this.productCostRevision=revision;this.productCostRates=rates;this.cache.clear();
    return payload.result;
  }

  async addExpense(input = {}) {
    const payload = await this.request('/api/finance-expenses', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input)
    });
    if (!payload?.expense) throw new Error('finance_expense_save_failed');
    this.cache.clear();
    return payload.expense;
  }
}

export function createFinanceReportClient(config) {
  if (!config.financeReportBaseUrl || !config.financeReportPassword) return null;
  return new FinanceReportClient({ baseUrl: config.financeReportBaseUrl, password: config.financeReportPassword });
}
