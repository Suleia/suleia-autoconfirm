// Shared V9/V10 deterministic decision brief. Receives no Meta writer.
import {buildGrowthFunnel} from '../review/growth-funnel.mjs';
export const GROWTH_POLICY=Object.freeze({version:'suleia-growth-v10.0',minSpend:15,minImpressions:1000,minPurchases:5,minEvidenceDays:3,minFunnelEvents:30,materialChangePercent:20,funnelDropPercent:25,scaleRoas:3.8,pauseRoas:2.2,weakMonthRoas:2.5,zeroPurchaseSpend:60,maxPriorities:5});
const isNumber=Number.isFinite;
const fmt=(x,unit='')=>isNumber(x)?new Intl.NumberFormat('es-ES',{maximumFractionDigits:2}).format(x)+unit:'N/D';
const finiteRow=r=>r&&r.source==='META_INSIGHTS'&&isNumber(r.spend)&&r.spend>=0;
const comparable=r=>Boolean(r?.comparable&&r?.prior&&r.contract===r.prior.contract&&r.purchaseType===r.prior.purchaseType);
const enough=(r,p=GROWTH_POLICY)=>finiteRow(r)&&r.spend>=p.minSpend&&r.impressions>=p.minImpressions&&r.purchases>=p.minPurchases&&isNumber(r.roas)&&isNumber(r.cpa)&&r.sample?.state!=='MEASUREMENT_BLOCKED'&&r.sample?.coverageComplete!==false&&r.sample?.contextVerified!==false&&(r.sample?.daysWithEvidence??0)>=p.minEvidenceDays;
const prevEnough=(r,p=GROWTH_POLICY)=>comparable(r)&&r.prior.purchases>=p.minPurchases&&isNumber(r.prior.roas)&&isNumber(r.prior.cpa)&&r.sample?.priorCoverageComplete!==false;
const pct=(a,b)=>isNumber(a)&&isNumber(b)&&b>0?((a-b)/b)*100:null;
const ratio=(a,b)=>isNumber(a)&&isNumber(b)&&b>0?a/b:null;
const safeName=x=>String(x??'').replace(/[\u0000-\u001f]/g,' ').slice(0,150);
const metrics=r=>r?{spend:r.spend??null,purchases:r.purchases??null,roas:r.roas??null,cpa:r.cpa??null,linkCtr:r.linkCtr??null,linkCpc:r.linkCpc??null,cpm:r.cpm??null,landingPageViews:r.landingPageViews??null,addToCart:r.addToCart??null,initiateCheckout:r.initiateCheckout??null,purchaseValue:r.purchaseValue??null,frequency:r.frequency??null,costPerCheckout:ratio(r.spend,r.initiateCheckout),costPerCart:ratio(r.spend,r.addToCart)}:null;

