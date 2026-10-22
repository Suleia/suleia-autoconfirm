import {productLink} from './product-links.mjs';
import { createHash } from 'node:crypto';
import { CONTRACT, normalizeInsight, ratio, windowFor } from './metrics.mjs';
import { diagnose } from './diagnostics.mjs';

// These are disclosure-backed diagnostic safeguards, NOT authorization to spend.
export const DIAGNOSTIC_SAMPLE=Object.freeze({minSpend:15,minPurchases:5,minImpressions:1000,minFunnelEvents:30});
const sumKeys=['spend','impressions','linkClicks','outboundClicks','landingPageViews','addToCart','initiateCheckout','purchases','purchaseValue'];
const steps=[['impressions','Impresiones'],['linkClicks','Clics de enlace'],['landingPageViews','Visitas a landing'],['addToCart','Añadidos al carrito'],['initiateCheckout','Checkout'],['purchases','Compras']];
export const delta=(value,prior)=>Number.isFinite(value)&&Number.isFinite(prior)&&prior!==0?(value-prior)/Math.abs(prior)*100:null;
export function aggregate(facts) {
  const out={coverage:{},contract:CONTRACT};
  if(facts.some(f=>f.contract!==CONTRACT))throw Error('CONTRACT_MISMATCH');
  const scopes=new Set(facts.filter(f=>f.purchaseType).map(f=>f.purchaseType));
  for(const key of sumKeys){
    const known=facts.filter(f=>Number.isFinite(f[key]));
    out.coverage[key]={known:known.length,total:facts.length,status:!facts.length?'NO_ROWS':known.length===facts.length?'COMPLETE':'INCOMPLETE'};
    // Never silently turn an omitted event into zero, or combine overlapping scopes.
    out[key]=facts.length&&known.length===facts.length?known.reduce((s,f)=>s+f[key],0):null;
    if(['purchases','purchaseValue'].includes(key)&&scopes.size>1){out[key]=null;out.coverage[key].status='MIXED_SCOPE';}
  }
  Object.assign(out,{roas:ratio(out.purchaseValue,out.spend),cpa:ratio(out.spend,out.purchases),linkCtr:ratio(out.linkClicks,out.impressions,100),linkCpc:ratio(out.spend,out.linkClicks),cpm:ratio(out.spend,out.impressions,1000),costPerCart:ratio(out.spend,out.addToCart),costPerCheckout:ratio(out.spend,out.initiateCheckout),purchaseType:scopes.size===1?[...scopes][0]:null});
  return out;
}
function evidenceText(d){return Object.entries(d.evidence).map(([k,v])=>`${k}: ${typeof v==='number'?Number(v.toFixed(3)):String(v)}`).join(' · ');}
const categories={CTR_DECLINE:'ad',CPC_INCREASE:'ad',CPM_INCREASE:'ad',POSSIBLE_FATIGUE:'ad',LANDING_DROP:'web',CART_DROP:'web',CHECKOUT_DROP:'checkout',PURCHASE_DROP:'checkout',ROAS_DECLINE:'efficiency',CPA_ABOVE_BREAK_EVEN:'profit',MEASUREMENT_BLOCKED:'measurement',PURCHASE_DATA_MISSING:'measurement'};
const titles={CTR_DECLINE:'Revisar el mensaje del anuncio',CPC_INCREASE:'Revisar el coste del tráfico',CPM_INCREASE:'Revisar públicos y ubicaciones',POSSIBLE_FATIGUE:'Probar una creatividad alternativa',LANDING_DROP:'Revisar la carga de la landing',CART_DROP:'Mejorar la ficha y la oferta',CHECKOUT_DROP:'Revisar acceso y costes del checkout',PURCHASE_DROP:'Revisar pagos y medición de compra',ROAS_DECLINE:'Revisar el deterioro del ROAS',CPA_ABOVE_BREAK_EVEN:'Revisar coste y margen',MEASUREMENT_BLOCKED:'Reconciliar la medición',PURCHASE_DATA_MISSING:'Comprobar los eventos de compra'};
function enrich(f,entity,prior,range,policy){
  if(prior&&f.purchaseType&&prior.purchaseType&&f.purchaseType!==prior.purchaseType)prior=null;
  const diagnoses=diagnose(f,range.partial?null:prior,policy);
  const material=diagnoses.filter(d=>categories[d.code]);
  const enough=f.spend>=policy.minSpend&&f.impressions>=policy.minImpressions&&f.purchases>=policy.minPurchases;
  const stable=enough&&f.purchaseValue>f.spend&&prior?.purchases>=policy.minPurchases&&prior?.roas>0&&f.roas>=prior.roas*.85&&!range.partial;
  // No verified campaign/order/margin linkage exists: never label 'Rentable'.
  const status=f.source!=='META_INSIGHTS'||!enough||f.roas===null?'Datos insuficientes':material.some(d=>d.severity==='HIGH')?'Mejorable':material.length?'Vigilar':stable?'Validar margen':'Vigilar';
  return {...f,delivery:entity?.effective_status||'UNKNOWN',budgetCents:entity?.daily_budget?Number(entity.daily_budget):null,product:null,productStatus:'NO_ATRIBUIDO',diagnoses,status,stable,delta:{roas:range.partial?null:delta(f.roas,prior?.roas),cpa:range.partial?null:delta(f.cpa,prior?.cpa),ctr:range.partial?null:delta(f.linkCtr,prior?.linkCtr)},creative:entity?.creative||null};
}
export function makeFunnel(current,prior,comparable){
  const funnel=steps.map(([key,label],i)=>{
    const denominator=i?current[steps[i-1][0]]:null,before=i?ratio(prior?.[key]??null,prior?.[steps[i-1][0]]??null,100):null;
    const valid=comparable&&(key!=='purchases'||Boolean(current.purchaseType&&current.purchaseType===prior?.purchaseType));
    return {key,label,value:current[key],rate:i?ratio(current[key],denominator,100):null,cost:ratio(current.spend,current[key]),delta:valid?delta(current[key],prior?.[key]):null,rateDelta:valid&&i&&denominator>=30&&(prior?.[steps[i-1][0]]??0)>=30?delta(ratio(current[key],denominator,100),before):null,approximate:true};
  });
  const worst=funnel.filter(f=>f.rateDelta!==null&&f.rateDelta<0).sort((a,b)=>a.rateDelta-b.rateDelta)[0];
  return {stages:funnel,worstStage:worst?.key||null,note:'Eventos atribuidos agregados, no usuarios únicos. Las tasas son aproximadas; pueden superar el 100 % y no prueban causalidad.'};
}
export function assembleReport({account,range,comparison,observedAt,current,prior,daily,entities,policy={},mode='SIMULATION',selector=null,filters={},creativeStatus='AVAILABLE',productMappings=[]}){
  const sample={...DIAGNOSTIC_SAMPLE};
  const levels=['campaign','adset','ad'],facts={},baseline={};
  const campaigns=entities.campaign||[],lookup=new Map(campaigns.map(c=>[String(c.id),c]));
  const normalizeName=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const campaignIds=selector?new Set(campaigns.filter(c=>String(c.id)===selector||normalizeName(c.name).includes(normalizeName(selector))).map(c=>String(c.id))):null;
  const accepts=f=>(!campaignIds||campaignIds.has(f.campaignId))&&(!filters.campaignId||f.campaignId===filters.campaignId)&&(!filters.adsetId||f.adsetId===filters.adsetId)&&(!filters.adId||f.adId===filters.adId);
  // For ad/adset filtering, derive the headline from that single scope. Never add
  // different hierarchy levels. Campaign table remains explicit about its scope.
  const activeLevel=filters.adId?'ad':filters.adsetId?'adset':(filters.level||'campaign');
  for(const level of levels){
    const before=new Map((prior[level]||[]).map(f=>[f.entityId,f]));baseline[level]=(prior[level]||[]).filter(accepts);
    const byId=new Map((current[level]||[]).map(f=>[f.entityId,f]));
    for(const e of entities[level]||[])if(!byId.has(String(e.id)))byId.set(String(e.id),{...normalizeInsight({[level+'_id']:e.id,[level+'_name']:e.name,campaign_id:level==='campaign'?e.id:e.campaign_id,adset_id:level==='adset'?e.id:e.adset_id,ad_id:level==='ad'?e.id:undefined,date_start:range.since,date_stop:range.until},{level,complete:true,contract:CONTRACT,observedAt}),source:'META_NO_INSIGHT_ROW'});
    const map=new Map((entities[level]||[]).map(e=>[String(e.id),e]));
    facts[level]=[...byId.values()].filter(accepts).map(f=>({...enrich(f,map.get(f.entityId),before.get(f.entityId),range,sample),product:productLink(f.campaignId,productMappings),series:(daily[level]||[]).filter(d=>d.entityId===f.entityId).map(d=>({day:d.since,spend:d.spend,purchases:d.purchases,roas:d.roas})).sort((a,b)=>a.day.localeCompare(b.day))}));
  }
  const actual=facts[activeLevel].filter(f=>f.source==='META_INSIGHTS'),totals=aggregate(actual),previous=aggregate(baseline[activeLevel]);
  const meaningful=facts.campaign.filter(f=>f.source==='META_INSIGHTS'&&f.spend>0);
  const actions=[];
  for(const f of facts[activeLevel])for(const d of f.diagnoses.filter(d=>categories[d.code]))actions.push({id:createHash('sha256').update(`${f.entityId}:${d.code}:${range.since}:${range.until}:${CONTRACT}`).digest('hex').slice(0,20),entityId:f.entityId,campaignId:f.campaignId,name:f.name,code:d.code,category:categories[d.code],title:titles[d.code],reason:d.probableCause,evidence:d.evidence,evidenceText:evidenceText(d),alternatives:d.alternatives,action:d.recommendedAction,confidence:d.confidence,risk:d.risk,impact:null,priority:d.severity==='HIGH'?1:2,observedAt,range,contract:CONTRACT});
  actions.sort((a,b)=>a.priority-b.priority||a.name.localeCompare(b.name));
  // Consolidate related symptoms per entity for alerts while retaining detailed evidence.
  const grouped=new Map();for(const a of actions){const key=a.entityId;if(!grouped.has(key))grouped.set(key,{...a,related:[]});grouped.get(key).related.push(a.code);}
  const opportunities=facts[activeLevel].filter(f=>f.stable&&!actions.some(a=>a.entityId===f.entityId&&a.priority===1)).map(f=>({entityId:f.entityId,name:f.name,roas:f.roas,cpa:f.cpa,purchases:f.purchases,priority:3,confidence:'MEDIUM',favorable:`${f.purchases} compras; ROAS ${f.roas.toFixed(2)} estable frente al periodo anterior`,obstacle:'Margen y atribución de pedidos sin validar',action:'Validar margen, entrega y devoluciones antes de proponer escalado',risk:'ROAS de Meta puede no convertirse en beneficio cobrado',impact:null}));
  const series=[];
  for(let day=range.since;day<=range.until;day=new Date(Date.parse(day)+86400000).toISOString().slice(0,10))series.push({day,...aggregate((daily[activeLevel]||[]).filter(f=>f.since===day&&accepts(f)))});
  const comparable=!range.partial,purchaseScopeComparable=Boolean(totals.purchaseType&&totals.purchaseType===previous.purchaseType);
  const kpi=(key,label,unit='number',value=totals[key],priorValue=previous[key])=>{const valid=comparable&&(!['purchases','roas','cpa'].includes(key)||purchaseScopeComparable);return {key,label,unit,value,prior:valid?priorValue:null,delta:valid?delta(value,priorValue):null,series:series.map(s=>s[key]??null),source:'Meta Insights',observedAt,completeness:totals.coverage[key]?.status||(value===null?'UNAVAILABLE':'COMPLETE'),comparison:valid?'PREVIOUS_EQUAL_PERIOD':'NO_VALID_COMPARISON'};};
  const problems=new Set(actions.filter(a=>a.category!=='measurement').map(a=>a.campaignId)).size;
  const kpis=[kpi('spend','Gasto publicitario','money'),kpi('roas','ROAS agregado','ratio'),kpi('purchases','Compras atribuidas'),kpi('cpa','Coste por compra','money'),{...kpi('netProfit','Beneficio verificado','money',null,null),source:'Sin enlace validado campaña–pedido–costes',completeness:'NO_ATRIBUIDOS'}, {...kpi('profitable','Campañas rentables','number',null,null),completeness:'MARGIN_NOT_VERIFIED'},kpi('problems','Campañas con señales','number',problems,null),kpi('opportunities','Oportunidades','number',opportunities.length,null)];
  const topAds=facts.ad.filter(f=>f.stable&&f.purchaseValue>f.spend).sort((a,b)=>b.roas-a.roas).slice(0,6);
  const improveAds=facts.ad.filter(f=>f.diagnoses.some(d=>categories[d.code]&&categories[d.code]!=='measurement')).sort((a,b)=>(b.spend||0)-(a.spend||0)).slice(0,6);
  const missing=actual.filter(f=>f.purchases===null||f.purchaseValue===null).length;
  return {version:3,account:{id:account.id,currency:account.currency,timezone:account.timezone_name},range,comparison:{...comparison,comparable},observedAt,contract:CONTRACT,mode,liveEnabled:false,level:activeLevel,facts:facts[activeLevel],entities:facts,inventory:{campaigns,rules:entities.rules||[]},totals,previous,kpis,series,funnel:makeFunnel(totals,previous,comparable),actions,alertGroups:[...grouped.values()],opportunities,topAds,improveAds,limits:policy,diagnosticPolicy:sample,quick:{working:meaningful.filter(f=>f.stable).map(f=>({name:f.name,roas:f.roas,purchases:f.purchases})),problems:actions.filter(a=>a.category!=='measurement').slice(0,3),priority:actions.slice(0,3),measurement:[`${missing} de ${actual.length} filas con compras o valor ausentes. Ausencia ≠ cero.`,...(range.partial?['Periodo en curso: no se compara con un día completo.']:[]),'Deduplicación Pixel/CAPI (event_id): no verificada.','Beneficio y pedidos por campaña: NO_ATRIBUIDOS.']},quality:{status:missing?'PARTIAL':'SOURCE_COMPLETE',creativeStatus,missingPurchaseRows:missing,insightRows:actual.length,inventoryWithoutInsight:facts[activeLevel].length-actual.length,attribution:'7 días clic + 1 día visualización · fecha de conversión',deduplication:'UNVERIFIED',commercialAttribution:'NO_ATRIBUIDOS',netProfitAvailable:false,notes:['Los totales incluyen solo filas Meta devueltas en este nivel; inventario sin fila no implica cero.','No se suman alcance/frecuencia ni distintos niveles o alias de compra.','Los datos actuales proceden del lector canónico; el histórico Supabase anterior no se mezcla.']},commercial:{metaPurchases:totals.purchases,shopifyOrders:null,confirmed:null,shipped:null,delivered:null,returned:null,cashRevenue:null,productCosts:null,logisticsCosts:null,adSpend:totals.spend,netProfit:null,status:'NO_ATRIBUIDOS'},products:[],filters};
}

