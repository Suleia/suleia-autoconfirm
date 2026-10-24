const finite=Number.isFinite;
const quantile=(values,p)=>{const a=values.toSorted((x,y)=>x-y),at=(a.length-1)*p,low=Math.floor(at);return a[low]+(a[Math.ceil(at)]-a[low])*(at-low);};
export function buildGrowthGoal(input,policy={minOrders:30,minDays:7,maturityDays:7}){
 const base={targetOrdersPerDay:55,targetConfirmedPerDay:40,timeZone:'Europe/Madrid',attribution:'ACCOUNT_ORDER_COHORT_ONLY',campaignProfit:null,sustainableCpa:null,budgetScenarios:[],
  budgetReason:'No hay coste publicitario por pedido real con enlace Meta–Shopify–Dropea acreditado. El CPA atribuido no sustituye ese enlace.',
  note:'Objetivos y escenarios observacionales; aumentar inversión no garantiza pedidos ni confirmaciones.',externalWrites:0};
 if(!input)return {...base,state:'UNAVAILABLE',today:null,mature:null,scenarios:[],requiredOrders:null};
 const daily=input.matureDays||[],orders=daily.reduce((n,d)=>n+d.orders,0),confirmed=daily.reduce((n,d)=>n+d.confirmed,0);
 const valid=daily.every(d=>Number.isSafeInteger(d.orders)&&Number.isSafeInteger(d.confirmed)&&d.orders>=0&&d.confirmed>=0&&d.confirmed<=d.orders);
 const usable=daily.filter(d=>d.orders>=5),sufficient=valid&&orders>=policy.minOrders&&usable.length>=policy.minDays;
 const rate=sufficient&&orders>0?confirmed/orders:null;
 const scenarios=rate===null?[]:[['conservative',Math.min(rate,quantile(usable.map(d=>d.confirmed/d.orders),.25))],['central',rate],['favorable',Math.max(rate,quantile(usable.map(d=>d.confirmed/d.orders),.75))]]
  .map(([key,r])=>({key,confirmationRate:r,requiredOrders:r>0?Math.ceil(40/r):null,method:key==='central'?'POOLED_OBSERVED_COHORT_RATE':'EMPIRICAL_DAILY_QUARTILE_BOUNDED_BY_CENTRAL',budget:null}));
 return {...base,state:!valid?'INVALID':sufficient?'OBSERVED':'INSUFFICIENT_SAMPLE',observedAt:input.observedAt,today:input.today||null,
  mature:{orders,confirmed,confirmationRate:rate,days:daily.length,usableDays:usable.length,range:input.matureRange,maturityDays:policy.maturityDays,duplicateAssessment:input.duplicateAssessment||'UNAVAILABLE'},
  scenarios,requiredOrders:rate>0?Math.ceil(40/rate):null,
  scenarioNote:'Cuartiles descriptivos entre días acotados por la tasa agrupada central; no son intervalos de confianza ni ensayos binarios independientes.'};
}
