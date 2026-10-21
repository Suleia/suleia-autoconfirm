import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
if(process.env.ADS_LOCAL_BROWSER_QA_AUTHORIZED!=='true')throw Error('Explicit local Ads-only browser QA authorization required');
const {chromium}=createRequire(import.meta.url)('playwright');
const snapshot=JSON.parse(await fs.readFile(process.env.ADS_QA_SNAPSHOT,'utf8'));
const folder=path.resolve(process.env.ADS_QA_OUTPUT),source=path.resolve('apps/review-panel');await fs.mkdir(folder,{recursive:true});
const errors=[],requests=[],blocked=[];
// Use an already-filtered private status snapshot, or an explicitly labeled fixture.
const realStatus=process.env.ADS_CC_STATUS_SNAPSHOT?JSON.parse(await fs.readFile(process.env.ADS_CC_STATUS_SNAPSHOT,'utf8')):null;
const status=realStatus||{version:2,mode:'SHADOW · PRUEBA LOCAL',languageModel:'NONE',metaWritesEnabled:false,notificationsEnabled:false,trendtrack:{connected:false,creditsConsumed:0},limits:{maxBudgetCents:10000,maxChangePercent:10},connections:[{source:'META · captura privada',status:'FRESH',observedAt:snapshot.observedAt}],proposals:[],latestBrief:{observedAt:snapshot.observedAt,priorities:[{evidence:'Bloque 2.0 de prueba: los indicadores Ads proceden de la captura privada.',action:'Activación productiva pendiente de aprobación.'}]}};
const bootstrap=`const state={config:{command_center_enabled:true}};const $=id=>document.getElementById(id);const node=(tag,cls='',text)=>{const e=document.createElement(tag);e.className=cls;if(text!==undefined)e.textContent=text;return e;};const money=n=>n===null?'N/D':new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(n);const date=t=>new Date(t).toLocaleString('es-ES');async function api(url){const r=await fetch(url);if(!r.ok)throw Error('LOCAL_TEST_ERROR');return(await r.json()).data;}$('app').hidden=false;$('app').dataset.view='ads';for(const id of ['summary','queue-card','recovery-center','incident-search-bar']){if($(id))$(id).hidden=true;}$('ads-view').hidden=false;AdsIntelligencePanel.load();`;
const server=http.createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://local');assert.equal(req.method,'GET');requests.push(u.pathname);
 if(u.pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({ok:true,data:u.pathname==='/api/operations/command-center'?status:snapshot}));}
 if(u.pathname==='/bootstrap.js'){res.setHeader('Content-Type','text/javascript');return res.end(bootstrap);}
 if(u.pathname==='/'){let html=await fs.readFile(path.join(source,'index.html'),'utf8');html=html.replace(/<script[^>]*src="(?!ads-intelligence-v3|command-center)[^"]+"[^>]*><\/script>/g,'').replace('</body>','<script src="/bootstrap.js" defer></script></body>');res.setHeader('Content-Type','text/html');return res.end(html);}
 const file=path.resolve(source,'.'+u.pathname);assert.ok(file.startsWith(source+path.sep));res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'text/javascript');res.end(await fs.readFile(file));
 }catch{res.statusCode=404;res.end('Local test route unavailable');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
let browser;
try{
 browser=await chromium.launch({executablePath:process.env.ADS_QA_BROWSER_PATH,headless:true,args:['--disable-background-networking','--no-first-run','--no-default-browser-check']});
 const context=await browser.newContext();await context.route('**/*',r=>{if(r.request().url().startsWith(base+'/'))return r.continue();blocked.push(r.request().url());return r.abort();});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 for(const [name,width,height]of[['desktop',1440,1050],['mobile',390,844]]){
  await page.setViewportSize({width,height});await page.goto(base);await page.getByRole('heading',{name:'Estado y decisiones del asistente'}).waitFor();await page.getByText(realStatus?'Solo lectura':'Solo lectura · PRUEBA LOCAL',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.equal(await page.locator('.cc-grid .cc-card').count(),4);
  await page.screenshot({path:path.join(folder,name+'.png'),fullPage:true});await page.locator('.cc-overview').screenshot({path:path.join(folder,name+'-command-center.png')});
  for(const b of await page.getByRole('button',{name:/Crear propuesta/}).all())assert.equal(await b.isDisabled(),Boolean(snapshot.reportReadOnly));
 }
 assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
 const statusData=realStatus?'PRODUCTION_READ_SNAPSHOT':'LOCAL_FIXTURE';
 await fs.writeFile(path.join(folder,'validation.json'),JSON.stringify({viewports:[[1440,1050],[390,844]],errors,externalRequests:blocked.length,requests,sqlWrites:0,metaWrites:0,telegramSends:0,statusData,adsDataObservedAt:snapshot.observedAt},null,2));
 console.log(JSON.stringify({visualQa:'PASS',viewports:[[1440,1050],[390,844]],errors:0,overflow:false,externalRequests:0,statusData}));
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
