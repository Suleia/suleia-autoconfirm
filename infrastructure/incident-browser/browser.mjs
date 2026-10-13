import {chromium} from 'playwright-core';
import fs from 'node:fs/promises';

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
async function persistSession(){
 const sessions={};
 for(const page of context.pages()){
  const origin=new URL(page.url()).origin;
  if(sessionOrigins.has(origin))sessions[origin]=await page.evaluate(()=>Object.fromEntries(Object.entries(sessionStorage)));
 }
 const cookies=(await context.cookies()).filter(c=>/(^|\.)(chatby\.io|dropea\.com)$/.test(c.domain.replace(/^\./,'')));
 await fs.writeFile('/state/dedicated-session.tmp',JSON.stringify({cookies,sessions}),{mode:0o600});
 await fs.rename('/state/dedicated-session.tmp','/state/dedicated-session.json');
}
let closing=false;
context.on('close',()=>{if(!closing){console.error('DEDICATED_BROWSER_CLOSED');process.exit(1);}});
async function stop(){if(closing)return;closing=true;await persistSession().catch(()=>{});await context.close();process.exit(0);}
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
 const sites={};
 for(const [name,url] of targets){
  const page=context.pages().find(p=>p.url().startsWith(new URL(url).origin));
  let loggedIn=false;
  try{
   loggedIn=name==='chatby'?await page?.getByPlaceholder('Buscar',{exact:true}).isVisible():
    Boolean(page&&!new URL(page.url()).pathname.includes('login')&&(await page.locator('body').innerText()).replace(/\s/g,'').includes('ID17431'));
  }catch{}
  sites[name]={session:loggedIn?'UI_PRESENT_REQUIRES_IDENTITY_VERIFICATION':'LOGIN_OR_VERIFICATION_REQUIRED'};
 }
 const value={at:new Date().toISOString(),browser:'RUNNING',captureSelfTest,
  executionEnabled:false,mode:'SESSION_SETUP_ONLY',sites};
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
// Private, typed, read-only probe queue; no evaluation or arbitrary URLs.
let probing=false;
setInterval(async()=>{
 if(probing)return;
 probing=true;
 try{
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
