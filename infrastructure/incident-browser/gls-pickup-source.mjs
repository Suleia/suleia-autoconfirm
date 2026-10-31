import {createHash} from 'node:crypto';
export const GLS_DIRECTORY='https://gls-group.com/ES/es/buscador-codigos-postales/';
export const GLS_FORM='https://www.gls-spain.es/es/iframe-buscador-codigos-postales-cloned/';
const text=s=>String(s||'').replace(/<[^>]*>/g,' ').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#0?39;/g,"'").replace(/\s+/g,' ').trim();
export function glsRetryUntil(value,now=Date.now()){
 const seconds=Number(value);return value!==null&&String(value).trim()!==''&&Number.isFinite(seconds)&&seconds>=0?now+seconds*1000:Math.max(now+60000,Date.parse(value)||0);
}
export const glsDirectAgencyPhone=v=>/^\d{9}$/.test(String(v||'').replace(/\D/g,'').replace(/^34(?=\d{9}$)/,''))&&!['910806229'].includes(String(v||'').replace(/\D/g,'').replace(/^34(?=\d{9}$)/,''));
export const glsOpeningHoursVerified=v=>/(?:^|[^\d])(?:[01]?\d|2[0-3])(?::[0-5]\d)?\s*(?:a|hasta|[-–])\s*(?:[01]?\d|2[0-3])(?::[0-5]\d)?(?!\d)/i.test(String(v||''));
export function parseGlsDirectory(html,postal,now=Date.now()){
 if(!/^(?:0[1-9]|[1-4]\d|5[0-2])\d{3}$/.test(postal))throw Error('INVALID_SHIPMENT_POSTAL_CODE');
 const section=String(html).split('id="pc-result"')[1]?.split('</code>')[0];
 if(!section||!/<h5>\s*Agencia GLS\s*<\/h5>/i.test(section))throw Error('GLS_DIRECTORY_SCHEMA_OR_AGENCY_MISSING');
 if([...section.matchAll(/<h5>\s*Agencia GLS\s*<\/h5>/gi)].length!==1)throw Error('GLS_DIRECTORY_AGENCY_AMBIGUOUS');
 const fields=Object.fromEntries([...section.matchAll(/<p>\s*<strong>([^<]+):<\/strong>([\s\S]*?)<\/p>/g)].map(m=>[text(m[1]),text(m[2])]));
 const agency={postal_code_searched:postal,agency_code:fields['Código'],agency_name:fields.Nombre,address_line:fields['Dirección'],postal_code:fields['Código postal'],city:fields.Ciudad,province:fields.Provincia,phone:fields['Teléfono'],opening_hours:fields['Horario de apertura'],source_url:GLS_FORM,source_type:'GLS_OFFICIAL_POSTAL_FORM',retrieved_at:new Date(now).toISOString(),validated_at:new Date(now).toISOString(),validation_status:'VERIFIED_DIRECTORY_ONLY'};
 if(!glsDirectAgencyPhone(agency.phone))throw Error('DIRECT_AGENCY_PHONE_NOT_VERIFIED');
 if(Object.values(agency).some(v=>!v)||!/^\d{1,8}$/.test(agency.agency_code)||!/^\d{5}$/.test(agency.postal_code)||!glsOpeningHoursVerified(agency.opening_hours))throw Error('MISSING_VERIFIED_AGENCY_DATA');
 return agency;
}
export function createGlsDirectory({fetchImpl=fetch,cache={},now=Date.now,ttlMs=24*3600000}={}){
 const pending=new Map();ttlMs=Math.min(Math.max(ttlMs,60000),24*3600000);
 return {cache,async lookup(postal,{agencyCode=null,force=false}={}){
  if(now()<Number(cache.__directory_retry_until||0))throw Error('GLS_RATE_LIMITED');
  const key=`ES:${postal}`;
  for(const [k,a]of Object.entries(cache))if(k.startsWith(key+':')&&(!glsDirectAgencyPhone(a.phone)||agencyCode&&a.agency_code!==agencyCode))delete cache[k];
  const cached=Object.entries(cache).find(([k,a])=>k.startsWith(key+':')&&(!agencyCode||a.agency_code===agencyCode)&&now()-Date.parse(a.retrieved_at)>=0&&now()-Date.parse(a.retrieved_at)<ttlMs)?.[1];
  if(cached&&!force)return cached;if(pending.has(key))return pending.get(key);
  const job=(async()=>{
   // The official entry point must still link this exact public form. Never
   // guess private APIs, generate signatures or bypass provider challenges.
   const entry=await fetchImpl(GLS_DIRECTORY,{signal:AbortSignal.timeout(8000)});
   if(entry.status===429){cache.__directory_retry_until=glsRetryUntil(entry.headers?.get('retry-after'),now());throw Error('GLS_RATE_LIMITED');}
   if(!entry.ok||!(await entry.text()).includes(GLS_FORM))throw Error('GLS_DIRECTORY_IFRAME_CHANGED');
   const r=await fetchImpl(GLS_FORM,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({postalcode:postal}),signal:AbortSignal.timeout(8000)});
   if(r.status===429){cache.__directory_retry_until=glsRetryUntil(r.headers?.get('retry-after'),now());throw Error('GLS_RATE_LIMITED');}
   if(!r.ok)throw Error('GLS_DIRECTORY_UNAVAILABLE');
   const a=parseGlsDirectory(await r.text(),postal,now());cache[`${key}:${a.agency_code}`]=a;return a;
  })();pending.set(key,job);try{return await job;}finally{pending.delete(key);}
 }};
}
export function validatedTrackingUrl(url,tracking,postal){
 const u=new URL(url);if(u.origin!=='https://mygls.gls-spain.es'||u.search||u.hash||!/^\d+$/.test(String(tracking))||u.pathname!==`/e/${tracking}/${postal}/es`)throw Error('GLS_TRACKING_IDENTITY_OR_DESTINATION_CONFLICT');return u.href;
}
// Only exact visible operational labels establish state. A pickup button or
// a request in transport history is never evidence of physical availability.
export function parseGlsTracking(visible,{tracking,postal,url,now=Date.now()}={}){
 validatedTrackingUrl(url,tracking,postal);
 const lines=String(visible).split(/[\r\n]+/).map(s=>s.trim()).filter(Boolean);
 const field=name=>{const i=lines.findIndex(s=>s===name||s.startsWith(name+':'));return i<0?null:lines[i]===name?lines[i+1]:lines[i].slice(name.length+1).trim();};
 const current=field('Estado del envío');
 const states={'Disponible para recoger':'READY','Listo para recoger en agencia':'READY','Entregado':'DELIVERED','Recogido':'COLLECTED','Devuelto al remitente':'RETURNED','En tránsito':'IN_TRANSIT','En reparto':'IN_TRANSIT','Cancelado':'CANCELLED'};
 const result={verified:true,tracking_id:String(tracking),postal_code:field('Código postal de destino'),state:states[current]||'UNVERIFIED',agency_code:field('Código de agencia'),agency_name:field('Agencia GLS'),source_url:url,source_type:'GLS_OFFICIAL_TRACKING_VISIBLE',observed_at:new Date(now).toISOString(),availability_at:field('Disponible desde'),cod_cents:null};
 const cod=field('Importe pendiente de pago');if(cod&&/^\d+(?:[.,]\d{2})\s*€$/.test(cod))result.cod_cents=Math.round(Number(cod.replace('€','').replace(',','.').trim())*100);
 const agency={postal_code_searched:postal,agency_code:result.agency_code,agency_name:result.agency_name,address_line:field('Dirección de agencia'),postal_code:field('Código postal de agencia'),city:field('Localidad de agencia'),province:field('Provincia de agencia'),phone:field('Teléfono de agencia'),opening_hours:field('Horario de recogida'),source_url:url,source_type:'GLS_OFFICIAL_TRACKING_VISIBLE',retrieved_at:new Date(now).toISOString(),validated_at:new Date(now).toISOString(),validation_status:'VERIFIED_TRACKING_ONLY'};
 result.agency_address_line=agency.address_line;result.agency_postal_code=agency.postal_code;
 if(Object.values(agency).every(Boolean)&&/^\d{5}$/.test(agency.postal_code)&&glsDirectAgencyPhone(agency.phone)&&glsOpeningHoursVerified(agency.opening_hours))result.agency=agency;
 if(result.state==='READY'&&result.agency_code&&Number.isFinite(Date.parse(result.availability_at))){
  result.episode_id=createHash('sha256').update(JSON.stringify([tracking,result.agency_code,new Date(result.availability_at).toISOString()])).digest('hex').slice(0,32);
 }
 result.verified=result.postal_code===postal&&result.state!=='UNVERIFIED';return result;
}
export async function readGlsTracking(context,input,{saveDiagnostic=async()=>{},retryUntil=0,onRateLimit=async()=>{}}={}){
 if(Date.now()<retryUntil)throw Error('GLS_TRACKING_RATE_LIMITED');
 const url=validatedTrackingUrl(input.url,input.tracking,input.postal);
 const page=await context.newPage(),providerStatuses=[],requestFailures=[],rateJobs=[];let limited=false;
 page.on('requestfailed',request=>{if(requestFailures.length<20)requestFailures.push(request.failure()?.errorText||'REQUEST_FAILED');});
 page.on('response',response=>{try{
  const host=new URL(response.url()).hostname;
  if(/(?:^|\.)(?:gls-spain\.es|gls-group\.com|gls-group\.eu)$/.test(host)&&response.status()>=400){
   if(providerStatuses.length<20)providerStatuses.push({host,status:response.status()});
   if(response.status()===429&&!limited){limited=true;const job=(async()=>{try{await onRateLimit(glsRetryUntil(response.headers()['retry-after']));}finally{await page.close().catch(()=>{});}})();rateJobs.push(job);}
  }
 }catch{/* Diagnostics cannot affect the existing worker. */}});
 try{
  const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:15000});
  if(response?.status()===429)throw Error('GLS_TRACKING_RATE_LIMITED');
  if(new URL(page.url()).origin!==new URL(url).origin)throw Error('GLS_TRACKING_ORIGIN_CHANGED');
  const necessary=page.getByRole('button',{name:'Solo usar cookies necesarias',exact:true});
  try{await necessary.waitFor({state:'visible',timeout:2000});await necessary.click({timeout:2000});}catch{
   try{await page.getByText('Solo usar cookies necesarias',{exact:true}).click({timeout:2000});}catch{}
  }
  const accessibility=page.locator('flt-semantics-placeholder[aria-label="Enable accessibility"]');
  try{await accessibility.waitFor({state:'attached',timeout:8000});await accessibility.evaluate(element=>element.click());}catch{}
  try{await page.locator('flt-semantics[aria-label]').first().waitFor({state:'attached',timeout:8000});}catch{}
  // Header semantics appear before the shipment query finishes. Reading that
  // first frame would mistake the actual loading screen for missing data.
  try{await page.locator('flt-semantics[aria-label^="Cargando"]').waitFor({state:'hidden',timeout:25000});}catch{}
  const body=await page.locator('body').innerText({timeout:2000});
  // Flutter paints text on a canvas; its live accessibility semantics carry
  // the same rendered labels. Read these labels, never provider internals.
  const semantics=await page.locator('flt-semantics[aria-label]').evaluateAll(nodes=>nodes.filter(n=>n.getAttribute('aria-hidden')!=='true').map(n=>n.getAttribute('aria-label')).filter(Boolean));
  const visible=[body,...semantics].join('\n');
  const result=parseGlsTracking(visible,{...input,url});
  const loading=await page.locator('flt-semantics[aria-label^="Cargando"]').count();
  if(!result.verified)result.unavailable_reason=providerStatuses.some(s=>[401,403].includes(s.status))?'GLS_TRACKING_PROVIDER_DENIED':loading?'GLS_TRACKING_STILL_LOADING':'OFFICIAL_TRACKING_DATA_NOT_VERIFIABLE';
  if(!result.verified||result.state==='READY'&&(!result.episode_id||!result.cod_cents))await saveDiagnostic({visible,at:new Date().toISOString(),tracking:input.tracking,ui:{semantics:semantics.length,loading,cookieControl:await page.getByText('Solo usar cookies necesarias',{exact:true}).count(),providerStatuses,requestFailures}});
  return result;
 }catch(error){if(limited)throw Error('GLS_TRACKING_RATE_LIMITED');throw error;}
 finally{await Promise.allSettled(rateJobs);await page.close().catch(()=>{});}
}

