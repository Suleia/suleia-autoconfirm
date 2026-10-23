import { parseAdsIntent } from './intent.mjs';
import {answerAlgorithm,answerTechnicalQuestion} from './algorithm.mjs';
import {prepareMorningBrief} from './morning.mjs';
import {parseAutopilotQuery,formatAutopilot,formatAutopilotCycle} from './autopilot/queries.mjs';
import {consolidatedPolicy} from './autopilot/policy.mjs';
export async function adsCommand(runtime,body) {
  const actor={user:String(body.actor?.user||''),chat:String(body.actor?.chat||'')};runtime.engine.authorize(actor);
  if(body.action==='autopilot'){
    const report=await runtime.autopilot.overview(),cycle=body.cycleKey?report.slots.find(s=>s.slot_key===body.cycleKey):report.slots[0];
    return {autopilot:report,text:formatAutopilot(report).slice(0,3900),cycleText:cycle?formatAutopilotCycle(report,cycle):null,cycleKey:cycle?.slot_key};
  }
  if(body.action==='inventory')return {inventory:await runtime.engine.inventory()};
  if(body.action==='history')return {history:(await runtime.ledger.history()).filter(p=>p.actor.user===actor.user)};
  if(body.action==='status'&&runtime.autopilot?.config.enabled&&consolidatedPolicy(runtime.autopilot.config))return {text:`Budget Autopilot V5.1 · ${runtime.engine.mode} · revisiones automáticas por horario de Madrid. Pasos diurnos de 10 EUR; mínimo 3 compras; máximo 70 EUR/campaña. Aumento agregado: ${runtime.engine.policy.maxAggregateIncreaseCents/100} EUR/día; mínimo ${runtime.autopilot.config.approved.minimumBudgetCents/100} EUR y techo global configurado ${runtime.autopilot.config.approved.globalExposureCents/100} EUR. Gasto observado: ${runtime.autopilot.config.approved.globalSpendLimitMode==='UNLIMITED_AUTHORIZED'?'sin límite adicional autorizado':'sujeto al límite aprobado'}. Órdenes manuales con confirmación del actor. Datos, mínimos Meta, aprendizaje y conflictos pueden bloquear cambios.`};
  if(body.action==='status')return {text:`Ads Intelligence · ${runtime.engine.mode} · ${runtime.engine.mode==='LIVE'?'Presupuestos con confirmación humana':'LIVE desactivado'}. Límites: ${runtime.engine.policy.maxBudgetCents/100} EUR/día por campaña y ${runtime.engine.policy.maxChangePercent}% por cambio. Aumento agregado: ${runtime.engine.policy.maxAggregateIncreaseCents/100} EUR/día; intervalo por campaña: ${runtime.engine.policy.campaignCooldownMs/3600000} h. Las protecciones pueden bloquear propuestas; no hay ejecución automática.`};
  if(body.action==='analyze')return {analysis:await runtime.overview(body.query)};
  if(body.action==='request'){
    const autopilotQuery=parseAutopilotQuery(body.text);
    if(autopilotQuery&&runtime.autopilot){
      const report=await runtime.autopilot.overview();
      if(autopilotQuery.kind==='history'){
        const candidates=(report.inventory||report.campaigns).filter(c=>c.campaignId===autopilotQuery.selector||String(c.name).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().includes(autopilotQuery.selector));
        if(candidates.length!==1)return {text:'Indica un único ID exacto de campaña para consultar el historial completo.'};
        const history=await runtime.autopilot.audit({campaignId:candidates[0].campaignId,limit:25});
        const text=history.entries.flatMap(p=>p.items.map(i=>`${new Date(p.createdAt).toLocaleString('es-ES',{timeZone:'Europe/Madrid'})} · ${i.name}\n${i.before/100} → ${i.after/100} € · ${i.result?.state||p.state} · ${p.mode} · ${p.origin}`)).join('\n\n');
        return {text:(`Historial de ${candidates[0].name} · Europe/Madrid\n\n${text||'Sin operaciones propias registradas.'}\n${history.nextCursor?'Hay más registros; consulta el historial paginado del panel.':''}\nSIMULATED no representa un cambio aplicado; UNKNOWN requiere conciliación.`).slice(0,3900)};
      }
      return {text:formatAutopilot(report,autopilotQuery)};
    }
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
      let timer;try{const ready=await Promise.race([runtime.autopilot?.config.enabled&&consolidatedPolicy(runtime.autopilot.config)?runtime.budgetGuards():runtime.algorithm(),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),8000);})]);
        if(!ready)return {text:'Preparando las protecciones históricas de la propuesta. Vuelve a solicitarla en unos minutos. Todavía no se ha creado ni ejecutado una propuesta.'};
      }finally{clearTimeout(timer);}
    }
    return {proposal:await runtime.engine.propose({actor,requestKey:body.requestKey,text:body.text})};
  }
  if(['confirm','cancel','reconcile'].includes(body.action))return {proposal:await runtime.engine[body.action]({id:body.id,actor})};
  throw Error('COMMAND_INVALID');
}
