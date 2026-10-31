import test from 'node:test';
import assert from 'node:assert/strict';
import {aggregateFinanceReport,resolveFinancePeriod,applyFinanceExpenseLedger} from './finance.mjs';
const period=resolveFinancePeriod('2026-10',{now:new Date('2026-10-31T18:00Z')});
const make=(changes={})=>({id:991,created_at:'2026-10-20T12:00Z',status:'FINISH',sub_status:'DELIVERED',total_amount:29.99,
 delivered_at:'2026-10-23T12:00Z',line_items:[{product_id:31666,variant_id:31666,quantity:2,unit_price:29.99,sku:'COLLAGUM',wholesale_price:0}],
 expenses_breakdown:{product_price:0,fulfillment_extra_unit_price:0,fulfillment_outbound_price:1,shipping_outbound_price:4.06,cod_commission:1.2,
  shipping_refused_price:4.06,fulfillment_refused_price:1,tax_rate_dropea:18,tax_rate_supplier:0,equivalence_surcharge_rate:0,is_estimate:false,total_expenses:0},
 ...changes});
const build=o=>aggregateFinanceReport({period,orders:[o],expenses:[],metaRows:[]});
test('published zero provider total offsets all nominal logistics, preserving separate product COGS',()=>{
 const r=build(make()),o=r.orders[0];
 assert.equal(o.dropeaExpenses,0);assert.equal(o.dropeaAdjustmentsCost,-6.26);assert.equal(o.recognizedCost,2.02);
 assert.equal(r.totals.logisticsCost,0);assert.equal(r.totals.productCost,2.02);assert.equal(r.totals.exactNetProfit,27.97);
 assert.equal(r.products[0].dropeaAdjustmentsCost,-6.26);
 assert.equal(o.taxAudit.unclassifiedAdjustment,-7.39);
 assert.equal(r.financialAssurance.arithmetic,'ARITHMETIC_RECONCILED');
 assert.equal(r.financialAssurance.providerFinal,'INCOMPLETE');
 assert.equal(r.financialAssurance.revenue.cashVerified,null);
});
test('provider residual is separated from theoretical VAT and never charged twice',()=>{
 const o=make();o.expenses_breakdown.total_expenses=12.18;
 const r=build(o);assert.equal(r.orders[0].taxAudit.taxAtRate,1.13);
 assert.equal(r.orders[0].taxAudit.unclassifiedAdjustment,4.79);
 assert.equal(r.totals.dropeaAdjustmentsCost,5.92);
 assert.equal(r.orders[0].recognizedCost,14.2);
 assert.equal(r.financialAssurance.unidentifiedAdjustments.positiveAmount,4.79);
});
test('missing component or missing rate does not become zero during reconstruction',()=>{
 for(const key of ['product_price','shipping_outbound_price','tax_rate_dropea','tax_rate_supplier','equivalence_surcharge_rate']){
  const o=make();delete o.expenses_breakdown.total_expenses;o.expenses_breakdown[key]=null;
  const r=build(o);assert.equal(r.orders[0].dropeaExpenses,null,key);assert.equal(r.orders[0].recognizedCost,null,key);
  assert.equal(r.totals.totalCosts,null,key);assert.equal(r.totals.exactNetProfit,null,key);
  assert.equal(r.days.find(d=>d.day==='2026-10-20').dropeaAdjustmentsCost,null,key);
  assert.equal(applyFinanceExpenseLedger(r,[]).totals.totalCosts,null,key);
 }
});
test('complete component reconstruction remains visibly different from a published final charge',()=>{
 const o=make();delete o.expenses_breakdown.total_expenses;
 const r=build(o);assert.equal(r.orders[0].dropeaExpenses,7.39);assert.equal(r.orders[0].costBasis,'REBUILT_COMPONENTS');
 assert.equal(r.financialAssurance.rebuiltProviderTotals.orders,1);
 assert.equal(r.financialAssurance.publishedProviderTotals.orders,0);
});
test('awaiting carrier pickup is not proof of physical shipment or an economic charge date',()=>{
 const o=make({status:'SHIPPING',sub_status:'AWAITING_PICKUP',delivered_at:null,tracking_number:'test-tracking'});
 const r=build(o);assert.equal(r.orders[0].physicallyShipped,false);assert.equal(r.orders[0].costEventDate,null);
 assert.equal(r.orders[0].cashReceived,null);assert.equal(r.financialAssurance.provisionalCosts.orders,1);
});
test('return refund offsets components once; no COD or released product reserve is charged',()=>{
 const o=make({status:'ERROR',sub_status:'REJECTED',delivered_at:null,returned_at:'2026-10-23T12:00Z'});
 const r=build(o);assert.equal(r.orders[0].recognizedCost,0);assert.equal(r.totals.codCost,0);assert.equal(r.totals.productCost,0);
 assert.equal(r.totals.dropeaAdjustmentsCost,-10.12);
});
test('31-day October boundary preserves the Europe Madrid daylight-saving change',()=>{
 assert.equal(period.fromTimestamp,'2026-09-30T22:00:00.000Z');
 assert.equal(period.toTimestamp,'2026-10-31T22:59:59.999Z');assert.equal(build(make()).days.length,31);
});

test('late import uses the explicit purchase day for all cohort components, keeping the monthly result',()=>{
 const order=make({created_at:'2026-10-25T07:43:19Z',external_created_at:'2026-10-24T18:21:28Z'});
 const r=build(order),old=build({...order,external_created_at:null});
 assert.deepEqual(r.totals,old.totals);
 assert.equal(r.days.find(d=>d.day==='2026-10-24').created,1);
 assert.equal(r.days.find(d=>d.day==='2026-10-25').created,0);
 assert.equal(r.days.find(d=>d.day==='2026-10-24').realRevenue,29.99);
 assert.equal(r.orders[0].dropeaCreatedDay,'2026-10-25');
 assert.equal(r.financialAssurance.purchaseDates.importDayDifferences,1);
 assert.equal(old.financialAssurance.purchaseDates.fallbackOrders,1);
});

test('unreconciled cross-month, invalid or future purchase dates fail before replacing the last valid snapshot',()=>{
 for(const external_created_at of ['2026-09-30T12:00Z','invalid','2026-10-21T12:00Z'])
  assert.throws(()=>build(make({external_created_at})),/PURCHASE_DATE_REQUIRES_RECONCILIATION/);
});

test('date-only event evidence survives purchase-day correction and a second idempotent refresh',()=>{
 const order=make({delivered_at:null,external_created_at:'2026-10-19T12:00Z'});
 const old=build({...order,external_created_at:null});old.orders[0].settlementDay='2026-10-23';
 const refresh=previousOrders=>aggregateFinanceReport({period,orders:[order],expenses:[],metaRows:[],previousOrders});
 const first=refresh(old.orders),second=refresh(first.orders);
 assert.equal(first.orders[0].settlementDay,'2026-10-23');assert.deepEqual(first,second);
});
test('V2 final return charges remain in the financial cohort when event dates are unavailable',()=>{
 const o=make({status:'ERROR',sub_status:'REJECTED',delivered_at:null,tracking_number:'test-tracking'});o.expenses_breakdown.total_expenses=11.94;
 const r=build(o);assert.equal(r.counts.returned,1);assert.equal(r.orders[0].settlementDay,null);assert.equal(r.totals.returnCost,5.06);assert.equal(r.totals.realRevenue,0);
 delete o.tracking_number;const beforeShipment=build(o);assert.equal(beforeShipment.counts.returned,0);
});

