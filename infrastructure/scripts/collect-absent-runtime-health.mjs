const components=[];
for(const [service,port] of [['api',3200],['mcp-server',3100],['ingestion-worker',3302],['recipient-absent-live-controller',3310]]){
 const checked_at=new Date().toISOString();let evidence;
 try{
  const r=await fetch(`http://${service}:${port}/health`,{signal:AbortSignal.timeout(8000)}),b=await r.json();
  evidence={status:r.status,ok:b.ok===true,last_error:b.last_error||null,last_sync_ok:b.last_sync_ok??null,first_cycle_complete:b.first_cycle_complete??null,running:b.running??null,absent_shadow:b.absent_shadow||null,...(service==='recipient-absent-live-controller'?{observer:b.observer||null,notification:b.notification||null,resolution:b.resolution||null,counts:b.counts||null}:{})};
 }catch{evidence={status:null,ok:false,last_error:'HEALTH_READ_FAILED'};}
 components.push({service,checked_at,health_status:evidence.status===200?'HEALTHY':'UNHEALTHY',reason:evidence.last_error||`HTTP_${evidence.status}`,last_completed_cycle_at:evidence.observer?.last_completed_at||evidence.absent_shadow?.last_completed_cycle_at||null,evidence});
}
// Reuse this collector's existing timer; no new scheduler or ingestion changes.
try{
 const {ShadowRepository}=await import('./packages/suleia-operations-mcp/src/shadow/repository.mjs');
 const {absentOrdersPollAlert}=await import('./infrastructure/scripts/absent-orders-alert.mjs');
 const db=new ShadowRepository(process.env.OPERATIONS_DATABASE_URL);
 try{const rows=(await db.pool.query('SELECT connector,last_success_at,last_failure_at,pagination_complete FROM read_models.operations_connector_health')).rows;
   const alert=absentOrdersPollAlert(rows);components.push({service:'dropea-orders-poll',checked_at:new Date().toISOString(),...alert});
 }finally{await db.close();}
}catch{components.push({service:'dropea-orders-poll',checked_at:new Date().toISOString(),health_status:'UNHEALTHY',reason:'ORDERS_POLL_HEALTH_UNAVAILABLE'});}
console.log(JSON.stringify({schema_version:'suleia-functional-health-v1',checked_at:new Date().toISOString(),components}));
