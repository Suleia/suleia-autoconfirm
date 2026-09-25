export function createAbsentObserverHealth({now=()=>new Date()}={}) {
  const state={last_started_at:null,last_completed_at:null,last_error:null,running:false};
  return {
    start(){state.running=true;state.last_started_at=new Date(now()).toISOString();},
    finish(result){state.running=false;if(result?.deferred)return;state.last_completed_at=new Date(now()).toISOString();state.last_error=result?.failed?'OBSERVER_PROVIDER_READ_FAILED':null;},
    fail(){state.running=false;state.last_error='OBSERVER_CYCLE_FAILED';},
    snapshot(){const lag=state.last_completed_at?Math.max(0,(+new Date(now())-Date.parse(state.last_completed_at))/1000):null;
      return {...state,lag_seconds:lag,healthy:lag!==null && lag<=300 && !state.last_error};}
  };
}

export async function readAbsentControllerHealth(pool,observer){
  const n=(await pool.query('SELECT status,automation_live,native_send_enabled,canary_issue_id,circuit_breaker_reason FROM operations.recipient_absent_native_control')).rows[0];
  const r=(await pool.query('SELECT status,circuit_breaker_reason FROM operations.recipient_absent_resolution_control')).rows[0];
  const counts=(await pool.query(`SELECT
    (SELECT count(*)::int FROM operations.recipient_absent_native_notifications) reservations,
    (SELECT count(*)::int FROM operations.recipient_absent_native_notifications WHERE status='VERIFIED') notifications,
    (SELECT count(*)::int FROM operations.recipient_absent_native_timers) timers,
    (SELECT count(*)::int FROM operations.recipient_absent_resolutions) resolutions,
    (SELECT coalesce(sum(jsonb_array_length(coalesce(outcome->'observed_callbacks','[]'::jsonb))),0)::int FROM operations.recipient_absent_native_notifications) callbacks`)).rows[0];
  const observed=observer.snapshot();
  return {ok:observed.healthy,checked_at:new Date().toISOString(),observer:observed,
    notification:{state:n?.status,enabled:n?.automation_live===true && n?.native_send_enabled===true,canary_used:Boolean(n?.canary_issue_id),breaker:n?.circuit_breaker_reason||null},
    resolution:{state:r?.status,breaker:r?.circuit_breaker_reason||null},counts};
}
