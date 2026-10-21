import { parseAdsIntent } from './intent.mjs';
export async function adsCommand(runtime,body) {
  const actor={user:String(body.actor?.user||''),chat:String(body.actor?.chat||'')};runtime.engine.authorize(actor);
  if(body.action==='inventory')return {inventory:await runtime.engine.inventory()};
  if(body.action==='history')return {history:(await runtime.ledger.history()).filter(p=>p.actor.user===actor.user)};
  if(body.action==='status')return {text:`Ads Intelligence · ${runtime.engine.mode} · ${runtime.engine.mode==='LIVE'?'Canary limitado a la campaña autorizada':'LIVE desactivado'}. Confirmación por operación. Límites: ${runtime.engine.policy.maxBudgetCents/100} EUR/día y ${runtime.engine.policy.maxChangePercent}% de cambio.`};
  if(body.action==='analyze')return {analysis:await runtime.engine.analyze(body.query)};
  if(body.action==='request'){
    const reply=String(body.text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
    if(/^(si,? (?:hazlo|confirmo)|confirmo|no,? cancela|cancela)$/.test(reply)){
      const pending=await runtime.ledger.pendingForActor(actor.user);
      if(pending.length!==1)return {proposal:{state:'CLARIFICATION',question:'No hay una única propuesta pendiente. Utiliza el botón de la operación concreta.'}};
      return {proposal:await runtime.engine[/^(no|cancela)/.test(reply)?'cancel':'confirm']({id:pending[0].id,actor})};
    }
    const intent=parseAdsIntent(body.text);
    if(intent.kind==='analysis')return {analysis:await runtime.engine.analyze(intent)};
    return {proposal:await runtime.engine.propose({actor,requestKey:body.requestKey,text:body.text})};
  }
  if(['confirm','cancel','reconcile'].includes(body.action))return {proposal:await runtime.engine[body.action]({id:body.id,actor})};
  throw Error('COMMAND_INVALID');
}
