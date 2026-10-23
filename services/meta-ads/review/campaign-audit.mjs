import {makeFunnel,aggregate,delta} from '../report.mjs';
import {shiftDay} from './periods.mjs';
const finite=Number.isFinite;
export function campaignAudit({report,ads,history={entries:[],nextCursor:null}}){
 const c=report.rows[0];if(report.level!=='campaign'||report.rows.length!==1||!c)return null;
 const comparable=c.comparable,quality=c.sample,roasChange=comparable&&c.prior?.roas>0?(c.roas/c.prior.roas-1)*100:null;
 const measurement=quality.state==='MEASUREMENT_BLOCKED',insufficient=!quality.volume||report.freshness!=='FRESH';
 const classification=c.source==='META_NO_INSIGHT_ROW'?'DATOS_INSUFICIENTES':measurement?'AUDITAR':insufficient?'DATOS_INSUFICIENTES':!comparable?'MANTENER':roasChange<=-20?'DETERIORO':c.diagnoses.some(x=>x.category!=='context')?'MEJORAR':roasChange>=0&&c.roas>3.8?'POTENCIAL_PARA_REVISION':'MANTENER';
 const facts=[{question:'¿Qué está ocurriendo?',answer:`${c.name}: gasto ${c.spend??'N/D'} EUR, ${c.purchases??'N/D'} compras, CPA ${c.cpa??'N/D'} EUR y ROAS ${c.roas??'N/D'}.`,evidence:{period:report.range,observedAt:report.observedAt,source:'META_INSIGHTS'}},
 {question:'¿Qué ha cambiado?',answer:comparable?`ROAS anterior ${c.prior?.roas??'N/D'}; variación ${roasChange===null?'no calculable':roasChange.toFixed(2)+' %'}.`:'No se comparan conversiones de un día parcial con un día completo ni contratos de atribución distintos.',evidence:{period:report.range,baseline:report.baselineRange,contract:report.contract}}];
 const adRows=ads.rows.filter(a=>a.campaignId===c.entityId).map(a=>({...a,trends:[3,7,30].map(days=>{
  const since=shiftDay(report.range.until,-days+1),previousSince=shiftDay(since,-days),previousUntil=shiftDay(since,-1);
  const xs=a.series.filter(p=>p.since>=since&&p.since<=report.range.until),ys=a.series.filter(p=>p.since>=previousSince&&p.since<=previousUntil);
  const current=xs.length===days?aggregate(xs):null,previous=ys.length===days?aggregate(ys):null;
  return {days,since,until:report.range.until,current,previous,roasChange:current&&previous?delta(current.roas,previous.roas):null,status:current?'CURRENT_WINDOW_ONLY':'INSUFFICIENT_HISTORY',causal:false};
 })})),supported=adRows.filter(a=>a.sample.volume&&finite(a.roas)),improved=supported.filter(a=>a.comparable&&a.roas>=a.prior?.roas),weak=supported.filter(a=>a.diagnoses.some(d=>d.category!=='context'));
 const contributions=adRows.map(a=>({id:a.entityId,name:a.name,spend:a.spend,spendShare:c.spend>0&&finite(a.spend)?a.spend/c.spend:null,purchases:a.purchases,purchaseShare:c.purchases>0&&finite(a.purchases)?a.purchases/c.purchases:null,purchaseValue:a.purchaseValue,roas:a.roas,sample:a.sample.state,comparable:a.comparable,note:'Contribución atribuida observada; no efecto causal ni ventas incrementales.'}));
 const hypotheses=c.diagnoses.map(d=>({title:d.title,explanation:d.action,evidence:d.evidence,alternatives:d.alternatives,confidence:d.confidence,risk:d.risk}));
 const recommendations=report.freshness==='FRESH'?report.recommendations:[];
 const samePurchaseScope=c.purchaseType&&c.purchaseType===c.prior?.purchaseType;
 return {version:'suleia-campaign-audit-v7',campaignId:c.entityId,name:c.name,classification,confidence:insufficient||measurement?'INSUFFICIENT':quality.state==='OBSERVATIONAL'&&comparable?'MEDIUM':'LOW',confidenceReason:measurement?'La medición impide atribuir el deterioro.':insufficient?'No se cumple la muestra o la frescura.':!comparable?'Los periodos no son comparables.':'Muestra, periodo y comparaciones son observacionales; no hay identificación causal.',
  range:report.range,baselineRange:report.baselineRange,observedAt:report.observedAt,contract:report.contract,facts,hypotheses,recommendations,
  executive:{improved:improved.map(a=>({id:a.entityId,name:a.name,roas:a.roas,purchases:a.purchases})),weak:weak.map(a=>({id:a.entityId,name:a.name,roas:a.roas,purchases:a.purchases})),nextAction:recommendations[0]?.action||'Mantener y recoger evidencia comparable antes de intervenir.',risk:'Atribución tardía, mezcla de públicos, aprendizaje y cambios externos pueden modificar esta lectura. El ROAS no acredita margen ni beneficio cobrado.'},
  funnel:makeFunnel(c,c.prior,comparable&&samePurchaseScope),decomposition:c.decomposition,
  ads:adRows,adRankings:ads.rankings,contributions,history:{...history,scope:'OWN_EXECUTOR_RECORDS',externalEvents:report.recommendations.filter(r=>r.code==='BUDGET_CHANGED').flatMap(r=>r.evidence.events||[]),notCausal:true},
  creativeAnalysis:{state:'NOT_INSPECTED',note:'La miniatura y los indicadores no permiten afirmar el hook, demostración, mensaje o CTA de un vídeo. Abrir la creatividad real para auditarla.'},
  comparisons:{periods:['hoy','ayer','3d','7d','14d','30d','60d','90d','custom'],partialDay:report.range.partial,hourly:report.hourly,attribution:report.comparison},externalWrites:0};
}
