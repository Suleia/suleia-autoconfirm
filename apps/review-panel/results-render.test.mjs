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
  addEventListener(name,callback) { (this.events ||= {})[name]=callback; }
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
    quality: { status: 'OK', issues: [] }, controls: { dailyRevenueReconciled: true, dailyCostsReconciled: true, profitReconciled: true }, coverage: { dropeaBreakdownPercent: 100 }, sources: { orders: 'Dropea Public API V2' }, definitions: { netProfit: 'Fórmula conciliada', returnCost: '5,26 € por pedido solo como respaldo' }, expenseLedger: [{ name: 'Servidor', type: 'recurring_monthly', category: 'Infraestructura', amount: 13.13, appliedAmount: 13.13, startDate: '2026-07-01' }],
    oldVsNew: [{ month: '2026-07', old: { profit: 2000 }, corrected: { profit: 1558.99 }, deltas: { profit: -441.01, revenue: 0, totalCosts: 441.01 }, profitOverstatement: 441.01, reconciles: true }],
    topOrderDifferences: [{ orderId: '1393175', oldMonth: '2026-06', economicMonth: '2026-07', eventType: 'DELIVERED', oldProfit: 20, correctedProfit: 18, delta: -2, reasons: ['WRONG_EVENT_MONTH'] }],
    orderLedger: [{ orderId: '1393175', economicDate: '2026-07-01', eventType: 'DELIVERED', units: 1, revenue: 29.99, productCost: 1.01, outboundShippingCost: 4.06, outboundFulfillmentCost: 1, codCost: 1.2, returnCost: 0, dropeaAdjustmentsCost: 0, totalCost: 7.27, profit: 22.72, completeness: 'COMPLETE', missing: [] }]
  };
  context.__results.renderResultsFinance();
  assert.equal(get('finance-hero').children.length, 10);
  assert.match(content(get('finance-hero')), /Beneficio mensual conciliado/);
  assert.match(content(get('finance-hero')), /1558,99/);
  assert.equal(get('finance-trend').children[0].children[1].children[0].tagName, 'svg');
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
  assert.doesNotMatch(content(get('finance-trend')), /Acumulado|Beneficio acumulado/);
  assert.equal(content(get('finance-order-ledger')), '');
  assert.match(content(get('finance-return-rates')), /julio/);
  assert.doesNotMatch(content(get('finance-return-rates')), /junio/);
  assert.equal(get('finance-return-rates').children[0].children[1].className,'donut-layout');
  assert.doesNotMatch(content(get('finance-return-rates')), /Creados|Confirmados/);
  const countTags=(element,tag)=>Number(element.tagName===tag)+element.children.reduce((n,c)=>n+(typeof c==='string'?0:countTags(c,tag)),0);
  assert.equal(countTags(get('finance-hero'),'svg'),20); // Distinct native icons + real sparklines.
  context.__results.state.finance.dailySettlements={label:'Fecha real',limitation:'No mezclar con cohorte',days:[{...context.__results.state.finance.days[0],realRevenue:300,netProfit:105.52,closeLabel:'Liquidaciones observadas'}],totals:{realRevenue:300,totalCosts:194.48,exactNetProfit:105.52},eventCounts:{delivered:10,returned:2}};
  context.__results.renderResultsFinance();
  assert.match(content(get('finance-daily-model')), /fecha de compra/);
  assert.match(content(get('finance-daily-caption')), /misma cohorte/);
  assert.match(content(get('finance-trend')), /Ganancia diaria|Meta del día/);
  assert.match(content(get('finance-daily')), /TOTAL DEL MES/);
  assert.doesNotMatch(content(get('finance-trend')), /105,52/);
  assert.match(content(get('finance-daily')), /1558,99/);
  const cohortFooter=get('finance-daily').children[0].children[0].children.at(-1).children[0];
  assert.equal(cohortFooter.children[2].textContent,'280');
  assert.equal(cohortFooter.children[3].textContent,'100');
  assert.equal(countTags(get('finance-trend'),'title'),0); // No enormous native tooltip.
  const svg=get('finance-trend').children[0].children[1].children[0];
  const group=svg.children.find(c=>c.role==='button'); group.events.click();
  assert.equal(context.__results.state.financeSelectedDay,'2026-07-01');
  const finance=context.__results.state.finance;
  finance.days=[{...finance.days[0],created:null,delivered:null,returned:null,realRevenue:null,totalCosts:null,netProfit:null}];
  finance.counts={created:null,delivered:null,returned:null};
  finance.totals={realRevenue:null,totalCosts:null,exactNetProfit:null};
  context.__results.renderResultsFinance();
  const footer=get('finance-daily').children[0].children[0].children.at(-1).children[0];
  for(const index of [1,2,3]) assert.equal(footer.children[index].textContent,'—');
  // Every day has an axis label and an exact, selectable amount, including
  // previously unlabeled 12/13. Large negative amounts stay below zero.
  finance.days=Array.from({length:31},(_,i)=>({...finance.days[0],day:`2026-07-${String(i+1).padStart(2,'0')}`,netProfit:i===12?-200:50,created:21,delivered:11,returned:0}));
  context.__results.renderResultsFinance();
  const calendar=get('finance-trend').children[0].children.find(c=>c.className==='daily-result-calendar');
  assert.equal(calendar.children.length,31);
  const allDaysSvg=get('finance-trend').children[0].children[1].children[0];
  assert.equal(allDaysSvg.children.filter(c=>c.class==='chart-day-label').length,31);
  for(const day of [5,12,13]){calendar.children[day-1].events.click();assert.equal(context.__results.state.financeSelectedDay,`2026-07-${String(day).padStart(2,'0')}`);assert.match(content(get('finance-trend')),/Pedidos comprados este día/);}
  finance.temporalModels={pnl:'REALIZED_EVENT_DATE'};finance.totals={exactNetProfit:9999};
  context.__results.renderResultsFinance();assert.doesNotMatch(content(get('finance-hero')),/9999/);assert.match(content(get('finance-quality')),/no disponible/);
  delete finance.temporalModels;
  context.__results.state.finance.period = { month: '2026-09', current: true, elapsedDays: 13 };
  context.__results.state.finance.accounting = { closedThrough: '2026-09-12', pendingDays: 1, currentDayPartial: true };
  context.__results.state.finance.dataAvailability = { status: 'MTD', label: 'MTD · día 13' };
  context.__results.state.finance.quality = { status: 'REVIEW', issues: ['ADVERTISING:2026-09-13'] };
  context.__results.renderResultsFinance();
  assert.match(content(get('finance-exactness')), /cierre contable hasta/);
  assert.match(content(get('finance-exactness')), /1 día\(s\) pendiente\(s\)/);
});
