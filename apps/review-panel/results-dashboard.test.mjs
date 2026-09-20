import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

class Element {
  constructor(tag='div') { Object.assign(this,{tagName:tag,children:[],textContent:'',options:[],value:'',style:{setProperty(){}},classList:{add(){},remove(){},toggle(){}}}); }
  append(...items){this.children.push(...items);}
  replaceChildren(...items){this.children=items;}
  setAttribute(k,v){this[k]=String(v);}
  addEventListener(k,v){(this.events||={})[k]=v;}
  querySelector(){return new Element();}
  reset(){} focus(){}
}
const text=e=>typeof e==='string'?e:[e.textContent,...e.children.map(text)].join(' ');
const all=e=>[e,...e.children.flatMap(c=>typeof c==='string'?[]:all(c))];
function harness(){
  const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  const context={URL,URLSearchParams,TextEncoder,btoa,crypto:webcrypto,Intl,console,AbortController,setInterval(){},
    location:{origin:'https://example.invalid',pathname:'/operations/',search:''},history:{replaceState(){}},
    sessionStorage:{getItem(){return null;},setItem(){},removeItem(){}},
    document:{getElementById:get,createElement:t=>new Element(t),createElementNS:(_,t)=>new Element(t),createTextNode:String,querySelectorAll:()=>[],addEventListener(){},visibilityState:'visible'},
    fetch:async()=>({ok:true,json:async()=>({oauth:{}})})};
  vm.runInNewContext(fs.readFileSync(new URL('./results-dashboard.js',import.meta.url),'utf8')+'\n'+fs.readFileSync(new URL('./app.js',import.meta.url),'utf8')+'\nglobalThis.ui={ResultsV2,state,renderResultsFinance};',context);
  return {...context.ui,get};
}
function fixture(){return {
  period:{month:'2026-09',since:'2026-09-01',until:'2026-09-20',current:true},currency:'EUR',
  totals:{realRevenue:100,totalCosts:80,exactNetProfit:20,roiPercent:25,roas:5,marginPercent:20,productCost:10,outboundShippingCost:15,outboundFulfillmentCost:5,codCost:5,returnCost:10,dropeaAdjustmentsCost:5,metaSpend:20,fixedCosts:10,oneOffCosts:0,otherCosts:0},
  counts:{created:10,confirmed:8,sent:8,delivered:4,returned:2,inTransit:1,confirmationRatePercent:80,deliveryRatePercent:50,rejectionRatePercent:10,statusBreakdown:{delivered:4,returned:2,inAir:2,pending:1,cancelled:1}},
  days:[{day:'2026-09-01',created:10,confirmed:8,sent:8,delivered:4,returned:2,inTransit:1,realRevenue:100,totalCosts:80,netProfit:20,metaSpend:20,roas:5,confirmationRatePercent:80,deliveryRatePercent:50}],
  quality:{status:'OK',issues:[]},coverage:{dropeaBreakdownPercent:100,exactProfitAvailable:true},controls:{},definitions:{netProfit:'Ingresos menos costes'},
  freshness:{sources:Object.fromEntries(['dropea','meta','report'].map(k=>[k,{status:'OK',lastSyncAt:'2026-09-20T12:00:00Z'}]))},
  history:[{month:'2026-08',totals:{exactNetProfit:-10}},{month:'2026-09',period:{current:true},totals:{exactNetProfit:20}}],
  comparison:{available:false,deltas:{exactNetProfit:{percent:99}}}
};}

