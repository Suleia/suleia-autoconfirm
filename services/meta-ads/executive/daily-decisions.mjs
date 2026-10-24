// Read-only, deterministic V9 decision brief. Never sends a Meta mutation.
const isNumber=Number.isFinite;
const fmt=(x,unit='')=>isNumber(x)?new Intl.NumberFormat('es-ES',{maximumFractionDigits:2}).format(x)+unit:'N/D';
const finiteRow=r=>r&&r.source==='META_INSIGHTS'&&isNumber(r.spend)&&r.spend>=0;
const comparable=r=>Boolean(r?.comparable&&r?.prior&&r.contract===r.prior.contract&&r.purchaseType===r.prior.purchaseType);
const enough=r=>finiteRow(r)&&r.spend>=15&&r.impressions>=1000&&r.purchases>=5&&isNumber(r.roas)&&isNumber(r.cpa)&&r.sample?.state!=='MEASUREMENT_BLOCKED';
const prevEnough=r=>comparable(r)&&r.prior.purchases>=5&&isNumber(r.prior.roas)&&isNumber(r.prior.cpa);
const pct=(a,b)=>isNumber(a)&&isNumber(b)&&b>0?((a-b)/b)*100:null;
const ratio=(a,b)=>isNumber(a)&&isNumber(b)&&b>0?a/b:null;
const safeName=x=>String(x??'').replace(/[\u0000-\u001f]/g,' ').slice(0,150);
const metrics=r=>r?{spend:r.spend??null,purchases:r.purchases??null,roas:r.roas??null,cpa:r.cpa??null,linkCtr:r.linkCtr??null,linkCpc:r.linkCpc??null,cpm:r.cpm??null,landingPageViews:r.landingPageViews??null,addToCart:r.addToCart??null,initiateCheckout:r.initiateCheckout??null,costPerCart:ratio(r.spend,r.addToCart)}:null;

