const AdsReportClient=(()=>{
 const descriptions={META_RATE_LIMITED:'Meta ha limitado las consultas de esta cuenta. Se respeta el plazo de espera antes de reintentar; no se omiten las comprobaciones de calidad.',META_HTTP_400:'Meta ha rechazado la consulta. Revisar los códigos técnicos, campos o permisos sin repetirla automáticamente.',ADS_DATABASE_UNAVAILABLE:'La base de datos de informes o historial no está disponible o no permite esta lectura. No se han cambiado los permisos.',ADS_REVIEW_CONTRACT_MISMATCH:'Las versiones del panel y de la API no coinciden. Debe completarse o revertirse el despliegue antes de mostrar auditorías.',ADS_REPORT_PREPARING:'La primera lectura paginada de Meta sigue en curso. Se reutiliza esa misma consulta.',ADS_REPORT_BUSY:'Hay otras lecturas en curso; esta consulta espera su turno.',META_HTTP_401:'Meta ha rechazado la credencial de lectura. Se necesita revisar la conexión.',META_HTTP_403:'Meta no permite consultar estos datos con los permisos actuales.',META_HTTP_429:'Meta ha limitado temporalmente las consultas.',META_TIMEOUT:'Meta ha superado el tiempo de respuesta.',META_SOURCE_UNAVAILABLE:'La fuente no ha completado una lectura verificable.',INSIGHTS_IDENTITY_INVALID:'La respuesta no supera la validación de fechas o identidad.',CONTRACT_MISMATCH:'La respuesta utiliza un contrato de métricas incompatible.'};
 const date=v=>v?new Date(v).toLocaleString('es-ES',{timeZone:'Europe/Madrid'}):'Todavía no disponible';
 function status(root,d={},retry){
  const box=document.createElement('section');box.className='ai-card ads-data-status';box.dataset.state=d.state||'FAILED';box.setAttribute('role','status');box.setAttribute('aria-live','polite');
  const add=(tag,text,cls)=>{const e=document.createElement(tag);e.textContent=text;if(cls)e.className=cls;box.append(e);return e;};
  add('strong',d.state==='PREPARING'?'Actualizando datos de Meta…':'Lectura pendiente de recuperar');add('p',descriptions[d.code]||'Se conserva la evidencia disponible. La consulta no ha terminado con datos actuales verificados.');
  const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Ver diagnóstico técnico';details.append(summary);
  for(const[label,value]of [['Fuente',d.source||'API operativa / Meta'],['Estado',d.connection||'Sin lectura actual'],['Última lectura válida',date(d.lastValidAt)],['Diagnóstico',d.code||'ADS_READ_FAILED'],['Código proveedor',d.providerCode??'No disponible'],['Subcódigo proveedor',d.providerSubcode??'No disponible'],['Identificador',d.id||'Sin identificador'],['Comprobación',date(d.checkedAt||new Date().toISOString())]]){const p=document.createElement('p');p.textContent=`${label}: ${value}`;details.append(p);}box.append(details);
  if(retry){const b=add('button','Reintentar lectura','ai-secondary');b.type='button';b.addEventListener('click',retry);}
  root.querySelector('.ads-data-status')?.remove();
  if(root.querySelector('.rv-hero:not(.gi-placeholder),.gi-kpis,.gi-drawer-hero'))root.prepend(box);
  else{root.replaceChildren(box);if(root.id==='ads-view'){const head=document.createElement('header'),title=document.createElement('h2');head.className='rv-hero gi-placeholder';title.textContent='Ads Intelligence';head.append(title);root.prepend(head);}const grid=document.createElement('div');grid.className='gi-skeleton-grid'+(d.state==='PREPARING'?'':' stopped');grid.setAttribute('aria-hidden','true');for(let i=0;i<4;i++){const cell=document.createElement('div');cell.className='gi-skeleton';grid.append(cell);}root.append(grid);}
 }
 async function load(path,{signal,onStatus,onProgress,maxAttempts=8,deadlineMs=25000}={}){
  let url=path,last=null;const started=Date.now();
  for(let attempt=0;attempt<maxAttempts;attempt++){
   if(signal?.aborted)throw new DOMException('Lectura cancelada','AbortError');
   let delay=2;const request=new AbortController(),abort=()=>request.abort(),timer=setTimeout(()=>request.abort(),Math.min(12000,Math.max(1,deadlineMs-Date.now()+started)));signal?.addEventListener('abort',abort,{once:true});
   try{const value=await api(url,{signal:request.signal});if(!value?.progress?.pending)return value;last=value;onProgress?.(value);delay=1;}catch(error){
    if(error.name==='AbortError'){if(signal?.aborted)throw error;error=Object.assign(Error('META_TIMEOUT'),{diagnostic:{code:'META_TIMEOUT',state:'FAILED',retryable:false}});}
    const d=error.diagnostic||{code:error.status===429?'META_HTTP_429':'ADS_READ_FAILED',source:'OPERATIONS_API',state:'FAILED',checkedAt:new Date().toISOString(),retryable:error.status===429,retryAfterSeconds:error.retryAfterSeconds||2};
    onStatus?.(d);
    if(d.retryable!==true||attempt===maxAttempts-1||d.state!=='PREPARING'){if(last)return {...last,clientWaitExpired:true};throw error;}
    const u=new URL(url,location.origin);u.searchParams.delete('force');url=u.pathname+u.search;
    delay=Math.max(1,d.retryAfterSeconds||2);
   }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
   if(Date.now()-started+delay*1000>=deadlineMs||attempt===maxAttempts-1){if(last)return {...last,clientWaitExpired:true};const e=Error('META_TIMEOUT');e.diagnostic={code:'META_TIMEOUT',state:'FAILED',retryable:false};throw e;}
   await new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(new DOMException('Lectura cancelada','AbortError'));};const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},delay*1000);signal?.addEventListener('abort',abort,{once:true});});
  }
 }
 return {load,status};
})();
