import assert from 'node:assert/strict';
import test from 'node:test';
import {normalizeProductCostRates,productCostRateVersion,mergeGovernedProductCosts} from './finance-product-cost-policy.mjs';
import {loadGovernedFinanceCostRules,syncGovernedProductCosts} from './finance-product-costs.mjs';
import {aggregateFinanceReport,resolveFinancePeriod,applyFinanceExpenseLedger} from './finance.mjs';
import {buildResultsFinanceReport} from '../../packages/platform-core/src/finance/results-report.mjs';
const rate={store_id:'16088',cost_type:'PRODUCT_COGS',product_id:'33560',variant_id:'33788',amount:0.87,currency:'EUR',effective_from:'2026-10-19',effective_to:null,source:'OWNER_VERIFIED_PRODUCT_COST'};
const base={version:'fixture',effective_from:'2026-05-01',rates:[],products:{},logistics:{},source:'fixture'};
const fixture=(id,quantity,wholesale=0)=>({id,status:'FINISH',sub_status:'DELIVERED',created_at:'2026-10-19T10:33:27Z',delivered_at:'2026-10-21T12:00:00Z',total_amount:34.99,line_items:[{product_id:33560,variant_id:33788,quantity,wholesale_price:wholesale,product_name:'Fixture'}],expenses_breakdown:{product_price:0,shipping_outbound_price:4.06,fulfillment_outbound_price:1,cod_commission:1.2,total_expenses:6.26,is_estimate:false}});
const period=resolveFinancePeriod('2026-10',{now:new Date('2026-10-24T12:00:00Z')});
const report=(orders,rates=[])=>aggregateFinanceReport({orders,period,rules:mergeGovernedProductCosts(base,rates),expenses:[],metaRows:[],metaAvailable:true});
test('owner-verified exact product tariff values quantities in integer cents',()=>{
 for(const [q,expected] of [[1,0.87],[2,1.74],[3,2.61]])assert.equal(report([fixture('1',q)],[rate]).totals.productCost,expected);
 assert.equal(report([fixture('1',2),fixture('2',2)],[rate]).totals.productCost,3.48);
});
test('zero wholesale without a rate is unknown, preserves known costs and identifies the affected product',()=>{
 const r=report([fixture('1',2)]);assert.equal(r.days.find(d=>d.day==='2026-10-19').unknownProductCostUnits,2);
 assert.equal(r.totals.productCost,null);assert.equal(r.totals.exactNetProfit,null);
 assert.equal(r.productCostCoverage.knownAmount,0);assert.equal(r.productCostFindings[0].variant_id,'33788');
 assert.deepEqual(r.productCostFindings[0].order_ids,['1']);assert.equal(r.productCostFindings[0].units,2);
});
test('owner tariff outranks positive supplier product total and wholesale',()=>{
 const o=fixture('1',2,7);o.expenses_breakdown.product_price=10;o.expenses_breakdown.total_expenses=16.26;
 assert.equal(report([o],[rate]).totals.productCost,1.74);
});
test('two repaired orders add 3.48 to the known monthly product cost and reconcile all daily purchase-cohort amounts',()=>{
 const first=fixture('1',2),second={...fixture('2',2),created_at:'2026-10-20T10:00:00Z'};
 const other=fixture('3',2);other.line_items=[{product_id:31666,variant_id:31666,quantity:2,wholesale_price:1.01}];other.expenses_breakdown={...other.expenses_breakdown,product_price:2.02,total_expenses:8.28};
 const before=report([first,second,other]),after=report([first,second,other],[rate]);
 assert.equal(before.productCostCoverage.missingUnits,4);assert.equal(after.productCostCoverage.missingUnits,0);
 assert.equal(before.totals.knownProductCost,2.02);assert.equal(after.totals.productCost,5.50);
 assert.equal(Number((after.totals.productCost-before.totals.knownProductCost).toFixed(2)),3.48);
 const canonical=buildResultsFinanceReport({month:'2026-10',supplementalReports:[after],now:new Date('2026-10-24T12:00:00Z')});
 for(const key of ['sourceDailyCostsReconciled','sourceDailyProfitReconciled','sourceProfitFormulaReconciled','sourceDailyInputsComplete','sourceDailyCohortAmountsReconciled'])assert.equal(canonical.controls[key],true,key);
 assert.equal(canonical.coverage.exactProfitAvailable,true);
 for(const day of ['2026-10-19','2026-10-20'])assert.notEqual(canonical.days.find(row=>row.day===day).netProfit,null);
});
test('expense accrual cannot turn a missing product cost into a zero or a daily profit',()=>{
 const r=applyFinanceExpenseLedger(report([fixture('1',2)]),[]);
 assert.equal(r.days.find(d=>d.day==='2026-10-19').netProfit,null);assert.equal(r.totals.productCost,null);
 const complete=report([fixture('1',2)],[rate]);for(const d of complete.days)delete d.knownProductCost;
 const legacy=applyFinanceExpenseLedger(complete,[]);assert.equal(legacy.totals.productCost,1.74);
});
test('the tariff starts on the actual first day and never matches another product reusing a variant or SKU',()=>{
 const early={...fixture('1',2),created_at:'2026-10-18T12:00:00Z'};
 assert.equal(report([early],[rate]).productCostCoverage.missingUnits,2);
 const other=fixture('2',2);other.line_items[0].product_id=999;
 assert.equal(report([other],[rate]).productCostCoverage.missingUnits,2);
});
test('governed snapshots validate identity, currency, dates, version, overlap and source',()=>{
 for(const patch of [{amount:null},{amount:0.871},{product_id:'name'},{currency:'USD'},{source:'guess'},{effective_from:'2026-02-30'}])assert.throws(()=>normalizeProductCostRates([{...rate,...patch}]));
 assert.throws(()=>normalizeProductCostRates([rate,rate]),/OVERLAP/);
 assert.equal(productCostRateVersion([rate]),productCostRateVersion(normalizeProductCostRates([rate])));
});
test('the canonical snapshot is durable, idempotent and consumed after a source restart',async()=>{
 let state=null,writes=0;const dependencies={enabled:()=>true,select:async()=>state?[{value:state}]:[],upsert:async(_table,row)=>{state=row.value;writes++;}};
 const input={rates:[rate],version:productCostRateVersion([rate]),revision:'1'};
 assert.equal((await syncGovernedProductCosts(input,dependencies)).affectedFrom,'2026-10-19');
 assert.equal((await syncGovernedProductCosts(input,dependencies)).changed,false);assert.equal(writes,1);
 const rules=await loadGovernedFinanceCostRules(dependencies);assert.equal(rules.rates[0].amount_cents,87);
 await assert.rejects(syncGovernedProductCosts({...input,version:'invented'},dependencies),/VERSION/);
});
test('out-of-order snapshots and concurrent requests cannot replace a newer audited cost revision',async()=>{
 let state=null;const dependencies={enabled:()=>true,select:async()=>state?[{value:state}]:[],upsert:async(_table,row)=>{await new Promise(setImmediate);state=row.value;}};
 const newer=[{...rate,amount:0.90}],first={rates:newer,version:productCostRateVersion(newer),revision:'2'},old={rates:[rate],version:productCostRateVersion([rate]),revision:'1'};
 const results=await Promise.allSettled([syncGovernedProductCosts(first,dependencies),syncGovernedProductCosts(old,dependencies)]);
 assert.equal(results[0].status,'fulfilled');assert.equal(results[1].status,'rejected');assert.equal(state.rates[0].amount,0.90);assert.equal(state.revision,'2');
});
