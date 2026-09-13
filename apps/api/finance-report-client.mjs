const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

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
      status: String(row?.status || 'UNKNOWN').slice(0, 40).toUpperCase(),
      breakdownStatus: String(row?.breakdownStatus || 'MISSING').slice(0, 40).toUpperCase(),
      units: Number.isFinite(Number(row?.units)) ? Math.max(0, Number(row.units)) : null
    };
    for (const field of FINANCE_ORDER_MONEY_FIELDS) safe[field] = nullableMoney(row?.[field]);
    return [safe];
  });
}

function safeReport(report) {
  if (!report || typeof report !== 'object' || !MONTH.test(String(report?.period?.month))) throw new Error('finance_report_invalid');
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
    expenseLedger: Array.isArray(report.expenseLedger) ? report.expenseLedger : [],
    // The Operations engine needs the final per-order Dropea breakdown to
    // reconcile event-date P&L. Keep only a strict finance whitelist: no
    // customer identifiers, external references or raw drilldowns cross this
    // server-to-server boundary.
    orders: safeFinanceOrders(report.orders),
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
  constructor({ baseUrl, password, fetchImpl = globalThis.fetch }) {
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
    this.password = String(password || '');
    this.fetch = fetchImpl;
    this.cookie = '';
    this.cache = new Map();
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
    if (cached && Date.now() - cached.at < 120_000) return cached.report;
    const payload = await this.request(`/api/finance?month=${encodeURIComponent(month)}`);
    if (!payload?.finance) throw Object.assign(new Error('finance_report_not_ready'), { status: 503 });
    const report = safeReport(payload.finance);
    this.cache.set(month, { at: Date.now(), report });
    return report;
  }

  async getMonthlyBundle(month) {
    const selected = await this.getMonthly(month);
    const months = selected.availableMonths.slice(0, 12);
    const rest = await Promise.all(months.filter((candidate) => candidate !== month).map((candidate) => this.getMonthly(candidate)));
    return [selected, ...rest];
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