function assess(r,{level,month=null,today=null,adsetName=null,policy=GROWTH_POLICY,threshold=policy.scaleRoas,sourceReady=true,ranges={}}={}){
 const evidence={week:metrics(r),previous:comparable(r)?metrics(r.prior):null,month:metrics(month),previousMonth:month?.comparable?metrics(month.prior):null,today:metrics(today),range:'7 días completos',ranges,source:r?.contract||null};
 const changes=(r?.diagnoses||[]).find(d=>d.code==='BUDGET_CHANGED')?.evidence?.events||[];
 const learning=r?.sample?.learning?.status||null;
 const common={id:String(r?.entityId||''),key:`${level}:${r?.entityId||''}`,campaignId:String(r?.campaignId||r?.entityId||''),adsetId:r?.adsetId||null,adsetName:adsetName||null,name:safeName(r?.name),level,confidence:'LOW',confidenceReason:'Confianza cualitativa por muestra, cobertura e histórico; no es una probabilidad estadística.',status:'DATOS_INSUFICIENTES',why:'Sin suficiente evidencia comparable para recomendar cambios.',next:'Verificar compras, atribución y muestra antes de decidir.',evidence,guards:{learning:learning||'UNVERIFIED',recentBudgetChanges:changes,execution:'NOT_AUTHORIZED_BY_REVIEW'},risk:'Atribución tardía, subasta y cambios simultáneos pueden alterar la conclusión.',alternatives:['Mezcla de tráfico u objetivos','Retraso o pérdida de eventos','Cambio de oferta o subasta'],validation:'Comprobar medición y probar una sola variable con aprobación.',externalWrites:0,requiresApproval:true,actionExecutable:false};
 if(!sourceReady||!r||!finiteRow(r)||r.delivery!=='ACTIVE'||r.sample?.state==='MEASUREMENT_BLOCKED'||r.roasStatus==='AMBIGUOUS'||r.quality?.purchase==='AMBIGUOUS'){
  return {...common,status:r?.delivery==='PAUSED'?'INACTIVA':'DATOS_INSUFICIENTES',why:!sourceReady?'Lectura reciente o contrato no verificado.':r?.sample?.state==='MEASUREMENT_BLOCKED'?'La medición de compras presenta anomalías.':common.why};
 }
 const weekly=enough(r,policy),prev=prevEnough(r,policy),monthly=enough(month,policy)&&month?.contract===r.contract&&month?.purchaseType===r.purchaseType;
 const weakNow=isNumber(today?.roas)&&isNumber(today?.purchases)&&today.purchases>=3&&today.roas<threshold;
 const verifiedFunnel=buildGrowthFunnel(r,r.prior,{comparable:comparable(r),minDenominator:policy.minFunnelEvents,materialDropPercent:policy.funnelDropPercent});
 if(verifiedFunnel.status==='ANOMALOUS')return {...common,why:'Hay etapas con poblaciones anómalas o incompatibles; reconciliar la medición antes de clasificar eficiencia.',next:'Revisar eventos y sus ámbitos sin afirmar que la web esté rota.'};
 const observed=verifiedFunnel.stages.find(s=>s.key===verifiedFunnel.worstStage);
 const funnel=observed?{...observed,label:observed.key==='addToCart'?'carritos':observed.label,changePercent:observed.rateChangePercent,recommend:'Revisar la etapa y comprobar eventos Pixel/CAPI',evidence:verifiedFunnel}:null;
 const ctrDecline=prev&&isNumber(r.linkCtr)&&isNumber(r.prior.linkCtr)&&r.prior.linkCtr>0&&pct(r.linkCtr,r.prior.linkCtr)<=-20;
 const cpaWorse=prev&&pct(r.cpa,r.prior.cpa)>=25;
 const roasWorse=prev&&pct(r.roas,r.prior.roas)<=-20;
 const days=r.sample?.daysWithEvidence??0;
 const twoWindowsPoor=weekly&&prev&&r.roas<policy.pauseRoas&&r.prior.roas<policy.pauseRoas;
 const monthPoor=monthly&&month.roas<policy.weakMonthRoas||finiteRow(month)&&month.contract===r.contract&&month.purchaseType===r.purchaseType&&month.purchases===0&&month.purchaseValue===0&&month.spend>=policy.zeroPurchaseSpend;
 const zeroWeek=finiteRow(r)&&r.purchases===0&&r.purchaseValue===0&&r.roas===0&&r.spend>=policy.zeroPurchaseSpend&&days>=policy.minEvidenceDays&&r.sample?.coverageComplete!==false;
 const zeroPrior=comparable(r)&&r.prior.purchases===0&&r.prior.purchaseValue===0&&r.prior.spend>=policy.zeroPurchaseSpend&&r.sample?.priorCoverageComplete!==false;
 // A single poor day never justifies a pause; multiple completed windows must agree.
 if((twoWindowsPoor&&monthPoor)||(zeroWeek&&zeroPrior&&monthPoor)){
  return {...common,confidence:'MEDIUM',status:'REVISAR_PAUSA',why:`Deterioro repetido: ROAS 7d ${fmt(r.roas)} y base ${fmt(r.prior?.roas)}; histórico 30d ${fmt(month?.roas)}.`,next:'Revisar adsets/anuncios y conversiones antes de considerar desactivar. Solo propuesta supervisada.',funnel};
 }
 if(zeroWeek&&(!zeroPrior||!monthPoor)){
  return {...common,status:'INVESTIGAR',confidence:'LOW',why:`${fmt(r.spend,' €')} de gasto y cero compras verificadas en varios días; insuficiente para atribuir una causa.`,next:'Comprobar carritos, checkout, aprendizaje y cambios recientes antes de considerar pausa.',funnel};
 }
 if(!funnel&&weekly&&prev&&r.roas<threshold&&(roasWorse||cpaWorse)&&monthly&&month.roas<threshold){
  return {...common,status:'REVISAR_REDUCCION',confidence:'MEDIUM',why:`ROAS 7d ${fmt(r.roas)} frente a ${fmt(r.prior.roas)}; CPA ${fmt(r.cpa,' €')} (${fmt(pct(r.cpa,r.prior.cpa),' %')}). Mes ROAS ${fmt(month.roas)}.`,next:'Evaluar reducción solo si la política V5.1 lo permite; primero identificar anuncios responsables.',funnel};
 }
 if(funnel){
  return {...common,status:'MEJORAR_CONVERSION',confidence:weekly&&prev?'MEDIUM':'LOW',why:`Señal de caída en ${funnel.label}: ${fmt(funnel.changePercent,'%')} frente a la semana anterior, con denominadores suficientes.`,next:funnel.recommend+'. Validar eventos Pixel/CAPI; es una asociación, no una causa probada.',funnel};
 }
 if(ctrDecline&&(cpaWorse||roasWorse)){
  return {...common,status:'MEJORAR_CREATIVIDAD',confidence:'MEDIUM',why:`CTR cae ${fmt(pct(r.linkCtr,r.prior.linkCtr),' %')} y empeora CPA/ROAS entre dos semanas completas.`,next:'Comparar hooks, anuncios, CPM y frecuencia; probar una creatividad nueva sin tocar otras variables.'};
 }
 if(weekly&&prev&&monthly&&r.roas>threshold&&month.roas>threshold&&r.roas>=r.prior.roas*0.85&&r.cpa<=r.prior.cpa*1.25&&(weakNow||/LEARNING/.test(String(learning))||changes.length))return {...common,status:'PROTEGER',confidence:'MEDIUM',why:`Histórico favorable, pero ${weakNow?'hoy hay una señal contraria':'hay aprendizaje o cambios recientes'}.`,next:'Mantener observación y verificar las guardas antes de preparar una propuesta.'};
 if(weekly&&prev&&monthly&&r.roas>threshold&&month.roas>threshold&&r.roas>=r.prior.roas*0.85&&r.cpa<=r.prior.cpa*1.25){
  return {...common,status:'CANDIDATA_ESCALAR',confidence:'MEDIUM',why:`ROAS 7d ${fmt(r.roas)}, ROAS 30d ${fmt(month.roas)}, ${fmt(r.purchases)} compras y CPA ${fmt(r.cpa,' €')} sin deterioro material frente a la semana previa.`,next:weakNow?'Hoy presenta ROAS inferior al umbral: esperar y reevaluar.':'Consultar ROAS y compras intradiarias, margen, cambios previos y límites V5.1 antes de proponer +10 €.'};
 }
 if(weekly&&r.roas>=threshold){
  return {...common,status:'PROTEGER',confidence:prev?'MEDIUM':'LOW',why:`ROAS 7d ${fmt(r.roas)} y ${fmt(r.purchases)} compras; aún no hay evidencia completa para escalar.`,next:'Mantener sin modificaciones extraordinarias y continuar validando CPA, carritos y calidad del pedido.'};
 }
 if(weekly&&r.roas<threshold){
  return {...common,status:'MANTENER',confidence:prev?'MEDIUM':'LOW',why:`ROAS 7d ${fmt(r.roas)} por debajo de ${fmt(threshold)}; la comparación disponible no acredita una intervención inmediata.`,next:'Vigilar evolución, historial de cambios y margen antes de actuar.'};
 }
 return {...common,status:'DATOS_INSUFICIENTES',why:`Muestra 7d: ${fmt(r.spend,' €')} de gasto, ${fmt(r.purchases)} compras y ${fmt(days)} días con filas. No se autoriza juicio de eficiencia.`,next:'Esperar más evidencia o reconciliar los eventos; no pausar por un día aislado.'};
}

