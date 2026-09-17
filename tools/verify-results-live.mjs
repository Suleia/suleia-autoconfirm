import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { loadOperationsConfig } from '../apps/api/server.mjs';
import { createFinanceReportClient } from '../apps/api/finance-report-client.mjs';
import { OperationsRepository } from '../packages/suleia-operations-mcp/src/operations/repository.mjs';

// Actual API-role data and deployed UI code, using read-only audit operations.
class Element {
  constructor(tag='div') {this.tagName=tag;this.children=[];this.hidden=false;this.value='';this.options=[];this.style={setProperty:(k,v)=>{this.style[k]=v;}};this.classList={add(){},remove(){},toggle(){}};this._text='';}
  get textContent(){return this._text+this.children.map(c=>typeof c==='string'?c:c.textContent).join('');}
  set textContent(value){this._text=String(value);this.children=[];}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this._text='';this.children=children;}
  setAttribute(k,v){this[k]=String(v);}
  addEventListener(name,callback){(this.events ||= {})[name]=callback;}
  reset(){} focus(){} querySelector(){return new Element('button');}
}
const config=loadOperationsConfig();
const repo=await OperationsRepository.connect(config.databaseUrl,{privateDataKey:config.privateDataKey});
const client=createFinanceReportClient(config);
const html=readFileSync(new URL('../apps/review-panel/index.html',import.meta.url),'utf8');
const script=readFileSync(new URL('../apps/review-panel/app.js',import.meta.url),'utf8');
const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
const elements=new Map();
const get=id=>{assert.ok(ids.has(id),`Deployed HTML missing referenced control ${id}`);if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
const storage=new Map();
const context={URL,URLSearchParams,TextEncoder,btoa,crypto:webcrypto,Intl,console,setInterval(){},
  location:{origin:'https://mcp.suleia.com',pathname:'/operations/',search:''},history:{replaceState(){}},
  sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},
  document:{title:'Operations Center',getElementById:get,createElement:t=>new Element(t),createElementNS:(_ns,t)=>new Element(t),createTextNode:t=>String(t),querySelectorAll:()=>[],addEventListener(){},visibilityState:'visible'},
  fetch:async()=>({ok:true,json:async()=>({oauth:{issuer:'https://mcp.suleia.com/auth/realms/suleia',client_id:'suleia-operations-center',audience:'suleia-operations-center',scope:'openid operations:read'},refresh_interval_seconds:45})})};
try {
  await vm.runInNewContext(script+'\nglobalThis.__results={state,renderResultsFinance};',context);
  const role=await repo.pool.query('SELECT current_user AS role');
  assert.equal(role.rows[0].role,'suleia_api_login');
  const reports=await client.getMonthlyBundle('2026-09');
  for(const month of ['2026-05','2026-06','2026-07','2026-08','2026-09']){
    const report=await repo.financialSummary(new URLSearchParams({month}),reports);
    assert.equal(report.source,'dropea_order_finance_v4');
    assert.equal(report.productionWrites,0);assert.equal(report.actions_executed,0);
    const failed=Object.entries(report.controls).filter(([,v])=>v!==true).map(([k])=>k);
    assert.deepEqual(failed,[]);
    assert.ok(report.dailySettlements);
    const round=v=>Number(v.toFixed(2));
    assert.equal(round(report.days.reduce((n,r)=>n+r.netProfit,0)),report.totals.exactNetProfit);
    assert.equal(round(report.days.reduce((n,r)=>n+r.fixedCosts,0)),report.totals.fixedCosts);
    context.__results.state.finance=report;context.__results.state.financeDailyBasis='settlement';context.__results.renderResultsFinance();
    assert.equal(get('finance-hero').children.length,10);
    assert.match(get('finance-daily').textContent,/TOTAL DEL MES/);
    assert.match(get('finance-daily-caption').textContent,/misma cohorte/);
    assert.match(get('finance-daily').textContent,new RegExp(new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(report.totals.exactNetProfit).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
    assert.match(get('finance-return-rates').children[0].children[1].className || '',/donut-layout/);
    const chart=get('finance-trend').children[0];const svg=chart.children[1].children[0];
    const bars=svg.children.filter(c=>c.role==='button');assert.equal(bars.length,report.days.length);
    assert.equal(svg.children.filter(c=>c.class==='chart-day-label').length,report.days.length);
    bars[0].events.click();assert.equal(context.__results.state.financeSelectedDay,report.days[0].day);
    const calendar=chart.children.find(c=>c.className==='daily-result-calendar');assert.equal(calendar.children.length,report.days.length);
    for(const day of ['2026-09-05','2026-09-12','2026-09-13','2026-09-15']){const index=report.days.findIndex(r=>r.day===day);if(index>=0){calendar.children[index].events.click();assert.equal(context.__results.state.financeSelectedDay,day);assert.match(get('finance-trend').textContent,/Pedidos comprados este día/);}}
    const footer=get('finance-daily').children[0].children[0].children.at(-1).children[0];
    assert.equal(footer.children[2].textContent,new Intl.NumberFormat('es-ES').format(report.counts.delivered));
    assert.equal(footer.children[3].textContent,new Intl.NumberFormat('es-ES').format(report.counts.returned));
    context.__results.state.financeDailyBasis='cohort';context.__results.renderResultsFinance();
    assert.match(get('finance-daily').textContent,/TOTAL DEL MES/);
    console.log(JSON.stringify({month,uiRendered:true,htmlControlsVerified:true,dailyBars:bars.length,returnRate:report.counts.returnRatePercent,
      inTransit:report.counts.inTransit,otherOutcome:report.counts.otherOutcome,cohortProfit:report.totals.exactNetProfit,
      fixedMonthly:report.totals.fixedCosts,settlementFixed:report.dailySettlements.totals.fixedCosts,
      calendarSettlements:report.dailySettlements.eventCounts,settlementAudit:report.dailySettlements.audit,
      currentDay:report.days.at(-1).day,currentDayProfit:report.days.at(-1).netProfit,
      focusDays:report.days.filter(r=>['2026-09-05','2026-09-12','2026-09-13','2026-09-15'].includes(r.day)).map(r=>({day:r.day,created:r.created,delivered:r.delivered,returned:r.returned,revenue:r.realRevenue,profit:r.netProfit})),
      failedControls:failed,role:role.rows[0].role,actions:0,writes:0}));
  }
} finally {await repo.close();}