test('integrated results renderer preserves input, displays 12 canonical KPIs and six charts',()=>{
  const h=harness(),data=fixture(),before=JSON.stringify(data);h.state.finance=data;h.renderResultsFinance();
  assert.equal(JSON.stringify(data),before);
  const cards=h.get('finance-hero').children;assert.equal(cards.length,12);assert.equal(h.get('results-v2-charts').children.length,6);
  const expected=['20,00','100,00','80,00','25 %','5x','20 %','80 %','50 %','10 %','4','2','1'];
  cards.forEach((c,i)=>assert.ok(text(c.children.find(c=>c.className==='rv-kpi-value')).includes(expected[i]),`card ${i}`));
  assert.doesNotMatch(text(h.get('finance-hero')),/99 %|undefined/);
  assert.match(text(h.get('finance-daily')),/TOTAL DEL MES/);assert.match(text(h.get('finance-freshness')),/PROVISIONAL.*MTD/);
});
test('missing data differs from zero and event-date fallback cannot appear as cohort profit',()=>{
  const h=harness(),d=fixture();d.totals.roas=null;d.counts.inTransit=null;h.ResultsV2.render(d);
  assert.equal(h.get('finance-hero').children[4].children[2].textContent,'—');
  assert.equal(h.get('finance-hero').children[11].children[2].textContent,'—');
  d.totals.roas=0;h.ResultsV2.render(d);assert.equal(h.get('finance-hero').children[4].children[2].textContent,'0x');
  h.state.finance={...d,temporalModels:{pnl:'REALIZED_EVENT_DATE'}};h.renderResultsFinance();
  assert.equal(h.get('finance-hero').children[0].children[2].textContent,'No disponible');assert.match(text(h.get('results-v2-charts')),/Serie no disponible/);
});
test('source freshness and missing coverage never claim reconciled data',()=>{
  const {ResultsV2:v}=harness(),d=fixture();d.period.current=false;
  assert.match(text(v.DataQualityBadge(d)),/CONCILIADO/);
  d.freshness.sources.meta.status='STALE';assert.match(text(v.DataQualityBadge(d)),/ATRASADOS/);
  d.freshness.sources.meta.status='UNAVAILABLE';assert.match(text(v.DataQualityBadge(d)),/INCOMPLETO/);
  delete d.freshness;assert.match(text(v.DataQualityBadge(d)),/INCOMPLETO/);
});
test('cost increases are adverse, current incomplete comparisons are suppressed',()=>{
  const h=harness(),d=fixture();d.comparison={available:true,deltas:{totalCosts:{percent:12}}};h.ResultsV2.render(d);
  assert.equal(h.get('finance-hero').children[2].children.find(c=>c.className?.includes('rv-comparison')).className,'rv-comparison worse');
  d.comparison.available=false;h.ResultsV2.render(d);assert.doesNotMatch(text(h.get('finance-hero').children[2]),/12 %/);
});
test('charts preserve gaps, show negative months and mark MTD; noncohort history is unavailable',()=>{
  const h=harness(),d=fixture(),s=h.ResultsV2.Sparkline([1,2,null,3,4],'green');assert.equal(s.children.length,2);
  const hist=h.ResultsV2.history(d),bars=all(hist).filter(e=>e.role==='button');assert.equal(bars[0].fill,'#f45b79');assert.match(text(hist),/MTD/);
  h.state.financeCache.set('2026-08',{at:Date.now(),data:{...d,period:{...d.period,month:'2026-08'}}});
  bars[0].events.keydown({key:'Enter',preventDefault(){}});assert.equal(h.get('finance-month').value,'2026-08');
  d.history[0].temporalModels={pnl:'REALIZED_EVENT_DATE'};assert.match(all(h.ResultsV2.history(d)).find(e=>e.role==='button')['aria-label'],/No disponible/);
});
test('donut rejects overlapping states and waterfall never invents missing components',()=>{
  const {ResultsV2:v}=harness(),d=fixture();assert.match(text(v.statusChart(d)),/En tránsito \/ incidencias/);
  d.counts.statusBreakdown.inAir=3;assert.match(text(v.statusChart(d)),/no reconciliado/);
  d.totals.productCost=null;assert.match(text(v.waterfall(d)),/faltan componentes/);assert.doesNotMatch(text(v.waterfall(d)),/Producto 0,00/);
});
test('table footer uses backend totals and CSV follows selected columns without fabricated values',()=>{
  const h=harness(),d=fixture();d.totals.exactNetProfit=21;const table=h.ResultsV2.DailyResultsTable(d);
  assert.match(text(all(table).find(e=>e.tagName==='tfoot')),/21,00/);
  const option=all(table).find(e=>e.tagName==='label'&&text(e).includes('Publicidad')).children[0];option.checked=false;option.events.change();
  assert.doesNotMatch(h.ResultsV2.csvData(d),/Publicidad/);d.days[0].realRevenue=null;assert.match(h.ResultsV2.csvData(d),/"2026-09-01";"10";""/);
});
