import {aggregate,verifiedSubtotal} from '../report.mjs';
import {shiftDay} from './periods.mjs';
function series(report,range,ids=null){
 const native=report?.accountSeries?.current;
 if(native&&!ids){const byDay=new Map(native.map(r=>[r.since,r]));const out=[];for(let day=range.since;day<=range.until;day=shiftDay(day,1)){const metrics=byDay.get(day)||null;out.push({day,complete:Boolean(metrics),metrics,scope:'PROVIDER_ACCOUNT',included:metrics?1:0,total:1});}return out;}
 const entities=(report?.rows||[]).filter(r=>r.source==='META_INSIGHTS'&&(!ids||ids.has(r.entityId)));
 const out=[];
 for(let day=range.since;day<=range.until;day=shiftDay(day,1)){
  const rows=entities.map(r=>r.series.find(s=>s.since===day));
  const present=rows.filter(Boolean),complete=rows.length>0&&rows.every(Boolean),subtotal=verifiedSubtotal(present);
  const values=complete?aggregate(rows):subtotal.metrics;
  out.push({day,complete,metrics:values,scope:complete?'RETURNED_ENTITIES':'VERIFIED_PARTIAL_SUBTOTAL',included:present.length,total:rows.length,missingEntities:rows.filter(r=>!r).length});
 }
 return out;
}
export function buildGrowthTrend(selected,history){
 const current=series(selected,selected.range),base=selected.baselineRange;
 const compatible=selected.comparison.comparable&&selected.totals.purchaseType===selected.previous.purchaseType&&history&&base.since>=history.range.since&&base.until<=history.range.until;
 const priorAccount=selected.accountSeries?.previous;
 const accountPrevious=selected.comparison.comparable&&priorAccount?series({accountSeries:{current:priorAccount}},base):null;
 const previous=accountPrevious|| (compatible?series(history,base,new Set(selected.rows.filter(r=>r.source==='META_INSIGHTS').map(r=>r.entityId))).map((point,i)=>point.complete&&current[i]?.complete?point:{...point,metrics:null,comparisonBlocked:'DAILY_POPULATION_INCOMPLETE'}):[]);
 const markers=(history?.rows||[]).flatMap(row=>(row.diagnoses||[]).filter(d=>d.code==='BUDGET_CHANGED').flatMap(d=>(d.evidence.events||[]).map(event=>({at:event.at,entityId:row.entityId,type:'BUDGET_CONTEXT',source:'META_ACTIVITY',causal:false}))));
 return {current,previous,comparable:Boolean(accountPrevious||compatible),previousRange:accountPrevious||compatible?base:null,markers,
  note:compatible?'Serie anterior del mismo nivel y contrato; los huecos no se convierten en cero.':'Serie diaria anterior no disponible en el lector compartido para este rango; no se reconstruye desde totales.',
  budgetNote:'Cambios de presupuesto como contexto; no prueban que causaran la variación de rendimiento.'};
}