function funnelDiagnostic(r){
 const before=comparable(r)?r.prior:null;
 const stages=[
  {key:'landing',metric:'landingPageViews',parent:'linkClicks',min:30,label:'visitas a landing',recommend:'Comprobar velocidad, apertura y medición de landing'},
  {key:'cart',metric:'addToCart',parent:'landingPageViews',min:30,label:'carritos',recommend:'Revisar ficha, oferta y calidad del tráfico'},
  {key:'checkout',metric:'initiateCheckout',parent:'addToCart',min:30,label:'inicio de checkout',recommend:'Revisar carrito, envío y fricción de checkout'},
  {key:'purchase',metric:'purchases',parent:'initiateCheckout',min:30,label:'compras',recommend:'Revisar checkout, confirmación y señal Purchase'}
 ];
 const changes=[];
 for(const s of stages){
  if(!before||!isNumber(r[s.metric])||!isNumber(before[s.metric])||r[s.parent]<s.min||before[s.parent]<s.min)continue;
  if(s.key==='purchase'&&r.purchaseType!==before.purchaseType)continue;
  const now=ratio(r[s.metric],r[s.parent]),prior=ratio(before[s.metric],before[s.parent]);
  const change=pct(now,prior);
  if(isNumber(change)&&change<=-25)changes.push({...s,current:now,previous:prior,changePercent:change});
 }
 return changes.sort((a,b)=>a.changePercent-b.changePercent)[0]||null;
}
function assess(r,{level,month=null,today=null,adsetName=null,threshold=3.8,sourceReady=true}={}){
 const evidence={week:metrics(r),previous:comparable(r)?metrics(r.prior):null,month:metrics(month),today:metrics(today),range:'7 días completos',source:r?.contract||null};
 const common={id:String(r?.entityId||''),campaignId:String(r?.campaignId||r?.entityId||''),adsetId:r?.adsetId||null,adsetName:adsetName||null,name:safeName(r?.name),level,confidence:'LOW',status:'DATOS_INSUFICIENTES',why:'Sin suficiente evidencia comparable para recomendar cambios.',next:'Verificar compras, atribución y muestra antes de decidir.',evidence,externalWrites:0,requiresApproval:true,actionExecutable:false};
 if(!sourceReady||!r||!finiteRow(r)||r.delivery!=='ACTIVE'||r.sample?.state==='MEASUREMENT_BLOCKED'){
  return {...common,status:r?.delivery==='PAUSED'?'INACTIVA':'DATOS_INSUFICIENTES',why:!sourceReady?'Lectura reciente o contrato no verificado.':r?.sample?.state==='MEASUREMENT_BLOCKED'?'La medición de compras presenta anomalías.':common.why};
 }
 const weekly=enough(r),prev=prevEnough(r),monthly=enough(month)&&month?.contract===r.contract&&month?.purchaseType===r.purchaseType;
 const weakNow=isNumber(today?.roas)&&isNumber(today?.purchases)&&today.purchases>=3&&today.roas<threshold;
 const funnel=funnelDiagnostic(r);
 const ctrDecline=prev&&isNumber(r.linkCtr)&&isNumber(r.prior.linkCtr)&&r.prior.linkCtr>0&&pct(r.linkCtr,r.prior.linkCtr)<=-20;
 const cpaWorse=prev&&pct(r.cpa,r.prior.cpa)>=25;
 const roasWorse=prev&&pct(r.roas,r.prior.roas)<=-20;
 const days=r.sample?.daysWithEvidence??0;
 const twoWindowsPoor=weekly&&prev&&r.roas<2.2&&r.prior.roas<2.2;
 const monthPoor=monthly&&month.roas<2.5;
 const zeroWeek=finiteRow(r)&&r.purchases===0&&r.purchaseValue===0&&r.spend>=60&&days>=3;
 const zeroPrior=prev&&r.prior.purchases===0&&r.prior.spend>=30;
 // A single poor day never justifies a pause; multiple completed windows must agree.
 if((twoWindowsPoor&&monthPoor)||(zeroWeek&&zeroPrior&&monthPoor)){
  return {...common,confidence:'MEDIUM',status:'REVISAR_PAUSA',why:`Deterioro repetido: ROAS 7d ${fmt(r.roas)} y base ${fmt(r.prior?.roas)}; histórico 30d ${fmt(month?.roas)}.`,next:'Revisar adsets/anuncios y conversiones antes de considerar desactivar. Solo propuesta supervisada.',funnel};
 }
 if(zeroWeek&&(!zeroPrior||!monthPoor)){
  return {...common,status:'INVESTIGAR',confidence:'LOW',why:`${fmt(r.spend,' €')} de gasto y cero compras verificadas en varios días; insuficiente para atribuir una causa.`,next:'Comprobar carritos, checkout, aprendizaje y cambios recientes antes de considerar pausa.',funnel};
 }
 if(weekly&&prev&&r.roas<threshold&&(roasWorse||cpaWorse)&&monthly&&month.roas<threshold){
  return {...common,status:'REVISAR_REDUCCION',confidence:'MEDIUM',why:`ROAS 7d ${fmt(r.roas)} frente a ${fmt(r.prior.roas)}; CPA ${fmt(r.cpa,' €')} (${fmt(pct(r.cpa,r.prior.cpa),' %')}). Mes ROAS ${fmt(month.roas)}.`,next:'Evaluar reducción solo si la política V5.1 lo permite; primero identificar anuncios responsables.',funnel};
 }
 if(funnel){
  return {...common,status:'MEJORAR_CONVERSION',confidence:weekly&&prev?'MEDIUM':'LOW',why:`Señal de caída en ${funnel.label}: ${fmt(funnel.changePercent,'%')} frente a la semana anterior, con denominadores suficientes.`,next:funnel.recommend+'. Validar eventos Pixel/CAPI; es una asociación, no una causa probada.',funnel};
 }
 if(ctrDecline&&(cpaWorse||roasWorse)){
  return {...common,status:'MEJORAR_CREATIVIDAD',confidence:'MEDIUM',why:`CTR cae ${fmt(pct(r.linkCtr,r.prior.linkCtr),' %')} y empeora CPA/ROAS entre dos semanas completas.`,next:'Comparar hooks, anuncios, CPM y frecuencia; probar una creatividad nueva sin tocar otras variables.'};
 }
 if(weekly&&prev&&monthly&&r.roas>threshold&&month.roas>threshold&&r.roas>=r.prior.roas*0.85&&r.cpa<=r.prior.cpa*1.25){
  return {...common,status:'CANDIDATA_ESCALAR',confidence:'MEDIUM',why:`ROAS 7d ${fmt(r.roas)}, ROAS 30d ${fmt(month.roas)}, ${fmt(r.purchases)} compras y CPA ${fmt(r.cpa,' €')} sin deterioro material frente a la semana previa.`,next:weakNow?'Hoy presenta ROAS inferior al umbral: esperar y reevaluar.':'Consultar ROAS y compras intradiarias, margen, cambios previos y límites V5.1 antes de proponer +10 €.'};
 }
 if(weekly&&r.roas>=threshold){
  return {...common,status:'PROTEGER',confidence:prev?'MEDIUM':'LOW',why:`ROAS 7d ${fmt(r.roas)} y ${fmt(r.purchases)} compras; aún no hay evidencia completa para escalar.`,next:'Mantener sin modificaciones extraordinarias y continuar validando CPA, carritos y calidad del pedido.'};
 }
 if(weekly&&r.roas<threshold){
  return {...common,status:'MANTENER_VIGILAR',confidence:prev?'MEDIUM':'LOW',why:`ROAS 7d ${fmt(r.roas)} por debajo de ${fmt(threshold)}; la comparación disponible no acredita una intervención inmediata.`,next:'Vigilar evolución, historial de cambios y margen antes de actuar.'};
 }
 return {...common,status:'DATOS_INSUFICIENTES',why:`Muestra 7d: ${fmt(r.spend,' €')} de gasto, ${fmt(r.purchases)} compras y ${fmt(days)} días con filas. No se autoriza juicio de eficiencia.`,next:'Esperar más evidencia o reconciliar los eventos; no pausar por un día aislado.'};
}

