import {windowFor,CONTRACT} from './metrics.mjs';

// Uses the canonical GET-only client. A failed collection stays unavailable,
// never an empty successful history. No persistence or notification side effects.
export async function captureAlgorithmEvidence({reader,now=Date.now(),readOrders=null,readOperations=null}) {
  const range=windowFor('30d',now),sources={},evidence={range,contract:CONTRACT,observedAt:new Date(now).toISOString(),sources};
  async function capture(key,fn){try{evidence[key]=await fn();sources[key]={status:'COMPLETE',observedAt:new Date().toISOString()};}catch(e){evidence[key]=null;sources[key]={status:'UNAVAILABLE',code:/^[A-Z0-9_]+$/.test(e.code||'')?e.code:'SOURCE_READ_FAILED'};}}
  await capture('account',()=>reader.readAccount());
  if(evidence.account&&(evidence.account.currency!=='EUR'||evidence.account.timezone_name!=='Europe/Madrid'||(evidence.account.account_status!==undefined&&evidence.account.account_status!==1)||(reader.configuredAccountId&&String(evidence.account.id).replace(/^act_/,'')!==reader.configuredAccountId)))throw Error('ACCOUNT_NOT_ELIGIBLE');
  evidence.daily={};evidence.entities={};
  for(const level of ['campaign','adset','ad']){
    await capture('daily_'+level,()=>reader.readInsights({...range,level,daily:true}));evidence.daily[level]=evidence['daily_'+level];delete evidence['daily_'+level];
    await capture('entities_'+level,()=>reader.readAuditDetails(level));evidence.entities[level]=evidence['entities_'+level];delete evidence['entities_'+level];
  }
  await capture('hourlyTraffic',()=>reader.readHourlyTraffic(range));
  await capture('activities',()=>reader.readActivityHistory(range));
  await capture('currentActivities',()=>reader.readActivityHistory(windowFor('hoy',now)));
  await capture('rules',()=>reader.readAuditRules());
  if(reader.readAdRankings)await capture('rankings',()=>reader.readAdRankings(range));
  if(readOrders)await capture('orders',()=>readOrders(range));else sources.orders={status:'UNAVAILABLE',code:'ORDER_SOURCE_NOT_CONFIGURED'};
  if(readOperations)await capture('operations',()=>readOperations(range,evidence.orders||[]));else sources.operations={status:'UNAVAILABLE',code:'OPERATIONS_SOURCE_NOT_CONFIGURED'};
  evidence.hourlyConversionBasis={status:'UNVERIFIED',note:'El desglose horario de tráfico corresponde a entrega en la zona del anunciante. No se interpreta como hora de compra ni se calcula conversión horaria cruzando relojes distintos.'};
  return evidence;
}