export function buildDailyDecisions({today=null,week=null,month=null,adsets=null,ads=null,adsetMonth=null,adMonth=null,budget=null,policy=GROWTH_POLICY,now=null}={}){
 policy={...GROWTH_POLICY,...policy};if(!policy.version||Object.keys(policy).some(k=>!Object.hasOwn(GROWTH_POLICY,k)||k!=='version'&&(!isNumber(policy[k])||policy[k]<=0)))throw Error('GROWTH_POLICY_INVALID');
 const fresh=r=>r?.freshness==='FRESH'&&(now===null||Number.isFinite(Date.parse(r.observedAt))&&now-Date.parse(r.observedAt)>=0&&now-Date.parse(r.observedAt)<120000);
 const ready=fresh(week)&&week?.range?.partial===false;
 const monthReady=fresh(month)&&month?.range?.partial===false&&week?.contract===month?.contract&&week?.range?.until===month?.range?.until;
 const ranges={today:today?.range||null,week:week?.range||null,previous:week?.baselineRange||null,month:month?.range||null,previousMonth:month?.baselineRange||null};
 const monthly=new Map((monthReady?month.rows:[]).map(r=>[r.entityId,r]));
 const current=new Map((today?.rows||[]).map(r=>[r.entityId,r]));
 const campaigns=(week?.rows||[]).map(r=>assess(r,{level:'campaign',month:monthly.get(r.entityId),today:current.get(r.entityId),sourceReady:ready,policy,ranges}));
 const adsetNames=new Map((ads?.inventory?.adset||[]).map(r=>[String(r.id),r.name]));
 const adsetsReady=fresh(adsets)&&adsets?.range?.partial===false&&adsets?.contract===week?.contract;
 const adsetRows=(adsets?.rows||[]).map(r=>assess(r,{level:'adset',adsetName:r.name,month:fresh(adsetMonth)?adsetMonth.rows?.find(m=>m.entityId===r.entityId):null,sourceReady:adsetsReady,policy,ranges}));
 const adRows=(ads?.rows||[]).map(r=>assess(r,{level:'ad',adsetName:adsetNames.get(String(r.adsetId)),month:fresh(adMonth)?adMonth.rows?.find(m=>m.entityId===r.entityId):null,sourceReady:fresh(ads)&&ads?.range?.partial===false&&ads?.contract===week?.contract,policy,ranges}));
 const order=['REVISAR_PAUSA','REVISAR_REDUCCION','MEJORAR_CONVERSION','MEJORAR_CREATIVIDAD','CANDIDATA_ESCALAR','INVESTIGAR','PROTEGER','MANTENER','DATOS_INSUFICIENTES','INACTIVA'];
 const sort=(a,b)=>order.indexOf(a.status)-order.indexOf(b.status)||((b.evidence.week?.spend||0)-(a.evidence.week?.spend||0));
 campaigns.sort(sort);adsetRows.sort(sort);adRows.sort(sort);
 const candidates=[...campaigns,...adsetRows,...adRows].filter(r=>!['DATOS_INSUFICIENTES','INACTIVA'].includes(r.status)).sort(sort);
 const status=!ready?'INSUFFICIENT':!monthReady?'PARTIAL':fresh(today)?'READY':'HISTORICAL_ONLY';
 const highlights=[],perCampaign=new Map();
 for(const c of candidates){const used=perCampaign.get(c.campaignId)||0;if(used>=2)continue;highlights.push(c);perCampaign.set(c.campaignId,used+1);if(highlights.length===policy.maxPriorities)break;}
 for(const c of [...campaigns,...adsetRows,...adRows]){c.priority=Math.max(1,order.indexOf(c.status)+1);c.proposalEligible=c.level==='campaign'&&ready&&/^\d+$/.test(c.id)&&['CANDIDATA_ESCALAR','REVISAR_REDUCCION'].includes(c.status);}
 return {version:policy.version,policy,status,generatedFrom:{today:today?.observedAt||null,week:week?.range||null,month:month?.range||null,ads:ads?.range||null,contract:week?.contract||null,timezone:'Europe/Madrid',budgetMode:budget?.mode||'UNKNOWN'},goal:{targetOrdersPerDay:55,targetConfirmedPerDay:40,note:'Objetivos de negocio; ROAS atribuido no implica beneficio ni confirmado en Dropea.'},summary:{campaigns:campaigns.length,adsets:adsetRows.length,ads:adRows.length,requiresReview:candidates.filter(r=>!['MANTENER','PROTEGER'].includes(r.status)).length,proposalOnly:true},topActions:highlights,campaigns,adsets:adsetRows,ads:adRows,limits:['Ninguna clasificación ejecuta Meta ni autoriza cambios presupuestarios.','El día en curso es provisional y no sirve por sí solo para pausar.','No hay atribución fiable campaña → pedido confirmado/entregado; beneficio real desconocido.','Una señal de embudo puede deberse a medición; verificar Pixel/CAPI.','Las recomendaciones se validan con las reglas y confirmaciones existentes de V5.1.'],externalWrites:0,metaWrites:0};
}
