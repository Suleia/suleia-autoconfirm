import {cleanText,parsePeriodText,resolvePeriod} from './periods.mjs';
import {CONTRACT} from '../meta-ads/metrics.mjs';

export function parseMetaSummary(text,now=Date.now()) {
 const t=cleanText(text);
 if(/^(sube|aumenta|baja|reduce|pon|fija|establece|confirma|cancela|prepara)\b/.test(t)||/detalle|diagnostico|auditoria|anuncios|conjuntos|embudo|algoritmo|autopilot/.test(t))return null;
 if(!/^(?:como (?:van? |estan? )?(?:las )?(?:campanas|meta)|dame (?:el gasto|(?:un |el )?resumen.*(?:meta|campanas))|(?:que|cual(?:es)?) (?:campana|funciona|esta funcionando)|actualiza (?:las )?campanas|recomienda.*campana)/.test(t))return null;
 let spec=parsePeriodText(t,now);
 const n=/ultimos (3|7|tres|siete) dias/.exec(t);
 if(n){const days=['3','tres'].includes(n[1])?3:7,to=resolvePeriod({preset:'today'},now).to;spec={preset:'custom',from:new Date(Date.parse(to)-(days-1)*86400000).toISOString().slice(0,10),to};}
 if(spec.question)return spec;
 if(spec.preset==='today'&&/semana|mes pasado|ultim[oa]s?/.test(t))return {question:'Indica las fechas del periodo que quieres consultar (AAAA-MM-DD).'};
 if(['48h','hour'].includes(spec.preset))return {question:'Para Meta indica días naturales o fechas; las últimas horas no equivalen a un informe diario.'};
 const p=resolvePeriod(spec,now);
 if((Date.parse(p.to)-Date.parse(p.from))/86400000>=31)return {question:'Consulta Meta en un intervalo de hasta 31 días.'};
 return {since:p.from,until:p.to,periodSpec:n?{days:['3','tres'].includes(n[1])?3:7}:spec,force:true};
}

const valid=f=>Number.isFinite(f.roas)&&['VALID','ZERO'].includes(f.roasStatus);
const enough=f=>Number.isFinite(f.spend)&&f.spend>=15&&Number.isFinite(f.purchases)&&f.purchases>=5&&Number.isFinite(f.impressions)&&f.impressions>=1000;
export async function readMetaSummary(ads,query={},now=Date.now()) {
 // Canonical reader owns pagination, account/currency/attribution and persistence.
 // This lane never receives or invokes propose, confirm, simulate or a writer.
 let since=query.since,until=query.until;
 if(query.periodSpec){
  if([3,7].includes(query.periodSpec.days)){until=resolvePeriod({preset:'today'},now).to;since=new Date(Date.parse(until)-(query.periodSpec.days-1)*86400000).toISOString().slice(0,10);}
  else {const p=resolvePeriod(query.periodSpec,now);since=p.from;until=p.to;}
 }
 const a=await ads.overview({since,until,period:query.period||'hoy',force:true,interactive:true,level:'campaign'});
 if(a.account?.currency!=='EUR'||a.account?.timezone!=='Europe/Madrid'||a.contract!==CONTRACT||a.level!=='campaign'||String(a.account.id).replace(/^act_/,'')!==ads.engine.accountId)throw Error('META_SUMMARY_CONTRACT_INVALID');
 const fresh=a.cache?.status==='FRESH'&&Number.isFinite(Date.parse(a.observedAt))&&now-Date.parse(a.observedAt)>=-60000&&now-Date.parse(a.observedAt)<120000;
 const rows=a.facts.filter(f=>f.delivery==='ACTIVE'||f.spend>0||f.purchases>0);
 const purchases=rows.filter(f=>Number.isFinite(f.purchases)&&f.purchases>0),max=Math.max(0,...purchases.map(f=>f.purchases));
 const winners=purchases.filter(f=>f.purchases===max).map(f=>({id:f.entityId,name:f.name,purchases:f.purchases}));
 let recommendation={direction:'maintain',reason:fresh?'Muestra insuficiente para justificar un cambio.':'Esperar una lectura actualizada antes de recomendar cambios.'};
 const today=resolvePeriod({preset:'today'},now).to;
 if(fresh&&a.range.until!==today)recommendation={direction:'maintain',reason:'Periodo histórico; revisar los datos de hoy antes de cambiar presupuestos.'};
 else if(fresh){
  const candidates=(a.quality?.status==='SOURCE_COMPLETE'?rows:[]).filter(f=>f.delivery==='ACTIVE'&&valid(f)&&enough(f)&&(f.roas>10||f.roas<3)).sort((x,y)=>y.spend-x.spend||String(x.entityId).localeCompare(String(y.entityId)));
  const f=candidates[0];
  if(f){
   recommendation={direction:'maintain',campaign:f.name,reason:'Falta verificar el histórico y las protecciones actuales.'};
   const campaign=a.inventory?.campaigns?.find(c=>String(c.id)===f.entityId);
   if(campaign&&ads.engine.learningAssessment&&ads.ledger.budgetUsage){
    let timer;
    try{
     const [guard,usage]=await Promise.race([Promise.all([ads.engine.learningAssessment(campaign),ads.ledger.budgetUsage(ads.engine.accountId,now,Math.max(86400000,ads.engine.policy.campaignCooldownMs||0))]),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('EVIDENCE_PENDING')),1500);})]);
     const increasing=f.roas>10,history=guard.recent,cap=Math.min(10000,ads.engine.policy.maxBudgetCents||0),allowance=Math.min(3000,ads.engine.policy.maxAggregateIncreaseCents||0);
     const corroborated=enough(history||{})&&Number.isFinite(history?.roas)&&(increasing?history.roas>10:history.roas<3);
     const blocked=(guard.reasons||[]).length||guard.contextWarnings?.some(r=>r!=='VERIFIED_ECONOMICS_MISSING')||!Array.isArray(guard.reasons)||!corroborated||usage.changedCampaignIds.includes(f.entityId)||!Number.isSafeInteger(f.budgetCents)||f.budgetCents<=0||(increasing&&(f.budgetCents>=cap||usage.increaseCents>=allowance));
     recommendation={direction:blocked?'maintain':increasing?'increase':'decrease',campaign:f.name,reason:blocked?'El histórico o las protecciones vigentes no justifican un cambio.':`ROAS ${f.roas.toFixed(2)} en el periodo, respaldado por los últimos 7 días; concretar importe antes de confirmar.`};
    }catch{}finally{clearTimeout(timer);}
   }
  }else if(rows.some(enough))recommendation={direction:'maintain',reason:'Ninguna campaña activa reúne muestra suficiente y ROAS >10 o <3.'};
 }
 return {range:a.range,periodSpec:query.periodSpec,requestedAt:new Date(now).toISOString(),diagnostic:a.diagnostic,observedAt:a.observedAt,fresh,totals:a.totals,rows,winners,winnerComplete:a.quality?.missingPurchaseRows===0,recommendation,partial:a.quality?.status==='PARTIAL',contract:a.contract};
}
