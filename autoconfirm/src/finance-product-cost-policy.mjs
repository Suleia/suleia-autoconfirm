import {createHash} from 'node:crypto';

const day = value => {
  const text = String(value || '').slice(0,10);
  const parsed=new Date(text+'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0,10)!==text) throw Error('FINANCE_PRODUCT_COST_DATE_INVALID');
  return text;
};

export function normalizeProductCostRates(input) {
  if (!Array.isArray(input) || input.length>1000) throw Error('FINANCE_PRODUCT_COST_RATES_INVALID');
  const rates=input.map(row=>{
    const product_id=String(row.product_id||''),variant_id=String(row.variant_id||''),amount=Number(row.amount);
    if (String(row.store_id)!=='16088'||!/^\d{1,18}$/.test(product_id)||!/^\d{1,18}$/.test(variant_id)||row.cost_type!=='PRODUCT_COGS'||row.currency!=='EUR'
      ||row.source!=='OWNER_VERIFIED_PRODUCT_COST'||row.amount===null||row.amount===''||!Number.isFinite(amount)||amount<0||amount>100000
      ||Math.abs(amount*100-Math.round(amount*100))>1e-6) throw Error('FINANCE_PRODUCT_COST_RATE_INVALID');
    const effective_from=day(row.effective_from),effective_to=row.effective_to?day(row.effective_to):null;
    if(effective_to&&effective_to<effective_from)throw Error('FINANCE_PRODUCT_COST_WINDOW_INVALID');
    return {store_id:String(row.store_id||'16088'),cost_type:'PRODUCT_COGS',product_id,variant_id,amount,currency:'EUR',
      effective_from,effective_to,source:'OWNER_VERIFIED_PRODUCT_COST'};
  }).sort((a,b)=>`${a.store_id}:${a.product_id}:${a.variant_id}:${a.effective_from}`.localeCompare(`${b.store_id}:${b.product_id}:${b.variant_id}:${b.effective_from}`));
  for(let i=0;i<rates.length;i++)for(let j=i+1;j<rates.length;j++){
    const a=rates[i],b=rates[j];
    if(a.store_id===b.store_id&&a.product_id===b.product_id&&a.variant_id===b.variant_id
      &&a.effective_from<=(b.effective_to||'9999-12-31')&&b.effective_from<=(a.effective_to||'9999-12-31'))throw Error('FINANCE_PRODUCT_COST_OVERLAP');
  }
  return rates;
}

export function productCostRateVersion(rates) {
  return createHash('sha256').update(JSON.stringify(normalizeProductCostRates(rates))).digest('hex');
}

export function mergeGovernedProductCosts(base, rates) {
  const governed=normalizeProductCostRates(rates);
  return {...structuredClone(base),version:base.version+':'+productCostRateVersion(governed).slice(0,16),governedProductCostVersion:productCostRateVersion(governed),
    rates:[...governed.map(rate=>({...rate,product_id:Number(rate.product_id),variant_id:Number(rate.variant_id),amount_cents:Math.round(rate.amount*100),unit:'PER_DELIVERED_UNIT'})),...structuredClone(base.rates)]};
}
