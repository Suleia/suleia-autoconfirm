import {isSupabaseEnabled,selectRows,upsertRows} from './clients/supabase.mjs';
import {loadFinanceCostRules} from './finance-data.mjs';
import {normalizeProductCostRates,productCostRateVersion,mergeGovernedProductCosts} from './finance-product-cost-policy.mjs';

const KEY='finance_governed_product_cogs_v1';
export async function readGovernedProductCosts({enabled=isSupabaseEnabled,select=selectRows}={}){
  if(!enabled())return {rates:[],version:productCostRateVersion([]),revision:'0'};
  const rows=await select('app_state',{query:{key:'eq.'+KEY},limit:1});
  const value=rows[0]?.value;
  if(!value)return {rates:[],version:productCostRateVersion([]),revision:'0'};
  const rates=normalizeProductCostRates(value.rates);
  if(value.version!==productCostRateVersion(rates))throw Error('FINANCE_PRODUCT_COST_SNAPSHOT_INVALID');
  return {...value,rates};
}
export async function loadGovernedFinanceCostRules(options={}){
  const snapshot=await readGovernedProductCosts(options);
  return mergeGovernedProductCosts(loadFinanceCostRules(),snapshot.rates);
}
let synchronization=Promise.resolve();
export function syncGovernedProductCosts(input,options={}){
  const task=synchronization.then(()=>applyGovernedProductCosts(input,options));
  synchronization=task.catch(()=>{});return task;
}
async function applyGovernedProductCosts(input,{enabled=isSupabaseEnabled,select=selectRows,upsert=upsertRows,now=()=>new Date()}={}){
  if(!enabled())throw Error('FINANCE_PRODUCT_COST_PERSISTENCE_REQUIRED');
  const rates=normalizeProductCostRates(input.rates),version=productCostRateVersion(rates);
  const revision=String(input.revision??'');
  if(!/^\d{1,20}$/.test(revision))throw Error('FINANCE_PRODUCT_COST_REVISION_INVALID');
  if(input.version!==version)throw Error('FINANCE_PRODUCT_COST_VERSION_INVALID');
  const previous=await readGovernedProductCosts({enabled,select});
  if(BigInt(revision)<BigInt(previous.revision||'0'))throw Error('FINANCE_PRODUCT_COST_STALE_REVISION');
  if(revision===String(previous.revision||'0')&&previous.version!==version&&BigInt(revision)>0n)throw Error('FINANCE_PRODUCT_COST_REVISION_CONFLICT');
  if(previous.version===version&&String(previous.revision||'0')===revision)return {changed:false,version,revision,affectedFrom:null};
  const changed=[...previous.rates,...rates].filter(rate=>{
    const opposite=previous.rates.includes(rate)?rates:previous.rates;
    return !opposite.some(other=>JSON.stringify(other)===JSON.stringify(rate));
  });
  const affectedFrom=changed.map(rate=>rate.effective_from).sort()[0]||null;
  const snapshot={version,revision,rates,source:'CANONICAL_OPERATIONS_FINANCE_COST_RATES',updatedAt:now().toISOString()};
  await upsert('app_state',{key:KEY,value:snapshot,updated_at:snapshot.updatedAt},{onConflict:'key'});
  return {changed:previous.version!==version,version,revision,affectedFrom};
}
