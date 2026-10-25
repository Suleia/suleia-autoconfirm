// Read-only interpretation of the existing cells. No financial allocation,
// provider access, forecasts or automated business actions.
import {addCounts,emptyCounts,metrics,groupCells,shiftDay,round,hourBands,metricDenominator,metricSample,METRIC_DENOMINATORS,METRIC_NUMERATORS,SAMPLE_THRESHOLDS} from './order-intelligence.mjs';
export const BI_VERSION=2;
export const sumCells=cells=>metrics(cells.reduce((a,c)=>addCounts(a,c.counts),emptyCounts()));
export function comparisonPeriod(filters){
 const length=Math.round((Date.parse(filters.date_to)-Date.parse(filters.date_from))/86400000)+1;
 const priorMonth=day=>{const d=new Date(day+'T12:00:00Z'),year=d.getUTCFullYear(),month=d.getUTCMonth();const last=new Date(Date.UTC(year,month,0)).getUTCDate();return new Date(Date.UTC(year,month-1,Math.min(d.getUTCDate(),last),12)).toISOString().slice(0,10);};
 return {...filters,date_from:filters.comparison==='month'?priorMonth(filters.date_from):shiftDay(filters.date_from,-length),date_to:filters.comparison==='month'?priorMonth(filters.date_to):shiftDay(filters.date_from,-1)};
}
export function wilson95(successes,n){
 if(!Number.isFinite(successes)||!Number.isFinite(n)||n<=0||successes<0||successes>n)return null;
 const z=1.96,p=successes/n,a=1+z*z/n,b=(p+z*z/(2*n))/a,h=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/a;return [round((b-h)*100),round((b+h)*100)];
}
export function metricEvidence(metric,row){
 const sample=metricSample(metric,row),numerator=METRIC_NUMERATORS[metric];return {...sample,value:row?.[metric]??null,interval_95:numerator?wilson95(Number(row?.[numerator])||0,sample.n):null};
}
const partition=(rows,mature,dimension)=>{
 const by=new Map(groupCells(mature,dimension).map(r=>[r.key,r]));return rows.map(r=>({...r,mature:by.get(r.key)||metrics(emptyCounts())}));
};
export function comparisonMetrics({current,previous,matureCurrent,maturePrevious,filters,previousFilters}){
 const disabled=filters.comparison==='none',sameDuration=Date.parse(filters.date_to)-Date.parse(filters.date_from)===Date.parse(previousFilters.date_to)-Date.parse(previousFilters.date_from);
 return Object.fromEntries(['orders','revenue','confirmation_rate','delivery_rate','return_rate','incident_rate','profit_per_order','contribution_per_settled_order'].map(metric=>{
  const finalOutcome=['delivery_rate','return_rate','contribution_per_settled_order'].includes(metric),a=finalOutcome?matureCurrent:current,b=finalOutcome?maturePrevious:previous;
  const evidence=metricEvidence(metric,a),baseline=metricEvidence(metric,b),reasons=[];
  if(disabled)reasons.push('COMPARISON_DISABLED');
  if(['orders','revenue','profit_per_order'].includes(metric)&&!sameDuration)reasons.push('UNEQUAL_DURATION');
  if(evidence.value===null||baseline.value===null)reasons.push('VALUE_UNAVAILABLE');
  if(evidence.required&&Math.min(evidence.n,baseline.n)<SAMPLE_THRESHOLDS.minimum)reasons.push('SMALL_SAMPLE');
  if(metric==='profit_per_order'&&(current.immature||current.maturing||previous.immature||previous.maturing))reasons.push('FINANCIAL_OUTCOME_STILL_MATURING');
  const comparable=reasons.length===0,delta=comparable?round(evidence.value-baseline.value):null;
  return [metric,{metric,current:evidence.value,previous:baseline.value,current_n:evidence.n,previous_n:baseline.n,current_numerator:evidence.numerator,previous_numerator:baseline.numerator,scope:finalOutcome?'MATURE':'SELECTED',comparable,reasons,delta,percentage_points:metric.endsWith('_rate')?delta:null,percentage_change:comparable&&baseline.value!==0?round(delta/Math.abs(baseline.value)*100):null,current_quality:evidence.quality,previous_quality:baseline.quality}];
 }));
}
const maxBy=(rows,key)=>rows.filter(r=>Number.isFinite(r[key])).toSorted((a,b)=>b[key]-a[key]||b.orders-a.orders)[0]||null;
const eligible=(rows,metric)=>rows.filter(r=>metricDenominator(metric,r)>=SAMPLE_THRESHOLDS.minimum&&r[metric]!==null);
export function businessTitle(p){
 const subjects={province:`${p.label}`,product:`${p.label}`,offer:`Los pedidos de ${p.label}`,quantity:`Los packs de ${p.label} unidades`,hour:`Las compras de ${String(p.segment).padStart(2,'0')}:00–${String(p.segment).padStart(2,'0')}:59`,weekday:`Las compras del ${p.label.toLocaleLowerCase('es-ES')}`,confirmation_delay_band:`Los pedidos confirmados en ${p.label}`,response_delay_band:`Los pedidos con respuesta en ${p.label}`};
 const subject=subjects[p.dimension]||`El segmento ${p.label}`;
 const phrases={HIGH_RETURN_RATE:'presentan mayor devolución',LOW_RETURN_RATE:'presentan menor devolución',HIGH_DELIVERY_RATE:'presentan mejor entrega',LOW_DELIVERY_RATE:'presentan menor entrega',HIGH_CONFIRMATION_RATE:'confirman mejor',LOW_CONFIRMATION_RATE:'confirman menos',HIGH_INCIDENT_RATE:'presentan más incidencias',HIGH_ABSENCE_RATE:'presentan más ausencias',HIGH_REJECTION_RATE:'presentan más rechazo',HIGH_PROFIT_SEGMENT:'presentan mayor contribución por pedido liquidado',LOW_PROFIT_SEGMENT:'presentan menor contribución por pedido liquidado',SALES_SPIKE:'registran más pedidos',SALES_DROP:'registran menos pedidos',RETURN_SPIKE:'registran una mayor devolución',PROFIT_DROP:'registran una menor contribución'};
 return `${subject} ${phrases[p.pattern_type]||'presentan una diferencia a estudiar'}`;
}
export function enrichBusinessReport(data,{selected,previousCells,filters,previousFilters}){
 const mature=selected.filter(c=>c.maturity==='MATURE'),maturePrior=previousCells.filter(c=>c.maturity==='MATURE'),matureOverview=sumCells(mature),maturePrevious=sumCells(maturePrior);
 for(const [field,dim]of [['geography','province'],['hourly','hour'],['weekdays','weekday'],['heatmap',['weekday','hour']],['products','product'],['offers','offer']])data[field]=partition(data[field],mature,dim);
 const bands=hourBands(filters.hour_bands),withBand=cs=>cs.map(c=>({...c,time_band:bands.find(b=>c.hour>=b.from&&c.hour<=b.to).key}));
 const bandRows=partition(groupCells(withBand(selected),'time_band'),withBand(mature),'time_band');
 data.hour_bands=bands.map(b=>({...b,...(bandRows.find(r=>r.key===b.key)||metrics(emptyCounts())),key:b.key,label:b.label,mature:bandRows.find(r=>r.key===b.key)?.mature||metrics(emptyCounts())}));
 data.mature_overview=matureOverview;
 data.confirmation_provisional=selected.some(c=>c.maturity==='IMMATURE'&&!['CANCELLED','REJECTED'].includes(c.outcome)&&c.counts.confirmed<c.counts.orders);
 data.comparison={...data.comparison,mode:filters.comparison||'previous',label:filters.comparison==='month'?'Mismas fechas del mes anterior':filters.comparison==='none'?'Sin comparación':'Periodo anterior consecutivo',mature:{current:matureOverview,previous:maturePrevious},metrics:comparisonMetrics({current:data.overview,previous:data.comparison.overview,matureCurrent:matureOverview,maturePrevious,filters,previousFilters})};
 data.return_provinces=eligible(data.geography.map(r=>({...r.mature,key:r.key,label:r.label})),'return_rate').toSorted((a,b)=>b.return_rate-a.return_rate||b.sent-a.sent).map(r=>({...r,difference_pp:matureOverview.return_rate===null?null:round(r.return_rate-matureOverview.return_rate)}));
 data.geographic_opportunities=data.geography.filter(r=>r.key!=='UNKNOWN'&&r.mature.sent>=SAMPLE_THRESHOLDS.minimum&&r.mature.contribution_known>=SAMPLE_THRESHOLDS.minimum&&r.mature.delivery_rate>=matureOverview.delivery_rate&&r.mature.return_rate<=matureOverview.return_rate&&r.mature.contribution_per_settled_order>0).toSorted((a,b)=>b.mature.delivery_rate-a.mature.delivery_rate||b.mature.contribution_per_settled_order-a.mature.contribution_per_settled_order).slice(0,6);
 const biggestDay=maxBy(data.weekdays.filter(r=>r.orders>0),'orders'),bestConfirm=maxBy(eligible(data.weekdays,'confirmation_rate'),'confirmation_rate'),bestDelivery=maxBy(eligible(data.weekdays.map(r=>({...r.mature,key:r.key,label:r.label})),'delivery_rate'),'delivery_rate'),leastReturn=eligible(data.weekdays.map(r=>({...r.mature,key:r.key,label:r.label})),'return_rate').toSorted((a,b)=>a.return_rate-b.return_rate||b.sent-a.sent)[0];
 const maxVolume=Math.max(1,...data.hour_bands.map(r=>r.orders));
 const scored=data.hour_bands.filter(r=>r.orders>=SAMPLE_THRESHOLDS.minimum&&r.mature.sent>=SAMPLE_THRESHOLDS.minimum).map(r=>({...r,score:round(.4*r.mature.delivery_rate+.3*(100-r.mature.return_rate)+.2*r.confirmation_rate+.1*r.orders/maxVolume*100)}));
 const bestBand=maxBy(scored,'score'),riskBand=maxBy(data.hour_bands.filter(r=>r.mature.sent>=SAMPLE_THRESHOLDS.minimum).map(r=>({...r.mature,key:r.key,label:r.label})),'return_rate');
 if(riskBand)riskBand.difference_pp=matureOverview.return_rate===null?null:round(riskBand.return_rate-matureOverview.return_rate);
 const highlight=(id,title,row,metric,scope,dimension)=>({id,title,value:row?.label||null,metric,scope,row:row||null,evidence:row?metricEvidence(metric,row):null,filters:row?{[dimension]:row.key}:null,causal:false});
 data.highlights=[highlight('best_hours','Mejores horas para vender',bestBand,'confirmation_rate','DESCRIPTIVE_SCORE','hour_band'),highlight('risk_hours','Horas con mayor devolución',riskBand,'return_rate','MATURE','hour_band'),highlight('volume_day','Día con mayor volumen',biggestDay,'orders','SELECTED','weekday'),highlight('confirmation_day','Día con mejor confirmación',bestConfirm,'confirmation_rate','SELECTED','weekday'),highlight('delivery_day','Día con mejor entrega',bestDelivery,'delivery_rate','MATURE','weekday'),highlight('return_day','Día con menor devolución',leastReturn,'return_rate','MATURE','weekday')];
 data.cross_analysis=[['province','product'],['province','offer'],['hour','product'],['hour','offer']].map(dim=>({dimensions:dim,rows:partition(groupCells(selected,dim),mature,dim).slice(0,6)}));
 const topProvince=maxBy(data.geography.filter(r=>r.key!=='UNKNOWN'),'orders');
 if(topProvince&&!data.insights.some(i=>i.insight_id==='province-volume'))data.insights.push({insight_id:'province-volume',type:'INFORMATION',title:`${topProvince.label} concentra el mayor volumen`,description:`${topProvince.orders} pedidos: ${topProvince.share}% de la cohorte seleccionada. Es volumen observado; no acredita un mejor resultado final.`,metric:'orders',sample_size:topProvince.orders,confidence:null,filters:{...filters,province:topProvince.key},evidence:topProvince});
 const small=data.geography.find(r=>r.key===filters.province&&r.sent<SAMPLE_THRESHOLDS.minimum);
 if(small)data.insights.unshift({insight_id:'province-sample',type:'INFORMATION',title:`${small.label} tiene muestra pequeña para evaluar entrega`,description:`${small.delivered} entregados de ${small.sent} enviados. Los resultados pueden no ser representativos.`,metric:'delivery_rate',sample_size:small.sent,confidence:metricSample('delivery_rate',small).legacy,filters,evidence:small});
 data.business_method={version:BI_VERSION,metric_denominators:METRIC_DENOMINATORS,metric_numerators:METRIC_NUMERATORS,final_comparisons:'MATURE_VS_MATURE',minimum_comparison_n:SAMPLE_THRESHOLDS.minimum,hour_score:'40% entrega madura + 30% (100 − devolución madura) + 20% confirmación actual + 10% volumen relativo de franja. Descriptivo, no causal; requiere muestra suficiente.',economic_scope:'Contribución por pedido liquidado: ingresos realizados menos costes reconocidos de producto y Dropea. No incluye Meta ni gastos generales.'};
 return data;
}
