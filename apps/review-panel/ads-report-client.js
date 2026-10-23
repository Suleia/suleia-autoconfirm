const AdsReportClient=(()=>{
 const descriptions={META_RATE_LIMITED:'Meta ha limitado las consultas de esta cuenta (código 17). La lectura espera antes de reintentarse; no se omiten las comprobaciones de calidad.',META_HTTP_400:'Meta ha rechazado la consulta. Revisar los códigos técnicos, campos o permisos sin repetirla automáticamente.',ADS_DATABASE_UNAVAILABLE:'La base de datos de informes o historial no está disponible o no permite esta lectura. No se han cambiado los permisos.',ADS_REVIEW_CONTRACT_MISMATCH:'Las versiones del panel y de la API no coinciden. Debe completarse o revertirse el despliegue antes de mostrar auditorías.',ADS_REPORT_PREPARING:'La primera lectura paginada de Meta sigue en curso. Se reutiliza esa misma consulta.',ADS_REPORT_BUSY:'Hay otras lecturas en curso; esta consulta espera su turno.',META_HTTP_401:'Meta ha rechazado la credencial de lectura. Se necesita revisar la conexión.',META_HTTP_403:'Meta no permite consultar estos datos con los permisos actuales.',META_HTTP_429:'Meta ha limitado temporalmente las consultas.',META_TIMEOUT:'Meta ha superado el tiempo de respuesta.',META_SOURCE_UNAVAILABLE:'La fuente no ha completado una lectura verificable.',INSIGHTS_IDENTITY_INVALID:'La respuesta no supera la validación de fechas o identidad.',CONTRACT_MISMATCH:'La respuesta utiliza un contrato de métricas incompatible.'};
 const date=v=>v?new Date(v).toLocaleString('es-ES',{timeZone:'Europe/Madrid'}):'Todavía no disponible';
 function status(root,d={},retry){
  const box=document.createElement('section');box.className='ai-card ads-data-status';box.dataset.state=d.state||'FAILED';box.setAttribute('role','status');box.setAttribute('aria-live','polite');
  const add=(tag,text,cls)=>{const e=document.createElement(tag);e.textContent=text;if(cls)e.className=cls;box.append(e);return e;};
  add('span','CONEXIÓN Y CALIDAD DE DATOS','rv-eyebrow');add('h2',d.state==='PREPARING'?'Preparando la lectura de Meta':'No se ha podido completar la lectura');add('p',descriptions[d.code]||'La consulta no ha terminado con datos actuales verificados.');
  for(const[label,value]of [['Fuente',d.source||'API operativa / Meta'],['Estado',d.connection||'Sin lectura actual'],['Última lectura válida',date(d.lastValidAt)],['Diagnóstico',d.code||'ADS_READ_FAILED'],['Código proveedor',d.providerCode??'No disponible'],['Subcódigo proveedor',d.providerSubcode??'No disponible'],['Identificador',d.id||'Sin identificador'],['Comprobación',date(d.checkedAt||new Date().toISOString())],['Momento del fallo',d.failedAt?date(d.failedAt):'No se ha registrado un rechazo definitivo']])add('p',`${label}: ${value}`,'rv-detail');
  add('p','Las decisiones dependientes de datos actuales permanecen bloqueadas. No se presentan cifras antiguas como actuales.','ai-footnote');
  if(retry){const b=add('button','Reintentar','ai-primary');b.type='button';b.addEventListener('click',retry);}root.replaceChildren(box);
 }
 async function load(path,{signal,onStatus,maxAttempts=8}={}){
  let url=path;
  for(let attempt=0;attempt<maxAttempts;attempt++){
   if(signal?.aborted)throw new DOMException('Lectura cancelada','AbortError');
   try{return await api(url,{signal});}catch(error){
    if(error.name==='AbortError')throw error;
    const d=error.diagnostic||{code:error.status===429?'META_HTTP_429':'ADS_READ_FAILED',source:'OPERATIONS_API',state:'FAILED',checkedAt:new Date().toISOString(),retryable:error.status===429,retryAfterSeconds:error.retryAfterSeconds||2};
    onStatus?.(d);
    if(d.retryable!==true||attempt===maxAttempts-1)throw error;
    const u=new URL(url,location.origin);u.searchParams.delete('force');url=u.pathname+u.search;
    await new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(new DOMException('Lectura cancelada','AbortError'));};const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},Math.min(60,Math.max(1,d.retryAfterSeconds||2))*1000);signal?.addEventListener('abort',abort,{once:true});});
   }
  }
 }
 return {load,status};
})();
