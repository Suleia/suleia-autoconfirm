import {chromium} from 'playwright-core';
import fs from 'node:fs/promises';
import {runtimeReadiness} from './runtime-state.mjs';
import {startSchedule,CYCLE_WATCHDOG_MS} from './schedule.mjs';
let schedule=null;

// Dedicated server profile. Never import cookies from the operator's browser.
const context=await chromium.launchPersistentContext('/state/profile',{
 headless:false,chromiumSandbox:true,viewport:{width:1600,height:1000},
 locale:'es-ES',timezoneId:'Europe/Madrid',acceptDownloads:false,
 args:['--disable-dev-shm-usage','--no-first-run']
});
context.setDefaultTimeout(15000);
// Persist only this owner-authorized dedicated profile, never desktop sessions.
const sessionOrigins=new Set(['https://app.chatby.io','https://v2.app.dropea.com']);
try{
 const saved=JSON.parse(await fs.readFile('/state/dedicated-session.json','utf8'));
 const cookies=(saved.cookies||[]).filter(c=>/(^|\.)(chatby\.io|dropea\.com)$/.test(c.domain.replace(/^\./,''))&&(c.expires===-1||c.expires>Date.now()/1000));
 await context.addCookies(cookies);
 await context.addInitScript(sessions=>{
  const saved=sessions[location.origin];
  if(saved&&sessionStorage.length===0)for(const [k,v] of Object.entries(saved))sessionStorage.setItem(k,v);
 },Object.fromEntries(Object.entries(saved.sessions||{}).filter(([origin])=>sessionOrigins.has(origin))));
}catch{}
async function writeSession(){
 const sessions={};
 for(const page of context.pages()){
  const origin=new URL(page.url()).origin;
  if(sessionOrigins.has(origin))sessions[origin]=await page.evaluate(()=>Object.fromEntries(Object.entries(sessionStorage)));
 }
 const cookies=(await context.cookies()).filter(c=>/(^|\.)(chatby\.io|dropea\.com)$/.test(c.domain.replace(/^\./,'')));
 await fs.writeFile('/state/dedicated-session.tmp',JSON.stringify({cookies,sessions}),{mode:0o600});
 await fs.rename('/state/dedicated-session.tmp','/state/dedicated-session.json');
}
let persisting;
function persistSession(){
 if(!persisting)persisting=writeSession().finally(()=>{persisting=null;});
 return persisting;
}
let closing=false;
context.on('close',()=>{if(!closing){console.error('DEDICATED_BROWSER_CLOSED');process.exit(1);}});
async function stop(){
 if(closing)return;closing=true;
 await Promise.race([persistSession().catch(()=>{}),new Promise(r=>setTimeout(r,4000))]);
 await Promise.race([context.close().catch(()=>{}),new Promise(r=>setTimeout(r,10000))]);
 process.exit(0);
}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
const fixture=await context.newPage();
await fixture.setContent('<html lang="es"><body><h1>Suleia: navegador del VPS</h1><p>Prueba técnica de captura. Sin datos de clientes.</p></body></html>');
await fixture.bringToFront();
let captureSelfTest=false;
for(let attempt=0;attempt<3&&!captureSelfTest;attempt++){
 try{await fixture.screenshot({path:'/evidence/runtime-selftest.png',timeout:10000});captureSelfTest=true;}
 catch{await new Promise(r=>setTimeout(r,500));}
}
await fixture.close();
const targets=[
 ['chatby','https://app.chatby.io/settings/accounts/298087#/chat/f295175'],
 ['dropea','https://v2.app.dropea.com/es/dropshipper/incidences']
];
for(const [,url] of targets){
 if(!context.pages().some(p=>p.url().startsWith(new URL(url).origin))){
  const page=await context.newPage();
  try{await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});}catch{/* report without provider content */}
 }
}
async function status(){
 let control={mode:'OBSERVE_ONLY'};
 try{control=JSON.parse(await fs.readFile('/state/retry-control.json','utf8'));}catch{}
 let reconcile=false;try{await fs.access('/state/retry-reconcile.json');reconcile=true;}catch{}
 try{await fs.access('/state/delivery-reply-inflight.json');reconcile=true;}catch{}
 const sites={};
 for(const [name,url] of targets){
  const page=context.pages().find(p=>p.url().startsWith(new URL(url).origin));
  let loggedIn=false;
  try{
   loggedIn=name==='chatby'?await page?.getByPlaceholder('Buscar',{exact:true}).filter({visible:true}).isVisible():
    Boolean(page&&!new URL(page.url()).pathname.includes('login')&&(await page.locator('body').innerText()).replace(/\s/g,'').includes('ID17431'));
  }catch{}
  sites[name]={session:loggedIn?'UI_PRESENT_REQUIRES_IDENTITY_VERIFICATION':'LOGIN_OR_VERIFICATION_REQUIRED'};
 }
 let cycle=null;try{cycle=JSON.parse(await fs.readFile('/state/observer-health.json','utf8'));}catch{}
 const value={at:new Date().toISOString(),browser:'RUNNING',captureSelfTest,
  ...runtimeReadiness({control,sites,cycle,reconcile}),mode:reconcile?'RECONCILE':control.mode,sites,schedule:schedule?.state||null};
 await fs.writeFile('/state/health.tmp',JSON.stringify(value));
 await fs.rename('/state/health.tmp','/state/health.json');
}
await status();
if(process.env.INCIDENT_SESSION_PROBE==='true'){
 try{
  const {probeSessions}=await import('./probe.mjs');
  const result=await probeSessions(context);
  await fs.writeFile('/state/session-probe-status.json',JSON.stringify({at:new Date().toISOString(),result}));
 }catch{await fs.writeFile('/state/session-probe-status.json',JSON.stringify({at:new Date().toISOString(),error:'SESSION_PROBE_FAILED'}));}
}
setInterval(()=>status().catch(()=>{}),30000);
setInterval(()=>persistSession().catch(()=>{}),15000);
let observing=false,probing=false;
async function observe(){
 if(observing||probing||closing)return;
 observing=true;
 const startedAt=new Date().toISOString();
 // A stuck cycle must not silently disable every later timer tick. The durable
 // pre-save journal makes a restart reconcile rather than replay a write.
 const watchdog=setTimeout(()=>{console.error('CYCLE_WATCHDOG_RESTART');void stop();},CYCLE_WATCHDOG_MS);
 try{
  await fs.writeFile('/state/cycle-progress.json',JSON.stringify({startedAt,state:'RUNNING'}),{mode:0o600});
  await fs.access('/state/provider-env.json');
  const {runVpsRetryCycle}=await import('./runtime.mjs');
  const result=await runVpsRetryCycle(context);
  try{result.deliveryReplies=await (await import('./delivery-reply-runtime.mjs')).runDeliveryReplyCycle(context,{deadlineAt:Date.parse(startedAt)+20*60000});}
  catch{result.deliveryReplies={status:'DELIVERY_REPLY_CYCLE_REQUIRES_REVIEW'};}
  try{result.addressDetailsReconciliation=await (await import('./reconcile-details.mjs')).reconcileAddressDetails();}
  catch{result.addressDetailsReconciliationError='RECEIPT_RECONCILIATION_UNAVAILABLE';}
  try{result.feedback=await (await import('./feedback.mjs')).followRetryOutcomes();}
  catch{result.feedbackError='FOLLOWUP_UNAVAILABLE';}
  try{result.acceptedDiscountSupport=await (await import('./support-runtime.mjs')).runVpsSupportCycle(context);}
  catch{result.acceptedDiscountSupport={status:'SUPPORT_CYCLE_FAILED'};}
  result.startedAt=startedAt;result.completedAt=new Date().toISOString();
  await fs.writeFile('/state/observer-health.json',JSON.stringify(result));
  let history=[];try{history=JSON.parse(await fs.readFile('/state/cycle-history.json','utf8'));}catch{}
  history.push(result);await fs.writeFile('/state/cycle-history.json',JSON.stringify(history.slice(-200)),{mode:0o600});
 }catch{await fs.writeFile('/state/observer-health.json',JSON.stringify({at:new Date().toISOString(),startedAt,completedAt:new Date().toISOString(),mode:'OBSERVE_ONLY',writes:0,error:'OBSERVATION_UNAVAILABLE'}));}
 finally{clearTimeout(watchdog);observing=false;await fs.writeFile('/state/cycle-progress.json',JSON.stringify({startedAt,completedAt:new Date().toISOString(),state:'IDLE'}),{mode:0o600});}
}
schedule=startSchedule(observe,{onError:()=>{console.error('CYCLE_SCHEDULER_FAILED');void stop();}});
// Private, typed, read-only probe queue; no evaluation or arbitrary URLs.
setInterval(async()=>{
 if(probing||observing||closing)return;
 probing=true;
 try{
  try{
   await fs.access('/state/probe-request.json');
   await fs.rename('/state/probe-request.json','/state/probe-processing.json');
   const version=(await fs.stat(new URL('./probe.mjs',import.meta.url))).mtimeMs;
   const {probeSessions}=await import(`./probe.mjs?v=${version}`);
   const result=await probeSessions(context);
   await fs.writeFile('/state/session-probe-status.json',JSON.stringify({at:new Date().toISOString(),result}));
  }catch{}
  const input=JSON.parse(await fs.readFile('/state/capture-request.json','utf8'));
  await fs.rename('/state/capture-request.json','/state/capture-processing.json');
  try{
   const version=(await fs.stat(new URL('./capture.mjs',import.meta.url))).mtimeMs;
   const {captureRetryEvidence}=await import(`./capture.mjs?v=${version}`);
   const proof=await captureRetryEvidence(context,input);
   await fs.writeFile('/state/capture-result.json',JSON.stringify({at:new Date().toISOString(),proof}));
  }catch(error){await fs.writeFile('/state/capture-result.json',JSON.stringify({at:new Date().toISOString(),error:error.message}));}
 }catch{}finally{probing=false;}
},5000);
