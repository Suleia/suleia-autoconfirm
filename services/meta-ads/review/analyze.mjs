import {createHash} from 'node:crypto';
import {aggregate,delta,verifiedSubtotal} from '../report.mjs';
import {CONTRACT,ratio,normalizeInsight} from '../metrics.mjs';
import {productLink} from '../product-links.mjs';
import {REVIEW_VERSION,REVIEW_POLICY,KNOWLEDGE,AUDIT_PROFILES} from './policy.mjs';
import {comparisonCompatibility,equivalentHourlyTraffic} from './periods.mjs';
import {robustOutliers} from './statistics.mjs';

const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const known=Number.isFinite;
const safe=x=>String(x||'').replace(/[\u0000-\u001f]/g,' ').slice(0,160);
const money=x=>known(x)?`${x.toFixed(2)} €`:'N/D';
const rate=(f,k,d)=>ratio(f?.[k]??null,f?.[d]??null);
export function reconcileCommerce(commerce){
 if(!commerce)return {status:'UNAVAILABLE',dependentConclusionsBlocked:false,issues:['COMMERCE_NOT_CONNECTED'],campaignProfit:null,attributedOrders:null};
 const issues=[];
 if(commerce.shop!==commerce.expectedShop)issues.push('SHOP_IDENTITY_MISMATCH');
 if(!commerce.observedAt||!commerce.range)issues.push('COMMERCE_CUT_UNKNOWN');
 if(commerce.orders>0&&commerce.sessionsThatCompletedCheckout===0)issues.push('ORDERS_WITH_ZERO_SESSION_CHECKOUTS');
 if(commerce.orders>0&&commerce.cartAdditions===0)issues.push('ORDERS_WITH_ZERO_CART_EVENTS');
 // Sales orders and browser session events have different populations. This is
 // reconciliation work, not evidence that no customer can reach checkout.
 return {status:issues.length?'RECONCILIATION_REQUIRED':'AGGREGATES_ONLY',dependentConclusionsBlocked:issues.length>0,issues,observedAt:commerce.observedAt,range:commerce.range,
  orders:commerce.orders??null,orderTotal:commerce.orderTotal??null,products:commerce.products||[],sessionsStatus:commerce.sessionsStatus||'SUPPLIED_AGGREGATES',
  campaignProfit:null,attributedOrders:null,note:'Sales are not settled cash. No campaign/order/cost linkage is verified. Session and order populations can differ (COD, imports, consent, channels, lag).'};
}
export function decompose(current,previous,compatible){
 const unavailable=reason=>({status:'UNAVAILABLE',reason,causal:false});
 if(!compatible)return unavailable('INCOMPATIBLE_PERIOD_OR_ATTRIBUTION');
 if(current.purchaseType!==previous?.purchaseType)return unavailable('PURCHASE_SCOPE_MISMATCH');
 if(!['spend','purchaseValue','purchases','linkClicks','impressions'].every(k=>current[k]>0&&previous?.[k]>0))return unavailable('POSITIVE_DENOMINATORS_REQUIRED');
 const before={cpm:previous.spend/previous.impressions*1000,ctr:previous.linkClicks/previous.impressions,conversionProxy:previous.purchases/previous.linkClicks,aov:previous.purchaseValue/previous.purchases};
 const after={cpm:current.spend/current.impressions*1000,ctr:current.linkClicks/current.impressions,conversionProxy:current.purchases/current.linkClicks,aov:current.purchaseValue/current.purchases};
 const factors=Object.fromEntries(Object.keys(before).map(k=>[k,after[k]/before[k]]));
 return {status:'DESCRIPTIVE_IDENTITY',causal:false,before,after,factors,cpaFactor:factors.cpm/factors.ctr/factors.conversionProxy,roasFactor:factors.aov*factors.conversionProxy*factors.ctr/factors.cpm,
  caveat:'Purchases include 7d click + 1d view attribution. Purchases/click is an algebraic proxy, not a click-only user conversion rate; no incremental or causal effect is established.'};
}
function sample(f,daily,range,policy,now,metadata){
 const days=new Set(daily.filter(x=>x.entityId===f.entityId&&x.spend!==null).map(x=>x.since)).size;
 const volume=f.spend>=policy.minSpend&&f.impressions>=policy.minImpressions&&f.purchases>=policy.minPurchases;
 const ageDays=metadata?.created_time?Math.floor((now-Date.parse(metadata.created_time))/86400000):null;
 const errors=[];
 if(f.roasStatus==='AMBIGUOUS'||f.quality?.purchase==='AMBIGUOUS')errors.push('AMBIGUOUS_PURCHASES');
 if(f.purchases===null||f.purchaseValue===null)errors.push('PURCHASE_MEASUREMENT_MISSING');
 if(!known(f.spend)||!known(f.impressions))errors.push('TRAFFIC_MEASUREMENT_MISSING');
 if(known(f.purchases)&&f.purchases>0&&f.initiateCheckout===0)errors.push('PURCHASES_WITH_ZERO_CHECKOUTS');
 return {state:errors.length?'MEASUREMENT_BLOCKED':!volume?'INSUFFICIENT_SAMPLE':range.partial?'PROVISIONAL':days<policy.matureAfterDays?'EXPLORATORY':'OBSERVATIONAL',volume,trafficVolume:f.spend>=policy.minSpend&&f.impressions>=policy.minImpressions,daysWithEvidence:days,ageDays,
  learning:metadata?.learning_stage_info||null,conversionLag:Date.parse(range.until+'T23:59:59Z')>now-policy.conversionLagDays*86400000?'POSSIBLE_LATE_CONVERSIONS':'WINDOW_ELAPSED_NOT_FROZEN',errors,
  interval:null,intervalReason:'Aggregated nonunique attributed events do not establish independent binary trials. No invented ROAS/CPA confidence interval.'};
}
function diagnoses(f,before,context){
 const out=[],{comparison,policy,quality,commerce,range,baselineRange,observedAt,daily,metadata}=context;
 const changes=Object.fromEntries(['linkCtr','linkCpc','cpm','roas','cpa'].map(k=>[k,comparison.comparable?delta(f[k],before?.[k]):null]));
 const add=(code,title,category,evidence,action,alternatives,priority=2)=>out.push({id:digest([f.level,f.entityId,code,range.since,range.until]),code,title,category,entityId:f.entityId,level:f.level,name:safe(f.name),priority,
  evidence:{...evidence,range,baselineRange,sample:{spend:f.spend,impressions:f.impressions,purchases:f.purchases,days:quality.daysWithEvidence}},observedAt,source:'META_INSIGHTS',contract:f.contract,classification:'HYPOTHESIS',
  confidence:quality.state==='OBSERVATIONAL'?'MEDIUM':'LOW',sampleState:quality.state,alternatives,action,risk:'La evidencia es observacional. Los retrasos de conversión y las diferencias de población pueden cambiar la conclusión.',
  validation:'Cambiar una variable en una prueba aprobada por separado; comparar periodos y atribución equivalentes y revisar medición y límites antes de decidir.',impact:null,externalWrites:0});
 if(quality.errors.length){add('MEASUREMENT_BLOCKED','Reconciliar los eventos','measurement',{issues:quality.errors},'Verificar eventos, deduplicación, ámbito de compra y fechas antes de diagnosticar una pérdida de conversión.',['Retraso en las conversiones atribuidas','Poblaciones distintas entre eventos','Diferencias de consentimiento o canal'],1);}
 if(!quality.trafficVolume||quality.errors.includes('TRAFFIC_MEASUREMENT_MISSING')||!comparison.comparable||!before)return out;
 const threshold=policy.materialChangePercent;
 if(changes.linkCtr<=-threshold)add('CTR_DECLINE','Revisar el mensaje y la audiencia','ad',{current:f.linkCtr,previous:before.linkCtr,changePercent:changes.linkCtr},'Preparar un concepto o mensaje alternativo y compararlo con esta creatividad.',['Cambio en la mezcla de audiencias','Cambios de ubicaciones','Competencia en la subasta']);
 if(changes.linkCpc>=threshold)add('CPC_INCREASE','Revisar el coste del tráfico','ad',{current:f.linkCpc,previous:before.linkCpc,changePercent:changes.linkCpc},'Separar el precio de la subasta de la respuesta al anuncio mediante CPM y CTR.',['Aumento del CPM','Descenso del CTR','Cambios de ubicación o dispositivo']);
 if(changes.cpm>=threshold)add('CPM_INCREASE','Revisar la presión de la subasta','delivery',{current:f.cpm,previous:before.cpm,ctrChange:changes.linkCtr},'Comparar audiencia, objetivo, ubicación y estacionalidad equivalentes antes de intervenir.',['Estacionalidad','Estrategia de puja','Mezcla de audiencias y ubicaciones']);
 const timeSeries=daily.filter(d=>d.entityId===f.entityId&&d.linkCtr!==null).toSorted((a,b)=>a.since.localeCompare(b.since));
 const tail=timeSeries.slice(-policy.minTrendDays),persistent=tail.length===policy.minTrendDays&&tail.every(d=>d.linkCtr<=before.linkCtr*(1-threshold/100));
 if(f.frequency!==null&&before.frequency!==null&&f.frequency>before.frequency&&persistent&&changes.linkCtr<=-threshold&&changes.linkCpc>=threshold&&changes.roas<=-threshold)
  add('POSSIBLE_FATIGUE','Investigar desgaste creativo persistente','creative',{frequency:f.frequency,previousFrequency:before.frequency,ctrChange:changes.linkCtr,cpcChange:changes.linkCpc,roasChange:changes.roas,consecutiveDays:tail.length},'Preparar otro concepto; comprobar audiencia y ubicaciones y probarlo antes de sustituir.',['Aumento del coste de subasta','Saturación de audiencia','Cambios en oferta o web'],2);
 if(quality.volume&&!quality.errors.length&&!commerce.dependentConclusionsBlocked)for(const[n,d,code,title,category]of[['landingPageViews','linkClicks','LANDING_DROP','Revisar la llegada a la landing','web'],['addToCart','landingPageViews','CART_DROP','Revisar ficha y oferta','web'],['initiateCheckout','addToCart','CHECKOUT_DROP','Revisar el acceso al checkout','checkout'],['purchases','initiateCheckout','PURCHASE_DROP','Revisar pago y medición','checkout']]){
  const a=rate(f,n,d),b=rate(before,n,d),change=delta(a,b);
  if(f[d]>=policy.minFunnelEvents&&before[d]>=policy.minFunnelEvents&&change!==null&&change<=-threshold&&f.purchaseType===before.purchaseType)
   add(code,title,category,{numerator:n,denominator:d,current:a,previous:b,changePercent:change},'Verificar la medición e inspeccionar esta etapa; proponer una prueba de una sola variable.',['Pérdida de eventos o deduplicación','Cambio de dispositivos o fuentes','Consentimiento, contra reembolso o retraso de informes']);
 }
 if(changes.roas<=-threshold)add('ROAS_DECLINE','Investigar la eficiencia atribuida','efficiency',{current:f.roas,previous:before.roas,changePercent:changes.roas},'Revisar la descomposición de indicadores y comprobar la hipótesis principal.',['Retraso de compras','Cambio en el valor del carrito','Mezcla de adquisición','Cambio de medición']);
 const events=metadata?.budgetEvents||[];
 if(events.length)add('BUDGET_CHANGED','Separar periodos antes y después del presupuesto','context',{events},'Comparar ventanas estables antes y después de cada cambio.',['Cambios simultáneos de creatividad','Subasta o estacionalidad'],3);
 return out;
}
function ranking(rows){
 const groups=new Map();
 for(const row of rows){const key=[row.objective||'UNKNOWN',row.optimizationGoal||'UNKNOWN',row.contract,row.purchaseType||'UNKNOWN',row.product?.products?.map(p=>p.productId||p.sku).toSorted().join(',')||`UNLINKED:${row.campaignId}`].join('|');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
 return [...groups.entries()].map(([key,items])=>{
  const candidates=items.filter(f=>f.sample.volume&&!['MEASUREMENT_BLOCKED','PROVISIONAL'].includes(f.sample.state)&&f.comparable&&f.roas!==null&&f.prior?.purchases>=REVIEW_POLICY.minPurchases&&f.objective&&f.optimizationGoal);
  const sorted=candidates.toSorted((a,b)=>b.roas-a.roas);
  const entry=(r,state)=>({entityId:r.entityId,name:r.name,level:r.level,roas:r.roas,cpa:r.cpa,purchases:r.purchases,spend:r.spend,state,profit:null,reason:'Attributed efficiency within an objective/optimization/attribution/product context; costs and incrementality are unknown.'});
  return {context:key,campaignName:items[0].campaignName,objective:items[0].objective,product:items[0].product?.name||'NO_ATRIBUIDO',rankingStatus:!items[0].objective||!items[0].optimizationGoal?'CONTEXT_MISSING':'EXPLORATORY',
   best:sorted.filter(f=>!f.diagnoses.some(d=>d.priority<=2)).slice(0,3).map(f=>entry(f,'VALIDATE_MARGIN')),
   worst:sorted.filter(f=>f.diagnoses.length).toReversed().slice(0,3).map(f=>entry(f,'REVIEW')),
   potential:candidates.filter(f=>f.linkCtr>f.prior?.linkCtr&&f.roas!==null&&f.roas>f.prior?.roas).slice(0,3).map(f=>entry(f,'VALIDATE_BEFORE_SCALING')),
   recoverable:items.filter(f=>f.diagnoses.some(d=>['web','checkout','creative'].includes(d.category))).slice(0,3).map(f=>entry(f,'TEST_HYPOTHESIS')),
   insufficient:items.filter(f=>!candidates.includes(f)).map(f=>({entityId:f.entityId,name:f.name,state:f.sample.state})),winner:null};
 });
}
export function analyzeReview({dataset,baseline=null,query={},extras={},commerce=null,productMappings=[],policy=REVIEW_POLICY,now=Date.now()}){
 const level=query.level||'campaign';if(!['campaign','adset','ad'].includes(level))throw Error('QUERY_INVALID');
 const ids=Array.isArray(query.campaignIds)?query.campaignIds:String(query.campaignIds||'').split(',').filter(Boolean);
 if(ids.length>policy.maxCampaigns||new Set(ids).size!==ids.length||ids.some(id=>!/^\d+$/.test(id)))throw Error('CAMPAIGN_SELECTION_INVALID');
 for(const k of ['campaignId','adsetId','adId'])if(query[k]&&!/^\d+$/.test(query[k]))throw Error('QUERY_INVALID');
 const range=dataset.range,baselineRange=baseline?.range||dataset.comparison;
 const comparison=comparisonCompatibility(range,baselineRange,CONTRACT,baseline?.current?.[level]?.[0]?.contract||CONTRACT);
 const commercial=reconcileCommerce(commerce),entityMap=new Map((dataset.entities[level]||[]).map(e=>[String(e.id),e]));
 const all=[...(dataset.current[level]||[])],previous=baseline?.current?.[level]||dataset.prior[level]||[];
 for(const e of dataset.entities[level]||[])if(!all.some(f=>f.entityId===String(e.id))){const missing=normalizeInsight({[level+'_id']:e.id,[level+'_name']:e.name,campaign_id:level==='campaign'?e.id:e.campaign_id,adset_id:level==='adset'?e.id:e.adset_id,ad_id:level==='ad'?e.id:undefined,date_start:range.since,date_stop:range.until},{level,accountId:String(dataset.account.id).replace(/^act_/,''),contract:CONTRACT,observedAt:dataset.observedAt,complete:true});all.push({...missing,source:'META_NO_INSIGHT_ROW'});}
 const priorMap=new Map(previous.map(f=>[f.entityId,f]));
 const accepts=f=>(!ids.length||ids.includes(f.campaignId))&&(!query.campaignId||query.campaignId===f.campaignId)&&(!query.adsetId||query.adsetId===f.adsetId)&&(!query.adId||query.adId===f.entityId)&&(!query.productId||productLink(f.campaignId,productMappings,now)?.products.some(p=>String(p.productId)===query.productId));
 if(query.productId&&!productMappings.some(m=>m.products?.some(p=>String(p.productId)===query.productId)))throw Error('PRODUCT_LINK_UNVERIFIED');
 const selected=all.filter(accepts);
 if(ids.some(id=>!dataset.entities.campaign.some(c=>String(c.id)===id)))throw Error('CAMPAIGN_SELECTION_INVALID');
 const rows=selected.map(f=>{
  const e=entityMap.get(f.entityId),c=(extras.metadata?.campaign||[]).find(c=>String(c.id)===f.campaignId),a=(extras.metadata?.adset||[]).find(a=>String(a.id)===f.adsetId);
  const metadata={...e,...(extras.metadata?.[level]||[]).find(x=>String(x.id)===f.entityId),budgetEvents:(extras.activities||[]).filter(x=>String(x.object_id)===f.entityId&&/budget/.test(String(x.event_type))).map(x=>({at:x.event_time,type:safe(x.event_type)}))};
  const before=priorMap.get(f.entityId)||null,same=comparison.comparable&&f.contract===before?.contract&&f.purchaseType===before?.purchaseType;
  const quality=sample(f,dataset.daily[level]||[],range,policy,now,metadata);
  const evidenceContext={comparison:{...comparison,comparable:same},policy,quality,commerce:commercial,range,baselineRange,observedAt:dataset.observedAt,daily:dataset.daily[level]||[],metadata};
  return {...f,name:safe(f.name),campaignName:safe(c?.name||dataset.entities.campaign.find(c=>String(c.id)===f.campaignId)?.name),prior:before,objective:c?.objective||null,optimizationGoal:a?.optimization_goal||null,delivery:e?.effective_status||'UNKNOWN',dailyBudgetCents:e?.daily_budget?Number(e.daily_budget):null,product:productLink(f.campaignId,productMappings,now),creative:extras.creatives?.find(x=>String(x.id)===f.entityId)?.creative||e?.creative||null,launchedAt:metadata.created_time||null,lastChangedAt:metadata.updated_time||null,creativeFormat:metadata.creative?.object_type||'UNAVAILABLE',sample:quality,comparable:same,
   diagnoses:diagnoses(f,before,evidenceContext),decomposition:decompose(f,before,same),profit:null,series:(dataset.daily[level]||[]).filter(x=>x.entityId===f.entityId).toSorted((a,b)=>a.since.localeCompare(b.since)),
   outliers:robustOutliers((dataset.daily[level]||[]).filter(x=>x.entityId===f.entityId).toSorted((a,b)=>a.since.localeCompare(b.since)).map(x=>x.spend))};
 });
 // Campaign optimization context must be homogeneous among its adsets to rank.
 for(const f of rows)if(level==='campaign'){const goals=new Set((extras.metadata?.adset||[]).filter(a=>String(a.campaign_id)===f.campaignId).map(a=>a.optimization_goal).filter(Boolean));f.optimizationGoal=goals.size===1?[...goals][0]:null;}
 const actual=selected.filter(f=>f.source==='META_INSIGHTS'),totals=aggregate(actual),priorSelected=previous.filter(accepts),before=aggregate(priorSelected);
 const accountScope=level==='campaign'&&!ids.length&&!['campaignId','adsetId','adId','productId'].some(k=>query[k])&&dataset.accountEvidence?.state==='AVAILABLE';
 const accountPrior=baseline?(baseline.accountEvidence?.state==='AVAILABLE'?baseline.accountEvidence.current:null):dataset.accountEvidence?.previous;
 if(accountScope)for(const [target,fact]of [[totals,dataset.accountEvidence.current],[before,accountPrior]].filter(([,fact])=>fact)){for(const [key,value]of Object.entries(fact))if(!['coverage','source','level','entityId','name','since','until'].includes(key))target[key]=value;target.scope='PROVIDER_ACCOUNT';for(const key of Object.keys(target.coverage))target.coverage[key]={known:Number.isFinite(fact[key])?1:0,total:1,status:Number.isFinite(fact[key])?'COMPLETE':'UNAVAILABLE',scope:'PROVIDER_ACCOUNT'};}
 // Reach/frequency are valid at one provider scope over the whole range. They
 // are neither summed across audiences nor averaged across daily rows.
 for(const [target,items]of [[totals,actual],[before,priorSelected]]){if(!accountScope){target.reach=items.length===1?items[0].reach:null;target.frequency=items.length===1?items[0].frequency:null;}}
 const budgetRows=rows.filter(r=>r.delivery==='ACTIVE');totals.dailyBudgetCents=level==='campaign'&&rows.length>0&&rows.every(r=>r.delivery!=='UNKNOWN')&&dataset.budgetObservation?.state!=='UNAVAILABLE'&&budgetRows.every(r=>Number.isSafeInteger(r.dailyBudgetCents))?budgetRows.reduce((n,r)=>n+r.dailyBudgetCents,0):null;
 before.dailyBudgetCents=null;
 const conversionCompatible=comparison.comparable&&totals.purchaseType===before.purchaseType;
 const recommendations=rows.flatMap(f=>f.diagnoses).toSorted((a,b)=>a.priority-b.priority||a.entityId.localeCompare(b.entityId));
 const warnings=[...(selected.some(f=>f.source!=='META_INSIGHTS')?['INVENTORY_WITHOUT_INSIGHTS']:[]),...comparison.reasons,...commercial.issues,...(extras.unavailable||[]),...(!previous.length?['BASELINE_NO_ROWS']:[]),...(range.partial?['PARTIAL_DAY','CONVERSION_LAG']:[]),...(rows.some(r=>r.sample.conversionLag==='POSSIBLE_LATE_CONVERSIONS')?['CONVERSION_LAG']:[]),...(dataset.creativeStatus==='UNAVAILABLE'?['CREATIVES_UNAVAILABLE']:[])];
 const coverage={requested:range,firstObservedDay:(dataset.daily[level]||[]).map(f=>f.since).toSorted()[0]||null,lastObservedDay:(dataset.daily[level]||[]).map(f=>f.since).toSorted().at(-1)||null,daysWithRows:new Set((dataset.daily[level]||[]).map(f=>f.since)).size,
  note:'Complete API pagination is not proof of historical event coverage. Days/entities without Insights remain unknown; unique reach is not summed across days.'};
 const observedAt=dataset.observedAt,stale=dataset.readFailed||now-Date.parse(observedAt)>=120000;
 const report={version:REVIEW_VERSION,experienceVersion:11,agent:'Suleia Campaign Review Agent',reviewExecution:'RECOMMENDATION_ONLY',budgetMode:dataset.mode||'UNKNOWN',account:dataset.account,observedAt,timezone:'Europe/Madrid',contract:CONTRACT,range,baselineRange,comparison,level,selection:ids,totals,previous:before,budgetObservation:dataset.budgetObservation||{state:'OBSERVED_NOT_EXECUTOR_VERIFIED',observedAt},
  changes:Object.fromEntries(['spend','impressions','reach','frequency','linkClicks','landingPageViews','addToCart','initiateCheckout','purchaseValue','purchases','cpa','roas','linkCtr','linkCpc','cpm'].map(k=>[k,(comparison.comparable&&(!['purchases','cpa','roas'].includes(k)||conversionCompatible))?delta(totals[k],before[k]):null])),
  rows,recommendations:stale?[]:recommendations,rankings:stale?[]:ranking(rows),commerce:commercial,coverage,warnings:[...new Set([...warnings,...(stale?['STALE_REPORT']:[])])],freshness:stale?'STALE':'FRESH',
  inventory:Object.fromEntries(['campaign','adset','ad'].map(l=>[l,(dataset.entities[l]||[]).map(e=>({id:String(e.id),name:safe(e.name),campaignId:l==='campaign'?String(e.id):String(e.campaign_id),adsetId:e.adset_id?String(e.adset_id):null,status:e.effective_status||'UNKNOWN'}))])),
  products:productMappings.flatMap(m=>productLink(m.campaignId,productMappings,now)?.products||[]).filter((p,i,a)=>a.findIndex(x=>x.productId===p.productId)===i),
  hourly:equivalentHourlyTraffic((extras.hourly||[]).filter(h=>selected.some(f=>f.campaignId===String(h.campaign_id))),range,now),breakdowns:extras.breakdowns||{},videos:extras.videos||[],knowledge:KNOWLEDGE,policy,auditProfiles:AUDIT_PROFILES,
  statisticalStatus:'EXPLORATORY_OBSERVATIONAL',multipleTesting:{status:'NO_SIGNIFICANCE_CLAIMS',method:'BY available only for justified supplied tests; nonunique event aggregates are not independent binary trials.'},
  limits:['Meta attributed ROAS does not establish settled profit or incrementality.','No campaign is paused, scaled or changed by this review agent.','V5.1 approvals, locks, limits and schedules remain in the existing executor.'],externalWrites:0};
 report.subtotal=accountScope?{state:'ACCOUNT_SCOPE',included:actual.length,total:actual.length,metrics:null}:verifiedSubtotal(actual);
 if(accountScope)report.accountSeries={current:dataset.accountEvidence.daily,previous:baseline?(baseline.accountEvidence?.state==='AVAILABLE'?baseline.accountEvidence.daily:null):dataset.accountEvidence.priorDaily,source:'META_ACCOUNT_INSIGHTS',contract:CONTRACT};
 report.evidenceDigest=digest({range,baselineRange,observedAt,level,selection:ids,rows:rows.map(r=>[r.entityId,r.spend,r.purchases,r.purchaseValue]),commerce:commercial});
 report.summary=[`Gasto ${money(totals.spend)} · Compras atribuidas ${totals.purchases??'N/D'} · CPA ${money(totals.cpa)} · ROAS ${totals.roas?.toFixed(2)??'N/D'}`,`${recommendations.length} hipótesis para revisar. Beneficio por campaña no acreditado.`,range.partial?'Día en curso: comparación de conversiones con ayer bloqueada.':'Periodos completos; las conversiones recientes pueden revisarse.'];
 return report;
}