export function buildDailyDecisions({today=null,week=null,month=null,ads=null,budget=null}={}){
 const ready=week?.freshness==='FRESH'&&week?.range?.partial===false&&month?.freshness==='FRESH'&&month?.range?.partial===false&&ads?.freshness==='FRESH'&&ads?.range?.partial===false
  &&week?.contract===month?.contract&&week?.contract===ads?.contract;
 const monthly=new Map((month?.rows||[]).map(r=>[r.entityId,r]));
 const current=new Map((today?.rows||[]).map(r=>[r.entityId,r]));
 const campaigns=(week?.rows||[]).map(r=>assess(r,{level:'campaign',month:monthly.get(r.entityId),today:current.get(r.entityId),sourceReady:ready}));
 const adsetNames=new Map((ads?.inventory?.adset||[]).map(r=>[String(r.id),r.name]));
 const adRows=(ads?.rows||[]).map(r=>assess(r,{level:'ad',adsetName:adsetNames.get(String(r.adsetId)),sourceReady:ready}));
 const order=['REVISAR_PAUSA','REVISAR_REDUCCION','MEJORAR_CONVERSION','MEJORAR_CREATIVIDAD','CANDIDATA_ESCALAR','INVESTIGAR','PROTEGER','MANTENER_VIGILAR','DATOS_INSUFICIENTES','INACTIVA'];
 const sort=(a,b)=>order.indexOf(a.status)-order.indexOf(b.status)||((b.evidence.week?.spend||0)-(a.evidence.week?.spend||0));
 campaigns.sort(sort);adRows.sort(sort);
 const candidates=[...campaigns,...adRows].filter(r=>!['DATOS_INSUFICIENTES','INACTIVA','MANTENER_VIGILAR','PROTEGER'].includes(r.status)).sort(sort);
 const status=!ready?'INSUFFICIENT':today?.freshness==='FRESH'?'READY':'HISTORICAL_ONLY';
 return {version:'suleia-daily-decisions-v9.0',status,generatedFrom:{today:today?.observedAt||null,week:week?.range||null,month:month?.range||null,ads:ads?.range||null,contract:week?.contract||null,timezone:'Europe/Madrid',budgetMode:budget?.mode||'UNKNOWN'},goal:{targetOrdersPerDay:55,targetConfirmedPerDay:40,note:'Objetivos de negocio; ROAS atribuido no implica beneficio ni confirmado en Dropea.'},summary:{campaigns:campaigns.length,ads:adRows.length,requiresReview:candidates.length,proposalOnly:true},topActions:candidates.slice(0,5),campaigns,ads:adRows,limits:['Ninguna clasificación ejecuta Meta ni autoriza cambios presupuestarios.','El día en curso es provisional y no sirve por sí solo para pausar.','No hay atribución fiable campaña → pedido confirmado/entregado; beneficio real desconocido.','Una señal de embudo puede deberse a medición; verificar Pixel/CAPI.','Las recomendaciones se validan con las reglas y confirmaciones existentes de V5.1.'],externalWrites:0,metaWrites:0};
}
