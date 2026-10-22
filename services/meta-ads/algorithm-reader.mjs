import {windowFor,CONTRACT} from './metrics.mjs';

// Uses the canonical GET-only client. A failed collection stays unavailable,
// never an empty successful history. No persistence or notification side effects.
export async function captureAlgorithmEvidence({reader,now=Date.now(),readOrders=null,readOperations=null,scope='FULL'}) {
  if(!['FULL','BUDGET_GUARDS'].includes(scope))throw Error('EVIDENCE_SCOPE_INVALID');
  const range=windowFor(scope==='BUDGET_GUARDS'?'7d':'30d',now),sources={},evidence={range,contract:CONTRACT,observedAt:new Date(now).toISOString(),sources,scope};
  async function capture(key,fn){try{evidence[key]=await fn();sources[key]={status:'COMPLETE',observedAt:new Date().toISOString()};}catch(e){evidence[key]=null;sources[key]={status:'UNAVAILABLE',code:/^[A-Z0-9_]+$/.test(e.code||'')?e.code:'SOURCE_READ_FAILED'};}}
  await capture('account',()=>reader.readAccount());
  if(evidence.account&&(evidence.account.currency!=='EUR'||evidence.account.timezone_name!=='Europe/Madrid'||(evidence.account.account_status!==undefined&&evidence.account.account_status!==1)||(reader.configuredAccountId&&String(evidence.account.id).replace(/^act_/,'')!==reader.configuredAccountId)))throw Error('ACCOUNT_NOT_ELIGIBLE');
  evidence.daily={};evidence.entities={};
  if(scope==='BUDGET_GUARDS'){
    await Promise.all([
      capture('daily_campaign',()=>reader.readInsights({...range,level:'campaign',daily:true})),
      capture('entities_campaign',()=>reader.readAuditDetails('campaign')),
      capture('entities_adset',()=>reader.readAuditDetails('adset')),
      capture('activities',()=>reader.readActivityHistory(range)),
      capture('currentActivities',()=>reader.readActivityHistory(windowFor('hoy',now))),
      capture('rules',()=>reader.readAuditRules())
    ]);
    evidence.daily.campaign=evidence.daily_campaign;evidence.entities.campaign=evidence.entities_campaign;evidence.entities.adset=evidence.entities_adset;
    delete evidence.daily_campaign;delete evidence.entities_campaign;delete evidence.entities_adset;
    for(const key of ['orders','operations','hourlyTraffic','rankings']){evidence[key]=null;sources[key]={status:'UNAVAILABLE',code:'NOT_REQUESTED_FOR_BUDGET_GUARDS'};}
    return evidence;
  }
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
