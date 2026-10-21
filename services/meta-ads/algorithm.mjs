import {createHash} from 'node:crypto';
import {normalizeInsight,CONTRACT,ratio} from './metrics.mjs';
import {aggregate} from './report.mjs';
import {businessDayBounds} from '../../packages/platform-core/src/business-day.mjs';

export const ALGORITHM_POLICY=Object.freeze({version:'meta-learning-v4.1',minDays:7,minPurchases:15,minSpend:50,minImpressions:3000,maxAgeMs:15*60_000,cooldownHours:72,maxDailyChanges:1,maxCumulativePercent:10,minAgeDays:7,maturityDays:7,volatileCV:1});
const HOUR=3600000,DAY=24*HOUR,finite=x=>typeof x==='number'&&Number.isFinite(x),sum=a=>a.reduce((s,x)=>s+x,0),mean=a=>a.length?sum(a)/a.length:null;
const variance=a=>a.length>1?sum(a.map(x=>(x-mean(a))**2))/(a.length-1):null;
const madridFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23',weekday:'short'});
const parts=t=>Object.fromEntries(madridFormatter.formatToParts(t).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
export function madridBoundary(day){return Date.parse(businessDayBounds({businessDate:day}).utc_start);}
export const shiftDay=(day,n)=>new Date(Date.parse(day+'T12:00:00Z')+n*DAY).toISOString().slice(0,10);
function seeded(seed=42){let s=seed;return()=>((s=(Math.imul(1664525,s)+1013904223)>>>0)+.5)/4294967296;}
function poisson(lambda,rng){if(!lambda)return 0;let p=1,k=0,L=Math.exp(-lambda);do{k++;p*=rng();}while(p>L&&k<10000);return k-1;}
const quantile=(a,q)=>a.length?[...a].sort((x,y)=>x-y)[Math.min(a.length-1,Math.floor((a.length-1)*q))]:null;
function pearson(a,b){if(a.length<7||a.some(x=>!finite(x))||b.some(x=>!finite(x)))return null;const ma=mean(a),mb=mean(b),den=Math.sqrt(sum(a.map(x=>(x-ma)**2))*sum(b.map(x=>(x-mb)**2)));return den?sum(a.map((x,i)=>(x-ma)*(b[i]-mb)))/den:null;}

export function traceOrders(orders,entities){
 const ads=new Map();for(const a of entities.ad||[]){const id=String(a.id);ads.set(id,ads.has(id)?null:a);}
 return (orders||[]).map(o=>{const a=o.attributes||[],media=a.filter(x=>x.name==='UTM medium'),source=a.filter(x=>x.name==='UTM source');
  const ad=media.length===1&&/^\d+$/.test(media[0].value||'')&&source.length===1&&/^(facebook|instagram|fb|ig)$/i.test(source[0].value||'')?ads.get(media[0].value):null;
  return {...o,verifiedCampaignId:ad?String(ad.campaign_id):null,verifiedAdId:ad?String(ad.id):null,attributionStatus:ad?'SOURCE_RECORDED_AD_ID':'NO_ATRIBUIDO',attributionCaveat:'UTM capturada por el origen y resuelta por ID exacto; no equivale a causalidad, identidad de usuario ni atribución 7d_click + 1d_view de Meta.'};});
}

export function commercialCohorts(orders,operations,range,{maturityDays=14}={}){
 const cutoff=shiftDay(range.until,-maturityDays),matches=new Map();for(const r of operations||[]){const rows=matches.get(r.sourceId)||[];rows.push(r);matches.set(r.sourceId,rows);}
 const groups=new Map();for(const o of orders||[]){if(o.test||o.cancelledAt)continue;const id=o.verifiedCampaignId||'NO_ATRIBUIDOS',g=groups.get(id)||{campaignId:id,received:0,matched:0,confirmed:0,delivered:0,rejected:0,cancelled:0,immature:0,ambiguous:0,missing:0,shipped:null,returned:null,cashRevenue:null,productCosts:null,logisticsCosts:null,netProfit:null};const p=parts(Date.parse(o.createdAt)),day=`${p.year}-${p.month}-${p.day}`;if(day>cutoff){g.immature++;groups.set(id,g);continue;}g.received++;const records=matches.get(o.id)||[];
  if(records.length===1){const r=records[0];g.matched++;if(r.confirmedAt)g.confirmed++;if(r.deliveredAt)g.delivered++;if(r.state==='REJECTED')g.rejected++;if(r.state==='CANCELLED')g.cancelled++;}else if(records.length>1)g.ambiguous++;else g.missing++;groups.set(id,g);
 }
 return {policyVersion:'COD_COHORT_V4_14D_EXPLORATORY',maturityDays,cutoff,groups:[...groups.values()],note:'Cohorte por creación Shopify, madurez exploratoria de 14 días, enlace exacto de referencia. Entregado no acredita cobro liquidado; costes por pedido y devoluciones verificadas pendientes.'};
}

export function analyzeOrderTiming(orders,range,{complete=true,replications=499}={}){
 const start=madridBoundary(range.since),end=madridBoundary(shiftDay(range.until,1));
 if(!finite(start)||!finite(end)||end<=start||end-start>32*DAY)throw Error('RANGE_INVALID');
 const bins=[];for(let t=start;t<end;t+=HOUR){const p=parts(t);bins.push({at:new Date(t).toISOString(),date:`${p.year}-${p.month}-${p.day}`,hour:Number(p.hour),weekday:p.weekday,weekend:['Sat','Sun'].includes(p.weekday),orders:0});}
 const seen=new Set(),valid=[],invalid=[];
 for(const o of orders||[]){const t=Date.parse(o.createdAt);if(o.test||o.cancelledAt)continue;if(!o.id||!finite(t)){invalid.push('ORDER_ID_OR_TIME_MISSING');continue;}if(seen.has(o.id))continue;seen.add(o.id);if(t<start||t>=end)continue;valid.push({...o,t});bins[Math.floor((t-start)/HOUR)].orders++;}
 const counts=bins.map(b=>b.orders),m=mean(counts),v=variance(counts),intervals=valid.sort((a,b)=>a.t-b.t).slice(1).map((o,i)=>(o.t-valid[i].t)/60000);
 const groups=new Map();for(const b of bins){const key=b.weekday+':'+b.hour;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(b.orders);}
 const expected=bins.map(b=>mean(groups.get(b.weekday+':'+b.hour))),stat=counts.reduce((s,c,i)=>s+(expected[i]?(c-expected[i])**2/expected[i]:0),0);
 // Refit weekday/hour rates in each parametric bootstrap replicate. Exploratory
 // in-sample goodness of fit, not causal evidence or an independent forecast.
 const rng=seeded(),simStats=[];for(let r=0;r<replications;r++){const sim=expected.map(l=>poisson(l,rng)),sg=new Map();bins.forEach((b,i)=>{const key=b.weekday+':'+b.hour;if(!sg.has(key))sg.set(key,[]);sg.get(key).push(sim[i]);});simStats.push(sim.reduce((s,c,i)=>{const e=mean(sg.get(bins[i].weekday+':'+bins[i].hour));return s+(e?(c-e)**2/e:0);},0));}
 const pValue=(1+simStats.filter(x=>x>=stat).length)/(replications+1),dispersion=m?v/m:null;
 const nbSize=v>m&&m>0?m*m/(v-m):null,lagOne=pearson(counts.slice(1),counts.slice(0,-1));
 const profile=weekend=>Array.from({length:24},(_,hour)=>{const selected=bins.filter(b=>b.hour===hour&&(weekend===null||b.weekend===weekend));return {hour,exposures:selected.length,orders:sum(selected.map(x=>x.orders)),perHour:mean(selected.map(x=>x.orders))};});
 const lags=valid.filter(o=>finite(Date.parse(o.receivedAt))).map(o=>Math.max(0,(Date.parse(o.receivedAt)-o.t)/60000));
 const seriesBy=(key)=>{const map=new Map();for(const o of valid){const k=o[key];if(!k)continue;map.set(k,(map.get(k)||0)+1);}return [...map].map(([id,orders])=>({id,orders}));};
 const sameHour=counts.filter(x=>x>=2).length;
 return {timezone:'Europe/Madrid',clock:'SHOPIFY_CREATED_AT',complete:complete&&!invalid.length,bins,total:valid.length,excluded:invalid.length,mean:m,variance:v,dispersion,zeroHours:counts.filter(x=>!x).length,multiOrderHours:sameHour,expectedMultiOrderHours:m===null?null:bins.length*(1-Math.exp(-m)*(1+m)),intervals:{medianMinutes:quantile(intervals,.5),p90Minutes:quantile(intervals,.9),minimumMinutes:intervals.length?Math.min(...intervals):null},profile:profile(null),workdays:profile(false),weekends:profile(true),byCampaign:seriesBy('verifiedCampaignId'),unattributed:valid.filter(o=>!o.verifiedCampaignId).length,ingestion:{sample:lags.length,medianMinutes:quantile(lags,.5),p95Minutes:quantile(lags,.95),maxMinutes:lags.length?Math.max(...lags):null},model:{reference:'HOMOGENEOUS_POISSON',alternative:'WEEKDAY_HOUR_POISSON_BOOTSTRAP',replications,pValue,negativeBinomial:{size:nbSize,mean:m,expectedMultiOrderHours:nbSize?bins.length*(1-Math.pow(nbSize/(nbSize+m),nbSize)*(1+nbSize*m/(nbSize+m))):null,interpretation:'MOMENT_FIT_NOT_INDEPENDENT_VALIDATION'},lagOneCorrelation:lagOne,seed:42,statistic:stat,interpretation:valid.length<50?'MUESTRA_INSUFICIENTE':pValue<.05?'RESIDUOS_NO_EXPLICADOS_POR_POISSON_HORARIO':'COMPATIBLE_CON_VARIABILIDAD_Y_ESTACIONALIDAD',confidence:valid.length>=200&&complete?'MEDIUM':'LOW',caveat:'Contraste exploratorio ajustado en la misma muestra; sobredispersión no demuestra un efecto de Meta. Sin tráfico por visita no se distingue calidad de tráfico ni retardo clic–compra.'}};
}

export function normalizeBudgetActivities(activities=[],entities={campaign:[],adset:[],ad:[]}){
 const sets=new Map((entities.adset||[]).map(e=>[String(e.id),String(e.campaign_id)])),ads=new Map((entities.ad||[]).map(e=>[String(e.id),String(e.campaign_id)]));
 return activities.filter(a=>/budget|run_status|creat|target|bid_strategy|optimization|learning/i.test(a.event_type||'')).map((a,index)=>{let extra=a.extra_data;try{if(typeof extra==='string')extra=JSON.parse(extra);}catch{extra=null;}const type=String(a.event_type||'UNKNOWN'),id=String(a.object_id||''),at=a.event_time;
 const rawOld=extra?.old_value??extra?.old_budget??null,rawNew=extra?.new_value??extra?.new_budget??null;
 // Budget units are accepted ONLY with an explicit currency-cent contract.
 // Meta extra_data shapes vary; preserve unknown values without inventing cents.
 const cents=(v,key)=>{if(!v||typeof v!=='object'||v.currency!=='EUR')return null;const amount=v.amount_in_cents??(v.type==='payment_amount'?v[key]:null);return Number.isSafeInteger(amount)&&amount>=0?amount:null;};
 const isBudget=/budget/i.test(type)&&!/schedul/i.test(type),newStatus=typeof extra?.new_value==='string'?extra.new_value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase():'';
 const before=cents(rawOld,'old_value'),after=cents(rawNew,'new_value'),campaignId=(entities.campaign||[]).some(c=>String(c.id)===id)?id:sets.get(id)||ads.get(id)||null;
 return {id:createHash('sha256').update(`${at}:${id}:${type}:${index}`).digest('hex').slice(0,24),at,type,campaignId,objectId:id,level:sets.has(id)?'adset':ads.has(id)?'ad':'campaign',name:a.object_name||id,actor:a.application_name||(/rule/i.test(type)?'Regla (actor no acreditado)':'Actor externo; identidad privada'),origin:a.application_id?'API_OR_APPLICATION':'META_ACTIVITY',beforeCents:before,afterCents:after,deltaCents:before!==null&&after!==null?after-before:null,deltaPercent:before>0&&after!==null?(after-before)/before*100:null,isBudget,isCreative:/creative|ad_creat|target|bid|optimization/i.test(type),kind:isBudget?before!==null&&after!==null?(after>before?'INCREASE':after<before?'DECREASE':'UNCHANGED'):'BUDGET_CHANGE':/^(?:pausad|paused|en pausa)/.test(newStatus)?'PAUSE':/^(?:activa|active|reactiva)/.test(newStatus)?'REACTIVATE':'CONFIGURATION',amountStatus:before!==null&&after!==null?'VERIFIED_CENTS':'UNVERIFIED_PROVIDER_FORMAT',reason:null};}).filter(a=>finite(Date.parse(a.at))).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
}
function facts(rows,observedAt){return (rows||[]).map(r=>normalizeInsight(r,{level:'campaign',observedAt,complete:true,contract:CONTRACT}));}
function impactMetrics(rows){const a=aggregate(rows),out={};for(const k of ['spend','impressions','linkClicks','linkCtr','linkCpc','cpm','addToCart','purchases','purchaseValue','cpa','roas'])out[k]=a[k];out.coverage={rows:rows.length,purchaseRows:a.coverage.purchases.known,purchaseStatus:a.coverage.purchases.status};return out;}
export function budgetImpact(event,daily,events,range){
 const day=parts(Date.parse(event.at)),date=`${day.year}-${day.month}-${day.day}`,select=(lo,hi)=>daily.filter(f=>f.campaignId===event.campaignId&&f.since>=lo&&f.since<=hi);
 const windows=[1,3,7].map(days=>{const priorSince=shiftDay(date,-days),priorUntil=shiftDay(date,-1),since=shiftDay(date,1),until=shiftDay(date,days),available=priorSince>=range.since&&until<=range.until;
 const prior=select(priorSince,priorUntil),after=select(since,until);return {days,since,until,complete:available,prior:available?impactMetrics(prior):null,after:available?impactMetrics(after):null,attributionMature:shiftDay(until,7)<=range.until};});
 const simultaneous=events.filter(e=>e.id!==event.id&&e.campaignId===event.campaignId&&Math.abs(Date.parse(e.at)-Date.parse(event.at))<DAY);
 return {windows,firstHours:null,firstHoursReason:'No existe una serie de compras por hora de conversión comparable al tráfico horario.',confounders:simultaneous.map(e=>({at:e.at,type:e.type})),weekdayMatched:impactMetrics(select(shiftDay(date,-7),shiftDay(date,-7))),causality:'OBSERVATIONAL_ONLY',confidence:'LOW',limitations:['El día del cambio se excluye; ventanas completas antes y después.','Comparación antes/después y referencia mismo día de semana no identifican causalidad.','Cambios simultáneos, puja, audiencia y madurez de atribución pueden confundir el efecto.']};
}
export function assessLearning({entity={},daily=[],events=[],rules=[],sources={},observedAt,range,now=Date.now(),requestedPercent=null,economics=null,policy={}}){
 const p={...ALGORITHM_POLICY,...policy},id=String(entity.id),rows=daily.filter(f=>f.campaignId===id),validRows=rows.filter(f=>finite(f.roas)&&finite(f.purchases)&&finite(f.spend)),recent=aggregate(rows.filter(f=>f.since>=shiftDay(range.until,-6))),historical=aggregate(rows),samples=validRows.map(f=>f.roas),cv=mean(samples)>0?Math.sqrt(variance(samples)||0)/mean(samples):null;
 const changes=events.filter(e=>e.campaignId===id),last=changes[0]||null,daysOld=finite(Date.parse(entity.created_time))?(now-Date.parse(entity.created_time))/DAY:null,reasons=[];
 if(entity.effective_status!=='ACTIVE')reasons.push('DELIVERY_NOT_ACTIVE');
 if(!finite(Date.parse(observedAt))||now-Date.parse(observedAt)>p.maxAgeMs||Date.parse(observedAt)>now+60000)reasons.push('STALE_DATA');
 if(sources.account?.status!=='COMPLETE'||sources.daily_campaign?.status!=='COMPLETE'||sources.activities?.status!=='COMPLETE'||sources.rules?.status!=='COMPLETE')reasons.push('INCOMPLETE_EVIDENCE');
 if(sources.currentActivities?.status!=='COMPLETE')reasons.push('CURRENT_DAY_HISTORY_UNAVAILABLE');
 if(daysOld===null||daysOld<p.minAgeDays)reasons.push('CAMPAIGN_AGE_UNKNOWN_OR_YOUNG');
 if(last&&(now-Date.parse(last.at))/HOUR<p.cooldownHours)reasons.push('RECENT_SIGNIFICANT_CHANGE');
 if(new Set(validRows.map(f=>f.since)).size<p.minDays||!(recent.purchases>=p.minPurchases)||!(recent.spend>=p.minSpend)||!(recent.impressions>=p.minImpressions))reasons.push('INSUFFICIENT_MULTIDAY_SAMPLE');
 if(recent.roas===null)reasons.push('ROAS_MISSING_OR_AMBIGUOUS');
 if(rules.some(r=>r.status!=='DISABLED'))reasons.push('AUTOMATION_CONFLICT');
 if(!economics?.verified||!finite(economics.breakEvenRoas))reasons.push('VERIFIED_ECONOMICS_MISSING');
 if(cv===null||cv>p.volatileCV)reasons.push('VOLATILITY_OR_INCOMPLETE_HISTORY');
 const learning=entity.learning_stage_info?.status||entity.learningStatus||'NOT_EXPOSED';if(/LEARNING/.test(learning))reasons.push('LEARNING_ACTIVE');
 if(finite(requestedPercent)&&Math.abs(requestedPercent)>p.maxCumulativePercent)reasons.push('CUMULATIVE_LIMIT');
 const today=parts(now),todayKey=`${today.year}-${today.month}-${today.day}`,todayChanges=changes.filter(e=>{const d=parts(Date.parse(e.at));return `${d.year}-${d.month}-${d.day}`===todayKey&&e.isBudget;});
 if(todayChanges.length>=p.maxDailyChanges)reasons.push('DAILY_CHANGE_LIMIT');
 const cumulative=todayChanges.reduce((s,e)=>s+(finite(e.deltaPercent)?Math.abs(e.deltaPercent):0),0);
 if(todayChanges.some(e=>!finite(e.deltaPercent)))reasons.push('CUMULATIVE_CHANGE_UNKNOWN');
 const lastBudget=changes.find(e=>e.isBudget&&e.level==='campaign'&&e.afterCents!==null);
 if(lastBudget&&Number(entity.daily_budget)!==lastBudget.afterCents)reasons.push('EXTERNAL_BUDGET_NOT_RECONCILED');
 if(finite(requestedPercent)&&cumulative+Math.abs(requestedPercent)>p.maxCumulativePercent)reasons.push('CUMULATIVE_LIMIT');
 const matureUntil=shiftDay(range.until,-p.maturityDays),mature=aggregate(rows.filter(f=>f.since<=matureUntil));
 return {campaignId:id,name:entity.name,budgetCents:entity.daily_budget?Number(entity.daily_budget):null,learningStatus:learning,ageDays:daysOld,lastChange:last?.at||null,recent,historical,mature,matureUntil,cv,stability:validRows.length<p.minDays?'Datos insuficientes':cv!==null&&cv<=.5?'Estable':cv!==null&&cv>p.volatileCV?'Volátil':'En observación',reasons:[...new Set(reasons)],recommendation:reasons.length?'MANTENER_Y_REVISAR':recent.roas>economics.breakEvenRoas*1.2?'ESCALADO_PARA_REVISION':recent.roas<economics.breakEvenRoas?'REDUCCION_PARA_REVISION':'MANTENER',confidence:'LOW',policy:p,warning:'Un porcentaje pequeño no garantiza conservar el aprendizaje. ROAS publicitario no equivale a beneficio cobrado.'};
}

export function simulateBudget({campaign,assessment,newBudgetCents,days=7,currentLimits={},assumptions={}}){
 if(!Number.isSafeInteger(newBudgetCents)||newBudgetCents<=0||newBudgetCents>100000000||!Number.isInteger(days)||days<1||days>30||!Number.isSafeInteger(Number(campaign.daily_budget))||Number(campaign.daily_budget)<=0)throw Error('SIMULATION_INVALID');
 const before=Number(campaign.daily_budget),delta=newBudgetCents-before,percent=delta/before*100,reasons=[...(assessment?.reasons||['LEARNING_ASSESSMENT_MISSING'])];
 if(!Number.isSafeInteger(currentLimits.maxBudgetCents)||!finite(currentLimits.maxChangePercent))reasons.push('LIMIT_POLICY_NOT_CONFIGURED');
 if(newBudgetCents>currentLimits.maxBudgetCents)reasons.push('MAX_BUDGET');if(Math.abs(percent)>currentLimits.maxChangePercent)reasons.push('MAX_CHANGE_PERCENT');
 if(Math.abs(percent)>(assessment?.policy?.maxCumulativePercent??0))reasons.push('CUMULATIVE_LIMIT');
 const cpa=assumptions.cpa??assessment?.recent?.cpa,scenarios=[.75,1,1.5].map(factor=>({assumedCpa:finite(cpa)&&cpa>0?cpa*factor:null,hypotheticalOrders:finite(cpa)&&cpa>0?newBudgetCents/100*days/(cpa*factor):null}));
 return {mode:'SHADOW',externalWrites:0,campaignId:String(campaign.id),beforeCents:before,afterCents:newBudgetCents,deltaCents:delta,percent,days,mechanicalAdditionalBudgetEur:delta/100*days,mechanicalTotalBudgetEur:newBudgetCents/100*days,assumptions:{fullDailyBudgetSpent:true,cpaBasis:assumptions.cpa?'USER_ASSUMPTION':'RECENT_OBSERVED_NOT_FORECAST',cpa},scenarios,reasons:[...new Set(reasons)],warning:'Escenarios mecánicos con CPA supuesto constante. Presupuesto × días no es un tope de gasto garantizado por Meta; no predice ventas, gasto real, aprendizaje ni beneficio.'};
}

export function buildAlgorithmReport(evidence,{now=Date.now(),policy={},economics={}}={}){
 if(evidence.contract!==CONTRACT)throw Error('CONTRACT_MISMATCH');const {range,observedAt,sources}=evidence;
 const daily=facts(evidence.daily?.campaign,observedAt),entities=evidence.entities||{},events=normalizeBudgetActivities(evidence.activities||[],entities);
 const ordersAvailable=sources.orders?.status==='COMPLETE',traced=traceOrders(evidence.orders,entities),orders=ordersAvailable?analyzeOrderTiming(traced,range):null;
 const currentEvents=normalizeBudgetActivities(evidence.currentActivities||[],entities),allEvents=[...currentEvents,...events].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
 const campaigns=(entities.campaign||[]).map(entity=>assessLearning({entity,daily,events:allEvents,rules:evidence.rules||[],sources,observedAt,range,now,policy,economics:economics[entity.id]}));
 for(const c of campaigns){const sets=(entities.adset||[]).filter(s=>String(s.campaign_id)===c.campaignId);c.adsetLearning=sets.map(s=>({id:String(s.id),status:s.learning_stage_info?.status||'NOT_EXPOSED',active:s.effective_status==='ACTIVE'}));if(c.adsetLearning.some(s=>s.active&&/LEARNING|FAIL/.test(s.status))&&!c.reasons.includes('LEARNING_ACTIVE')){c.reasons.push('LEARNING_ACTIVE');c.recommendation='MANTENER_Y_REVISAR';}}
 const traffic=evidence.hourlyTraffic===null?null:Array.from({length:24},(_,hour)=>{const rows=(evidence.hourlyTraffic||[]).filter(r=>Number(String(r.hourly_stats_aggregated_by_advertiser_time_zone||'').slice(0,2))===hour);return {hour,spend:rows.length?sum(rows.map(r=>Number(r.spend))):null,clicks:rows.length?sum(rows.map(r=>Number(r.inline_link_clicks||0))):null,impressions:rows.length?sum(rows.map(r=>Number(r.impressions))):null};});
 const byDate=new Map();for(const f of daily){const x=byDate.get(f.since)||[];x.push(f);byDate.set(f.since,x);}const joined=orders?Array.from(byDate,([date,rows])=>({date,spend:aggregate(rows).spend,orders:sum(orders.bins.filter(b=>b.date===date).map(b=>b.orders))})):[];
 const correlation=pearson(joined.map(x=>x.spend),joined.map(x=>x.orders));
 const narrative=[{kind:'EVIDENCIA',text:orders?`${orders.total} pedidos válidos; ${orders.multiOrderHours} horas con varios pedidos frente a ${Math.round(orders.expectedMultiOrderHours)} esperadas bajo Poisson homogéneo. Dispersión ${orders.dispersion?.toFixed(2)}. ${({MUESTRA_INSUFICIENTE:'Muestra insuficiente para interpretar el patrón',RESIDUOS_NO_EXPLICADOS_POR_POISSON_HORARIO:'Queda variación que el modelo horario no explica',COMPATIBLE_CON_VARIABILIDAD_Y_ESTACIONALIDAD:'Compatible con variabilidad y estacionalidad'})[orders.model.interpretation]}; p exploratoria ${orders.model.pValue.toFixed(3)}.`:'No hay fuente de hora real Shopify disponible; no es posible diagnosticar las ventas agrupadas.'},{kind:'HIPOTESIS',text:'Variación aleatoria, estacionalidad y volumen de tráfico son explicaciones que deben contrastarse. No conocemos el código privado del algoritmo de Meta.'},{kind:'INCERTIDUMBRE',text:`Correlación diaria gasto–pedidos: ${correlation===null?'N/D':correlation.toFixed(2)}. No demuestra atribución ni causalidad. El gasto horario usa hora de entrega; Meta informa compras por fecha de conversión con 7d_click + 1d_view.`},{kind:'RECOMENDACION',text:'Mantener presupuestos mientras falten historia fiable, madurez, control de automatizaciones o margen cobrado; revisar antes de proponer cambios.'}];
 const timeline=events.map(e=>({...e,impact:e.campaignId?budgetImpact(e,daily,events,range):null}));
 const orderSegments=(orders?.byCampaign||[]).map(s=>{const subset=traced.filter(o=>o.verifiedCampaignId===s.id),timing=analyzeOrderTiming(subset,range,{replications:19});return {campaignId:s.id,name:(entities.campaign||[]).find(c=>String(c.id)===s.id)?.name||s.id,orders:s.orders,profile:timing.profile,workdays:timing.workdays,weekends:timing.weekends};});
 const cohorts=sources.operations?.status==='COMPLETE'?commercialCohorts(traced,evidence.operations,range):null;
 return {cohorts,orderSegments,version:'ADS_ALGORITHM_V4',policyVersion:policy.version||ALGORITHM_POLICY.version,mode:'SHADOW',liveEnabled:false,externalWrites:0,range,observedAt,contract:CONTRACT,sources,orders,traffic,hourlyConversionBasis:evidence.hourlyConversionBasis,campaigns,timeline,rules:(evidence.rules||[]).map(r=>({id:r.id,name:r.name,status:r.status,schedule:r.schedule_spec,execution:r.execution_spec,evaluation:r.evaluation_spec})),dailyRelation:{sample:joined.length,pearson:correlation,causal:false},narrative,commercial:{status:orders?.byCampaign.length?'PARTIAL_SOURCE_UTM_TRACE':'NO_ATRIBUIDOS',shopifyOrders:orders?.total??null,attributedOrders:orders?.byCampaign.reduce((s,c)=>s+c.orders,0)??null,metaPurchases:aggregate(daily).purchases,realizedProfit:null,note:'Producto y proximidad temporal no acreditan atribución. Cobros y costes logísticos observados sin enlace fiable no producen beneficio por campaña.'},nightStrategy:{verdict:'NO_CAUSAL_EVIDENCE',alternatives:['Presupuesto estable','Reducción nocturna / recuperación matinal','Escalado multidiario','Reglas adaptativas'],experiment:{status:'DESIGN_ONLY_NOT_AUTHORIZED',primary:'CPA y margen cobrado por cohorte madura; volumen de entregados como salvaguarda',design:'Asignación aleatoria de grupos comparables no solapados; fijar creatividades/pujas, controlar día de semana y contaminación; fase basal y potencia antes de decidir duración.',duration:'Mínimo dos ciclos semanales completos, más madurez logística y ventana de atribución; cálculo de potencia pendiente.',stop:'Límite de pérdida aprobado, fallo de medición, cambios externos o contaminación; sin apagar protecciones.'}},limitations:['Historial Meta tiene cobertura limitada a lo devuelto; ausencia de evento no prueba ausencia de cambio.','Importes sin contrato acreditado se mantienen desconocidos.','Últimos siete días susceptibles a maduración/revisión de atribución.','No hay experimento causal ni prueba del algoritmo privado.'],evidenceDigest:createHash('sha256').update(JSON.stringify({range,observedAt,sources,events:events.length,orders:orders?.total})).digest('hex')};
}

export function answerAlgorithm(report,text=''){
 const t=text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const selected=report.campaigns.filter(c=>t.includes(c.name.toLowerCase())||c.name.toLowerCase().split(/\s+/).some(w=>w.length>3&&t.includes(w)));
 const scoped=selected.length?selected:report.campaigns.filter(c=>c.budgetCents!==null);
 let lines=[`Meta Algorithm Intelligence · ${report.range.since} → ${report.range.until} · SHADOW · LIVE desactivado`];
 if(/bloques|pedidos|distribu/.test(t))lines.push(...report.narrative.map(n=>`${n.kind}: ${n.text}`));
 else if(/ultima|despues|cambi|subida/.test(t)){const ids=new Set(scoped.map(c=>c.campaignId)),events=report.timeline.filter(e=>ids.has(e.campaignId)).slice(0,5);lines.push(...events.map(e=>`${e.at} · ${e.name} · ${e.type} · anterior/nuevo: ${e.beforeCents===null?'N/D':e.beforeCents/100} / ${e.afterCents===null?'N/D':e.afterCents/100} EUR · efecto observacional, no causal.`));if(!events.length)lines.push('Sin cambios acreditados en el historial disponible; esto no demuestra ausencia de cambios externos.');}
 else lines.push(...scoped.slice(0,8).map(c=>`${c.name}: ${c.stability}; ${c.recommendation}; compras 7d ${c.recent.purchases??'N/D'}, ROAS ${c.recent.roas?.toFixed(2)??'N/D'}. Protecciones: ${c.reasons.join(', ')||'revisión humana requerida'}.`));
 lines.push(`Política ${report.policyVersion}. ROAS no es beneficio cobrado. ${report.limitations[2]}`);return lines.join('\n');
}

export function answerTechnicalQuestion(overview,text=''){
 const t=text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const question=/cpm/.test(t)?'CPM':/fatig|creativ/.test(t)?'CREATIVE':'FUNNEL';
 const measured=overview.actions.filter(a=>question==='CPM'?a.reason?.includes('CPM')||a.evidenceText?.includes('cpm'):question==='CREATIVE'?a.category==='ad':['web','checkout','measurement'].includes(a.category));
 return ['EVIDENCIA SULEIA: '+`${overview.range.since} → ${overview.range.until}; ${overview.quality.attribution}.`,
 ...measured.slice(0,4).map(a=>`${a.name}: ${a.title}. ${a.evidenceText}. Recomendación: ${a.action}. Confianza ${a.confidence}.`),
 measured.length?'HIPÓTESIS: las señales identifican dónde investigar; no prueban qué causa el deterioro.':'INCERTIDUMBRE: no hay una señal concluyente con muestra y referencia suficientes.',
 question==='CPM'?'DEFINICIÓN: CPM = gasto / impresiones × 1.000. Un CPM más alto con ROAS estable no justifica por sí solo bajar el presupuesto. No se atribuye el cambio a subastas sin evidencia.':question==='CREATIVE'?'CRITERIO VERSIONADO: frecuencia alta o CTR decreciente aislados no prueban fatiga. Se requiere deterioro conjunto frente a una referencia comparable.':'CRITERIO VERSIONADO: las etapas contienen eventos atribuidos, no usuarios únicos. Revisar volumen, medición y tasas comparables antes de localizar un problema.',
 'DOCUMENTACIÓN: https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adsinsights.py · No conocemos el algoritmo privado de Meta. LIVE desactivado.'].join('\n\n');
}
