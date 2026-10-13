import {chromium} from 'playwright-core';
import fs from 'node:fs/promises';

// Dedicated server profile. Never import cookies from the operator's browser.
const context=await chromium.launchPersistentContext('/state/profile',{
 headless:false,chromiumSandbox:true,viewport:{width:1600,height:1000},
 locale:'es-ES',timezoneId:'Europe/Madrid',acceptDownloads:false,
 args:['--disable-dev-shm-usage','--no-first-run']
});
const fixture=await context.newPage();
await fixture.setContent('<html lang="es"><body><h1>Suleia: navegador del VPS</h1><p>Prueba técnica de captura. Sin datos de clientes.</p></body></html>');
await fixture.screenshot({path:'/evidence/runtime-selftest.png'});
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
    await page?.getByText('Aportar solución',{exact:true}).count()>0;
  }catch{}
  sites[name]={session:loggedIn?'UI_PRESENT_REQUIRES_IDENTITY_VERIFICATION':'LOGIN_OR_VERIFICATION_REQUIRED'};
 }
 const value={at:new Date().toISOString(),browser:'RUNNING',captureSelfTest:true,
  executionEnabled:false,mode:'SESSION_SETUP_ONLY',sites};
 await fs.writeFile('/state/health.tmp',JSON.stringify(value));
 await fs.rename('/state/health.tmp','/state/health.json');
}
await status();
setInterval(()=>status().catch(()=>{}),30000);
let closing=false;
async function stop(){if(closing)return;closing=true;await context.close();process.exit(0);}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
