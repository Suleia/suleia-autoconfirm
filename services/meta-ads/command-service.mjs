import { parseAdsIntent } from './intent.mjs';
import {answerAlgorithm,answerTechnicalQuestion} from './algorithm.mjs';
import {prepareMorningBrief} from './morning.mjs';
export async function adsCommand(runtime,body) {
  const actor={user:String(body.actor?.user||''),chat:String(body.actor?.chat||'')};runtime.engine.authorize(actor);
  if(body.action==='inventory')return {inventory:await runtime.engine.inventory()};
  if(body.action==='history')return {history:(await runtime.ledger.history()).filter(p=>p.actor.user===actor.user)};
  if(body.action==='status')return {text:`Ads Intelligence · ${runtime.engine.mode} · ${runtime.engine.mode==='LIVE'?'Presupuestos con confirmación humana':'LIVE desactivado'}. Límites: ${runtime.engine.policy.maxBudgetCents/100} EUR/día por campaña y ${runtime.engine.policy.maxChangePercent}% por cambio. Aumento agregado: ${runtime.engine.policy.maxAggregateIncreaseCents/100} EUR/día; intervalo por campaña: ${runtime.engine.policy.campaignCooldownMs/3600000} h. Las protecciones pueden bloquear propuestas; no hay ejecución automática.`};
  if(body.action==='analyze')return {analysis:await runtime.overview(body.query)};
  if(body.action==='request'){
    const reply=String(body.text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
    if(/^(si,? (?:hazlo|confirmo)|confirmo|no,? cancela|cancela)$/.test(reply)){
      const pending=await runtime.ledger.pendingForActor(actor.user);
      if(pending.length!==1)return {proposal:{state:'CLARIFICATION',question:'No hay una única propuesta pendiente. Utiliza el botón de la operación concreta.'}};
      return {proposal:await runtime.engine[/^(no|cancela)/.test(reply)?'cancel':'confirm']({id:pending[0].id,actor})};
    }
    const intent=parseAdsIntent(body.text);
    if(runtime.reportReadOnly&&intent.kind==='budget')return {text:'El panel está en modo consulta. La persistencia de propuestas necesita aprobar la conexión limitada de Ads. No se ha preparado ni ejecutado ningún cambio.'};
    if(!/^(sube|aumenta|baja|reduce|pon|fija|establece)\b/i.test(body.text)&&/cpm|fatig|creativ|carritos|checkout|perdemos|clics/i.test(body.text))return {text:answerTechnicalQuestion(await runtime.overview({period:intent.period==='30d'?'30d':intent.period||'7d'}),body.text)};
    if(intent.kind==='algorithm'){
      let timer;try{const report=await Promise.race([runtime.algorithm(),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),12000);})]);
        if(report&&/informe matinal/i.test(body.text))return {morning:prepareMorningBrief(await runtime.overview({period:'ayer'}),report)};
        return {text:report?answerAlgorithm(report,body.text):'Preparando el informe histórico de 30 días. Vuelve a consultar en unos minutos; se reutiliza la misma lectura. No se ha propuesto ni modificado ningún presupuesto.'};
      }finally{clearTimeout(timer);}
    }
    if(intent.kind==='analysis')return {analysis:await runtime.overview(intent),focus:intent.focus};
    if(intent.kind==='budget'&&runtime.algorithmEnabled){
      let timer;try{const ready=await Promise.race([runtime.algorithm(),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),12000);})]);
        if(!ready)return {text:'Preparando las protecciones históricas de la propuesta. Vuelve a solicitarla en unos minutos. Todavía no se ha creado ni ejecutado una propuesta.'};
      }finally{clearTimeout(timer);}
    }
    return {proposal:await runtime.engine.propose({actor,requestKey:body.requestKey,text:body.text})};
  }
  if(['confirm','cancel','reconcile'].includes(body.action))return {proposal:await runtime.engine[body.action]({id:body.id,actor})};
  throw Error('COMMAND_INVALID');
}
