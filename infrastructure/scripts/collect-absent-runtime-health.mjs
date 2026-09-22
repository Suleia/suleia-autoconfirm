const components=[];
for(const [service,port] of [['api',3200],['mcp-server',3100],['ingestion-worker',3302]]){
 const checked_at=new Date().toISOString();let evidence;
 try{
  const r=await fetch(`http://${service}:${port}/health`,{signal:AbortSignal.timeout(8000)}),b=await r.json();
  evidence={status:r.status,ok:b.ok===true,last_error:b.last_error||null,last_sync_ok:b.last_sync_ok??null,first_cycle_complete:b.first_cycle_complete??null,running:b.running??null,absent_shadow:b.absent_shadow||null};
 }catch{evidence={status:null,ok:false,last_error:'HEALTH_READ_FAILED'};}
 components.push({service,checked_at,health_status:evidence.status===200?'HEALTHY':'UNHEALTHY',reason:evidence.last_error||`HTTP_${evidence.status}`,last_completed_cycle_at:evidence.absent_shadow?.last_completed_cycle_at||null,evidence});
}
console.log(JSON.stringify({schema_version:'suleia-functional-health-v1',checked_at:new Date().toISOString(),components}));