export async function readReport({reader,ledger,accountId,policy,mode,query={},now=Date.now(),maxRangeDays=31}){
  const account=await reader.readAccount();
  if(String(account.id).replace(/^act_/,'')!==String(accountId).replace(/^act_/,'')||account.currency!=='EUR'||account.timezone_name!=='Europe/Madrid'||account.account_status!==1)throw Error('ACCOUNT_NOT_ELIGIBLE');
  const range=windowFor(query.since?{since:query.since,until:query.until}:query.period||'7d',now,account.timezone_name,maxRangeDays);
  const days=(Date.parse(range.until)-Date.parse(range.since))/86400000+1;
  const comparison={since:new Date(Date.parse(range.since)-days*86400000).toISOString().slice(0,10),until:new Date(Date.parse(range.since)-86400000).toISOString().slice(0,10)};
  const observedAt=new Date(now).toISOString(),current={},prior={},daily={},entities={};let creativeStatus='AVAILABLE';
  for(const level of ['campaign','adset','ad']){
    const context={level,accountId:String(accountId).replace(/^act_/,''),contract:CONTRACT,observedAt,complete:true,currency:'EUR',timezone:account.timezone_name};
    // Bounded serial levels; the shared reader also bounds concurrent requests.
    const [rows,before,history]=await Promise.all([reader.readInsights({...range,level,extended:maxRangeDays===90}),reader.readInsights({...comparison,level,extended:maxRangeDays===90}),reader.readInsights({...range,level,daily:true,extended:maxRangeDays===90})]);
    const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
    const normalized=(rows,range,daily)=>{const facts=rows.map(r=>normalizeInsight(r,context));if(new Set(facts.map(f=>`${f.entityId}:${f.since}:${f.until}`)).size!==facts.length||facts.some(f=>!/^\d+$/.test(f.entityId)||!/^\d+$/.test(f.campaignId)||!validDate(f.since)||!validDate(f.until)||f.since<range.since||f.until>range.until||f.since>f.until||(daily&&f.since!==f.until)))throw Error('INSIGHTS_IDENTITY_INVALID');return facts;};
    current[level]=normalized(rows,range,false);prior[level]=normalized(before,comparison,false);daily[level]=normalized(history,range,true);
    entities[level]=await reader.readEntities(level);
    if(ledger?.persistDailySnapshot)await ledger.persistDailySnapshot(daily[level],{...context,...range});
    if(ledger?.persistFacts)await ledger.persistFacts(current[level]);
  }
  if(reader.readCreatives)try{const creatives=await reader.readCreatives(),map=new Map(creatives.map(c=>[String(c.id),c.creative]));entities.ad=entities.ad.map(a=>({...a,creative:map.get(String(a.id))||null}));}catch{creativeStatus='UNAVAILABLE';}
  entities.rules=await reader.readRules();
  const dataset={account,range,comparison,observedAt,current,prior,daily,entities,policy,mode,creativeStatus};
  return {...assembleReport(dataset),dataset};
}
