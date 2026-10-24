import test from 'node:test';
import assert from 'node:assert/strict';
import {aggregateFinanceReport,resolveFinancePeriod} from '../../autoconfirm/src/finance.mjs';
import {mergeGovernedProductCosts} from '../../autoconfirm/src/finance-product-cost-policy.mjs';
import {buildResultsFinanceReport} from '../../packages/platform-core/src/finance/results-report.mjs';

test('governed source repair reconciles all five canonical daily and monthly controls',()=>{
 const rate={store_id:'16088',cost_type:'PRODUCT_COGS',product_id:'33560',variant_id:'33788',amount:0.87,currency:'EUR',effective_from:'2026-10-19',effective_to:null,source:'OWNER_VERIFIED_PRODUCT_COST'};
 const rules=mergeGovernedProductCosts({version:'fixture',effective_from:'2026-05-01',rates:[],products:{},logistics:{},source:'fixture'},[rate]);
 const orders=['2026-10-19','2026-10-20'].map((day,i)=>({id:String(i+1),status:'FINISH',sub_status:'DELIVERED',created_at:day+'T10:00:00Z',delivered_at:'2026-10-21T12:00:00Z',total_amount:34.99,line_items:[{product_id:33560,variant_id:33788,quantity:2,wholesale_price:0}],expenses_breakdown:{product_price:0,shipping_outbound_price:4.06,fulfillment_outbound_price:1,cod_commission:1.2,total_expenses:6.26,is_estimate:false}}));
 const now=new Date('2026-10-24T12:00:00Z');
 const source=aggregateFinanceReport({orders,period:resolveFinancePeriod('2026-10',{now}),rules,expenses:[],metaRows:[],metaAvailable:true});
 const canonical=buildResultsFinanceReport({month:'2026-10',supplementalReports:[source],now});
 assert.equal(source.totals.productCost,3.48);
 for(const key of ['sourceDailyCostsReconciled','sourceDailyProfitReconciled','sourceProfitFormulaReconciled','sourceDailyInputsComplete','sourceDailyCohortAmountsReconciled'])assert.equal(canonical.controls[key],true,key);
 assert.equal(canonical.coverage.exactProfitAvailable,true);
 for(const day of ['2026-10-19','2026-10-20'])assert.notEqual(canonical.days.find(row=>row.day===day).netProfit,null);
});
