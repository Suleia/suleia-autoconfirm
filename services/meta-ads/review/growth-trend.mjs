import {aggregate} from '../report.mjs';
import {shiftDay} from './periods.mjs';
function series(report,range,ids=null){
 const entities=(report?.rows||[]).filter(r=>r.source==='META_INSIGHTS'&&(!ids||ids.has(r.entityId)));
 const out=[];
 for(let day=range.since;day<=range.until;day=shiftDay(day,1)){
  const rows=entities.map(r=>r.series.find(s=>s.since===day));
  const complete=rows.length>0&&rows.every(Boolean),values=complete?aggregate(rows):null;
  out.push({day,complete,metrics:values,missingEntities:rows.filter(r=>!r).length});
 }
 return out;
}
export function buildGrowthTrend(selected,history){
 const current=series(selected,selected.range),base=selected.baselineRange;
 const compatible=selected.comparison.comparable&&selected.totals.purchaseType===selected.previous.purchaseType&&history&&base.since>=history.range.since&&base.until<=history.range.until;
 const previous=compatible?series(history,base,new Set(selected.rows.filter(r=>r.source==='META_INSIGHTS').map(r=>r.entityId))):[];
 const markers=(history?.rows||[]).flatMap(row=>(row.diagnoses||[]).filter(d=>d.code==='BUDGET_CHANGED').flatMap(d=>(d.evidence.events||[]).map(event=>({at:event.at,entityId:row.entityId,type:'BUDGET_CONTEXT',source:'META_ACTIVITY',causal:false}))));
 return {current,previous,comparable:Boolean(compatible),previousRange:compatible?base:null,markers,
  note:compatible?'Serie anterior del mismo nivel y contrato; los huecos no se convierten en cero.':'Serie diaria anterior no disponible en el lector compartido para este rango; no se reconstruye desde totales.',
  budgetNote:'Cambios de presupuesto como contexto; no prueban que causaran la variación de rendimiento.'};
}
