import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

class Element {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this.hidden = false; this.textContent = ''; this.value = ''; this.disabled = false; this.options = []; this.style = { setProperty: (key, value) => { this.style[key] = value; } }; this.classList = { add() {}, remove() {}, toggle() {} }; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this[name] = String(value); }
  addEventListener() {}
  reset() {}
  focus() {}
  querySelector() { return new Element('button'); }
}

function content(element) { return `${element.textContent || ''} ${element.children.map((child) => typeof child === 'string' ? child : content(child)).join(' ')}`.trim(); }

test('results dashboard renders headline KPIs, charts and the permanently visible reconciled daily table', async () => {
  const source = `${fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8')}\nglobalThis.__results = { state, renderResultsFinance };`;
  const elements = new Map(); const get = (id) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const storage = new Map();
  const context = {
    URL, URLSearchParams, TextEncoder, btoa, crypto: webcrypto, Intl, console, setInterval() {},
    location: { origin: 'https://mcp.suleia.com', pathname: '/operations/', search: '' }, history: { replaceState() {} },
    sessionStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, String(value)), removeItem: (key) => storage.delete(key) },
    document: { title: 'Operations Center', getElementById: get, createElement: (tag) => new Element(tag), createElementNS: (_ns, tag) => new Element(tag), createTextNode: (text) => String(text), querySelectorAll: () => [], addEventListener() {}, visibilityState: 'visible' },
    fetch: async () => ({ ok: true, json: async () => ({ oauth: { issuer: 'https://mcp.suleia.com/auth/realms/suleia', client_id: 'suleia-operations-center', audience: 'suleia-operations-center', scope: 'openid operations:read' }, refresh_interval_seconds: 45 }) })
  };
  await vm.runInNewContext(source, context);
  context.__results.state.finance = {
    period: { month: '2026-07', current: false, elapsedDays: 31 }, status: 'reconstructed', currency: 'EUR', generatedAt: '2026-09-12T10:00:00Z',
    counts: { created: 500, confirmed: 420, pendingConfirmation: 20, cancelledBeforeConfirmation: 60, sent: 420, delivered: 280, returned: 100, inTransit: 40, inAir: 40, deliveryRatePercent: 66.67, confirmationRatePercent: 84, statusBreakdown: {} },
    eventCounts: { delivered: 314, returned: 137 },
    totals: { realRevenue: 9616.5, productCost: 900, outboundShippingCost: 1000, outboundFulfillmentCost: 400, codCost: 350, returnCost: 720.62, dropeaAdjustmentsCost: 200, metaSpend: 3744.52, fixedCosts: 176.39, oneOffCosts: 101.72, otherCosts: 0, totalCosts: 8057.51, exactNetProfit: 1558.99, roiPercent: 19.35, roas: 2.57, marginPercent: 16.21 },
    days: [{ day: '2026-07-01', created: 12, delivered: 8, returned: 2, realRevenue: 240, productCost: 35, outboundShippingCost: 30, outboundFulfillmentCost: 8, codCost: 9, returnCost: 10.52, dropeaAdjustmentsCost: 3, metaSpend: 90, fixedCosts: 5.68, oneOffCosts: 3.28, otherCosts: 0, totalCosts: 194.48, netProfit: 45.52, marginPercent: 18.97, roiPercent: 23.41 }],
    history: [{ month: '2026-06', totals: { realRevenue: 4958.52, totalCosts: 3314.53, exactNetProfit: 1643.99 } }, { month: '2026-07', totals: { realRevenue: 9616.5, totalCosts: 8057.51, exactNetProfit: 1558.99 } }],
    comparison: { deltas: { exactNetProfit: { percent: -5 }, realRevenue: { percent: 94 }, totalCosts: { percent: 143 }, roiPercent: { percent: -12 }, roas: { percent: -8 }, marginPercent: { percent: -31 } } },
    quality: { status: 'OK', issues: [] }, controls: { dailyRevenueReconciled: true, dailyCostsReconciled: true, profitReconciled: true }, coverage: { dropeaBreakdownPercent: 100 }, sources: { orders: 'Dropea Public API V2' }, definitions: { netProfit: 'Fórmula conciliada', returnCost: '5,26 € por pedido solo como respaldo' }, expenseLedger: [{ name: 'Servidor', type: 'recurring_monthly', category: 'Infraestructura', amount: 13.13, appliedAmount: 13.13, startDate: '2026-07-01' }]
  };
  context.__results.renderResultsFinance();
  assert.equal(get('finance-hero').children.length, 10);
  assert.match(content(get('finance-hero')), /Beneficio mensual/);
  assert.match(content(get('finance-hero')), /1558,99/);
  assert.equal(get('finance-trend').children[0].children[1].tagName, 'svg');
  assert.match(content(get('finance-daily')), /TOTAL DEL MES/);
  assert.match(content(get('finance-daily')), /Meta Ads/);
  assert.match(content(get('finance-daily')), /Fijos/);
  assert.match(content(get('finance-daily')), /Puntuales/);
  assert.match(content(get('finance-daily')), /Otros/);
  assert.match(content(get('finance-daily')), /Beneficio neto/);
  assert.match(content(get('finance-fixed-expenses')), /Servidor/);
  assert.match(content(get('finance-costs')), /Publicidad Meta/);
  assert.match(content(get('finance-operational-summary')), /Pedidos creados/);
  assert.match(content(get('finance-data-summary')), /Datos conciliados/);
  context.__results.state.finance.period = { month: '2026-09', current: true, elapsedDays: 13 };
  context.__results.state.finance.accounting = { closedThrough: '2026-09-12', pendingDays: 1, currentDayPartial: true };
  context.__results.state.finance.dataAvailability = { status: 'MTD', label: 'MTD · día 13' };
  context.__results.state.finance.quality = { status: 'REVIEW', issues: ['ADVERTISING:2026-09-13'] };
  context.__results.renderResultsFinance();
  assert.match(content(get('finance-exactness')), /cierre contable hasta/);
  assert.match(content(get('finance-exactness')), /1 día\(s\) pendiente\(s\)/);
});
