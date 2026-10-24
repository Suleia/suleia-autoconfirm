import {ratio} from '../metrics.mjs';
import {delta} from '../report.mjs';

export const FUNNEL_STEPS=Object.freeze([
 ['impressions','Impresiones'],['linkClicks','Clics en enlace'],
 ['landingPageViews','Landing'],['addToCart','Carrito'],
 ['initiateCheckout','Checkout'],['purchases','Compra']
]);
const finite=Number.isFinite;
// These are diagnostic sample safeguards, not Meta rules or spend authority.
export function buildGrowthFunnel(current={},previous={},options={}){
 const {comparable=false,minDenominator=30,materialDropPercent=25,scopeCompatible=true}=options;
 const issues=[];
 const stages=FUNNEL_STEPS.map(([key,label],index)=>{
  const parent=index?FUNNEL_STEPS[index-1][0]:null,value=current[key],denominator=parent?current[parent]:null;
  const before=previous[key],priorDenominator=parent?previous[parent]:null;
  const purchaseCompatible=key!=='purchases'||Boolean(current.purchaseType&&current.purchaseType===previous.purchaseType);
  const known=finite(value)&&value>=0&&(!parent||finite(denominator));
  const anomaly=parent&&known&&((denominator===0&&value>0)||(denominator>0&&value>denominator));
  const reason=!known?'MISSING_EVENTS':!scopeCompatible?'INCOMPATIBLE_POPULATIONS':anomaly?'EVENT_POPULATION_ANOMALY':parent&&denominator===0?'ZERO_DENOMINATOR':parent&&denominator<minDenominator?'SMALL_DENOMINATOR':null;
  if(reason)issues.push({key,code:reason});
  const rate=parent&&!reason?ratio(value,denominator,100):null;
  const validPrior=parent&&finite(before)&&finite(priorDenominator)&&before>=0&&priorDenominator>=minDenominator&&before<=priorDenominator;
  const rateComparable=comparable&&scopeCompatible&&purchaseCompatible&&!reason&&validPrior;
  const previousRate=rateComparable?ratio(before,priorDenominator,100):null;
  const rateChange=rateComparable?delta(rate,previousRate):null;
  const loss=rate===null?null:100-rate;
  return {key,label,value:finite(value)&&value>=0?value:null,denominator,rate,previousRate,relativeLossPercent:loss,
   changePercent:comparable&&scopeCompatible&&purchaseCompatible?delta(value,before):null,
   rateChangePercent:rateChange,cost:finite(value)&&value>0?ratio(current.spend,value):null,
   state:reason?'INSUFFICIENT':rateChange!==null&&rateChange<=-materialDropPercent?'DETERIORATED':'OBSERVED',reason,
   unit:'ATTRIBUTED_AGGREGATE_EVENTS',causal:false,comparable:rateComparable};
 });
 const worst=stages.filter(s=>s.state==='DETERIORATED').sort((a,b)=>a.rateChangePercent-b.rateChangePercent)[0]||null;
 return {version:'suleia-growth-funnel-v10.0',stages,primaryKeys:['landingPageViews','addToCart','initiateCheckout','purchases'],worstStage:worst?.key||null,issues,
  status:issues.some(x=>['EVENT_POPULATION_ANOMALY','INCOMPATIBLE_POPULATIONS'].includes(x.code))?'ANOMALOUS':issues.length?'PARTIAL':'OBSERVED',
  note:'Ratios entre eventos atribuidos agregados. No son recorridos de usuarios únicos ni prueban la causa de una pérdida. Poblaciones anómalas, bases pequeñas y eventos ausentes bloquean tasas y conclusiones.'};
}

export function measurementStatus(report){
 const rows=report?.rows||[];
 const issues=[];
 for(const row of rows){
  if(row.purchases>0&&row.initiateCheckout===0)issues.push({entityId:row.entityId,code:'PURCHASES_WITH_ZERO_CHECKOUT'});
  if(row.roasStatus==='AMBIGUOUS'||row.quality?.purchase==='AMBIGUOUS')issues.push({entityId:row.entityId,code:'AMBIGUOUS_PURCHASE'});
  if(row.purchases===null||row.purchaseValue===null)issues.push({entityId:row.entityId,code:'PURCHASE_COVERAGE_MISSING'});
 }
 return {state:issues.some(x=>x.code!=='PURCHASE_COVERAGE_MISSING')?'ANOMALOUS':rows.length?'PARTIAL':'INSUFFICIENT',issues,
  pixel:{state:'UNVERIFIED',reason:'No hay un inventario Pixel ni un registro de eventos individuales acreditado en el lector disponible.'},
  capi:{state:'UNVERIFIED',eventId:null,eventMatchQuality:null,latency:null,reason:'Insights no acredita event_id, deduplicación ni Event Match Quality; se necesitan las evidencias autorizadas de Events Manager.'},
  events:Object.fromEntries(['landingPageViews','addToCart','initiateCheckout','purchases','purchaseValue'].map(key=>[key,{value:report?.totals?.[key]??null,source:'META_INSIGHTS',coverage:report?.totals?.coverage?.[key]?.status||'UNAVAILABLE'}])),
  alternatives:['Canales o poblaciones distintos','Contra reembolso, importaciones o pedidos manuales','Consentimiento y bloqueo de eventos','Retraso de atribución','Implementación o deduplicación del evento'],
  next:'Contrastar el mismo periodo, tienda, canal e identificadores antes de afirmar una causa. Cero checkouts con pedidos existentes requiere investigación; no demuestra una web rota.',externalWrites:0};
}
