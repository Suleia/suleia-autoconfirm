import {aggregate} from '../report.mjs';
import {shiftDay} from './periods.mjs';

// Slice additive facts already returned by the single canonical Insights reader.
// Unique reach/frequency cannot be reconstructed by summing daily populations.
export function sliceGrowthWindow(report,{since,until}){
 if(!report)return null;
 if(report.range.since===since&&report.range.until===until)return report;
 const count=(Date.parse(until)-Date.parse(since))/86400000+1;
 if(!Number.isInteger(count)||count<1||since<report.range.since||until>report.range.until)return null;
 const previousSince=shiftDay(since,-count),previousUntil=shiftDay(since,-1);
 const rows=(report.rows||[]).map(row=>{
  const series=(row.series||[]).filter(d=>d.since>=since&&d.since<=until);
  const priorSeries=(row.series||[]).filter(d=>d.since>=previousSince&&d.since<=previousUntil);
  const total=aggregate(series),prior=aggregate(priorSeries);
  const complete=new Set(series.map(d=>d.since)).size===count;
  const priorComplete=new Set(priorSeries.map(d=>d.since)).size===count;
  const errors=[];
  if(total.roasStatus==='AMBIGUOUS'||total.quality?.purchase==='AMBIGUOUS')errors.push('AMBIGUOUS_PURCHASES');
  if(total.purchases===null||total.purchaseValue===null)errors.push('PURCHASE_MEASUREMENT_MISSING');
  if(!Number.isFinite(total.spend)||!Number.isFinite(total.impressions))errors.push('TRAFFIC_MEASUREMENT_MISSING');
  if(total.purchases>0&&total.initiateCheckout===0)errors.push('PURCHASES_WITH_ZERO_CHECKOUTS');
  return {...row,...total,entityId:row.entityId,source:series.length?'META_INSIGHTS':'META_NO_INSIGHT_ROW',since,until,reach:null,frequency:null,
   prior:{...prior,reach:null,frequency:null,since:previousSince,until:previousUntil},comparable:report.comparison.comparable&&complete&&priorComplete&&total.purchaseType===prior.purchaseType,
   sample:{...row.sample,daysWithEvidence:series.length,derivedPeriod:true,coverageComplete:complete,priorCoverageComplete:priorComplete,
    errors,state:!complete?'INSUFFICIENT_SAMPLE':errors.length?'MEASUREMENT_BLOCKED':'OBSERVATIONAL'},series};
 });
 return {...report,range:{since,until,partial:false},baselineRange:{since:previousSince,until:previousUntil,partial:false},
  totals:aggregate(rows.filter(r=>r.source==='META_INSIGHTS')),previous:aggregate(rows.map(r=>r.prior)),rows,
  derivation:{sourceRange:report.range,method:'ADDITIVE_DAILY_FACTS',reach:'UNAVAILABLE',frequency:'UNAVAILABLE',note:'No se inventan días ausentes ni audiencias únicas. La muestra incompleta bloquea decisiones.'},
  comparison:{comparable:rows.length>0&&rows.every(r=>r.comparable),reasons:rows.every(r=>r.comparable)?[]:['ENTITY_DAILY_COVERAGE_INCOMPLETE']}};
}

export function growthWindows(month){
 if(!month)return {};
 const end=month.range.until,out={month};
 for(const [name,days]of [['yesterday',1],['three',3],['week',7],['fortnight',14]])out[name]=sliceGrowthWindow(month,{since:shiftDay(end,-days+1),until:end});
 return out;
}
