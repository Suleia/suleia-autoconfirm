import {evaluateSourceFreshness} from '../../packages/platform-core/src/operational-truth/freshness.mjs';
export function absentOrdersPollAlert(rows,now=new Date()){
  const orders=rows.filter(r=>/dropea/i.test(r.connector) && /order/i.test(r.connector));
  const sources=orders.map(r=>{
    const f=evaluateSourceFreshness({source:r.connector,last_successful_sync_at:r.last_success_at,
      last_failure_at:r.last_failure_at,sync_complete:r.pagination_complete},{now});
    return {connector:r.connector,connector_poll_freshness:f.connector_poll_freshness,poll_age_seconds:f.poll_age_seconds,
      alert:f.connector_poll_freshness!=='FRESH' && (f.poll_age_seconds===null || f.poll_age_seconds>1200)};
  });
  return {health_status:sources.length && sources.every(s=>!s.alert)?'HEALTHY':'UNHEALTHY',
    reason:sources.length && sources.every(s=>!s.alert)?'ORDERS_POLL_WITHIN_OPERATIONAL_WINDOW':'ORDERS_POLL_NOT_FRESH_OVER_20_MINUTES',sources};
}
