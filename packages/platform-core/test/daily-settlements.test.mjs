import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDailySettlements } from '../src/finance/daily-settlements.mjs';

const day = {day:'2026-09-16',created:4,metaSpend:10,fixedCosts:11.02,oneOffCosts:3,otherCosts:0};
const settled={orderId:'101',createdDay:'2026-08-30',settlementDay:'2026-09-16',status:'DELIVERED',
  breakdownStatus:'DROPEA_FINAL',realizedRevenue:30,productCost:2,outboundShippingCost:4,
  outboundFulfillmentCost:1,codCost:1.2,returnCost:0,dropeaAdjustmentsCost:.8};
const source=(month,days,orders=[])=>({period:{month},generatedAt:'2026-09-16T15:00:00Z',days,orders,expenseLedger:[]});

test('daily settlements use actual terminal dates across cohorts and never count pending/cancelled orders',()=>{
  const reports=[source('2026-08',[],[settled]),source('2026-09',[day],[
    {...settled,orderId:'102',createdDay:'2026-09-15',status:'RETURNED',realizedRevenue:null,productCost:0,codCost:0,returnCost:4.06},
    {...settled,orderId:'103',status:'INTRANSIT',settlementDay:null},
    {...settled,orderId:'104',status:'REJECTED',settlementDay:null}
  ])];
  const result=buildDailySettlements({month:'2026-09',currentDay:day.day,reports});
  assert.deepEqual(result.eventCounts,{delivered:1,returned:1});
  assert.equal(result.days[0].realRevenue,30);
  assert.equal(result.days[0].returnCost,4.06); // Actual order cost, not a uniform tariff.
  assert.equal(result.days[0].closeStatus,'CURRENT_PARTIAL');
  assert.equal(result.productionWrites,0);
  assert.equal(result.totals.exactNetProfit,Number((30-9-9.86-10-11.02-3).toFixed(6)));
});

test('calendar fixed accrual does not reallocate the whole monthly cost into elapsed days',()=>{
  const september=source('2026-09',Array.from({length:16},(_,i)=>({...day,day:`2026-09-${String(i+1).padStart(2,'0')}`,oneOffCosts:0})),[settled]);
  september.expenseLedger=[{type:'recurring_monthly',amount:176.39,appliedAmount:176.39,startDate:'2026-07-01'}];
  const result=buildDailySettlements({month:'2026-09',currentDay:day.day,reports:[september]});
  assert.equal(result.days[0].fixedCosts,5.879667);
  assert.equal(new Set(result.days.map(r=>r.fixedCosts)).size,1);
  assert.equal(Number(result.totals.fixedCosts.toFixed(2)),94.07);
  assert.equal(september.expenseLedger[0].appliedAmount,176.39);
});

test('a missing cost, ad source or terminal date cannot masquerade as a closed zero-profit day',()=>{
  for (const missing of [{...settled,returnCost:null},{...settled,realizedRevenue:null},{...settled,settlementDay:null},{...settled,breakdownStatus:'FALLBACK'}]) {
    const result=buildDailySettlements({month:'2026-09',currentDay:'2026-09-17',reports:[source('2026-09',[day],[missing])]});
    assert.equal(result.days[0].netProfit,null);
    assert.equal(result.days[0].closeStatus,'PENDING');
    assert.equal(result.totals.exactNetProfit,null);
  }
  const result=buildDailySettlements({month:'2026-09',currentDay:'2026-09-17',reports:[source('2026-09',[{...day,metaSpend:null}],[settled])]});
  assert.equal(result.days[0].netProfit,null);
});

test('duplicate observations never charge a settlement twice',()=>{
  const result=buildDailySettlements({month:'2026-09',currentDay:day.day,reports:[source('2026-09',[day],[settled,settled])]});
  assert.equal(result.days[0].delivered,1);
  assert.equal(result.days[0].realRevenue,30);
  assert.equal(result.audit.duplicateConflicts,0);
});

test('a stale snapshot crossing midnight displays today as unavailable, not a zero-revenue loss',()=>{
  const report=source('2026-09',[day],[settled]);report.period.current=true;
  const result=buildDailySettlements({month:'2026-09',currentDay:'2026-09-17',reports:[report]});
  const today=result.days.at(-1);
  assert.equal(today.day,'2026-09-17');
  assert.equal(today.realRevenue,null);
  assert.equal(today.netProfit,null);
  assert.equal(today.delivered,null);
  assert.equal(today.closeStatus,'CURRENT_PARTIAL');
});