export async function collectGlsPickupIncidents({deadlineAt=Date.now()+60000}={}){
 const {loadDropeaV2IncidentStoreConfigs,createDropeaV2IncidentClient,normalizeDropeaV2Incident}=await import('../../autoconfirm/src/clients/dropea-v2-incidents.mjs');
 const result=[];
 for(const config of loadDropeaV2IncidentStoreConfigs()){
  const fetchImpl=(url,options={})=>{if(Date.now()>=deadlineAt)throw Error('PICKUP_NATIVE_READ_BUDGET_EXHAUSTED');return fetch(url,{...options,signal:AbortSignal.any([...(options.signal?[options.signal]:[]),AbortSignal.timeout(Math.max(1,Math.min(8000,deadlineAt-Date.now())))])});};
  const client=createDropeaV2IncidentClient({token:config.token,market:config.market,maxReadRetries:1,timeoutMs:8000,fetchImpl});
  const pending=await client.listAll('listIssues',{only_pending_to_resolve:true},{maxPages:30,maxRecords:3000,requestedLimit:100,pagePauseMs:0});
  for(const issue of pending.items||[]){
   if(issue.type!=='PICKUP_AT_AGENCY'||issue.carrier!=='GLS'||issue.is_active!==true||!['PENDING','MANAGING_WITH_CLIENT'].includes(issue.status))continue;
   const order=(await client.request('getOrder',{id:Number(issue.order_id)}))?.data;
   if(String(order?.id)!==String(issue.order_id))throw Error('PICKUP_NATIVE_ORDER_IDENTITY_MISMATCH');
   const row=normalizeDropeaV2Incident(issue,order,{market:config.market});
   row.otherActiveIssue=pending.items.some(i=>String(i.order_id)===String(issue.order_id)&&String(i.id)!==String(issue.id)&&i.is_active===true&&['PENDING','MANAGING_WITH_CLIENT'].includes(i.status)&&i.type!=='PICKUP_AT_AGENCY');
   result.push(row);
  }
 }return result;
}
