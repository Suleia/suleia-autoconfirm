import fs from 'node:fs/promises';
import {ensureChatbyView} from './chatby-view.mjs';
import {clearIncidentDateFilter} from './incident-view.mjs';

async function runProbe(context){
 let inspection;
 try{inspection=JSON.parse(await fs.readFile('/state/dropea-inspect.json','utf8'));await fs.rename('/state/dropea-inspect.json','/state/dropea-inspect-processing.json');}catch{}
 const orderId=inspection?.orderId||process.env.INCIDENT_PROBE_ORDER_ID;
 if(!/^\d+$/.test(orderId||''))throw Error('PROBE_ORDER_REQUIRED');
 const report={at:new Date().toISOString(),writes:0,sites:{}};
 for(const [name,url] of [
  ['chatby','https://app.chatby.io/settings/accounts/298087#/chat/f295175'],
  ['dropea',`https://v2.app.dropea.com/es/dropshipper/incidences?tab=all&search=${orderId}&search_type=order_number`]
 ]){
  const origin=new URL(url).origin;
  const page=context.pages().find(p=>p.url().startsWith(origin))||await context.newPage();
  await page.bringToFront();
  if(!page.url().startsWith(origin))await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
  let authError;
  if(name==='dropea'){
   try{const version=(await fs.stat(new URL('./dropea-session.mjs',import.meta.url))).mtimeMs;const {ensureDropeaSession}=await import(`./dropea-session.mjs?v=${version}`);await ensureDropeaSession(page);}catch(e){authError=/^[A-Z_]+$/.test(e.message)?e.message:e.name;}
   if(!authError&&!new URL(page.url()).pathname.endsWith('/incidences')){
    let menuError;
    try{await page.getByText('Pedidos',{exact:true}).click();}catch(e){menuError=e.name;}
    await fs.writeFile('/evidence/dropea-menu.json',JSON.stringify({menuError,text:await page.locator('body').innerText(),links:await page.locator('a').evaluateAll(es=>es.map(e=>({text:e.innerText,href:e.getAttribute('href')})))}));
    const link=page.locator('a[href="/incidences"]');
    if(await link.count()===1)await link.evaluate(e=>e.click());
    await page.waitForURL(u=>u.pathname.endsWith('/incidences'),{timeout:15000});
   }
   if(!authError&&new URL(page.url()).pathname.endsWith('/incidences')){
    const detail=page.getByRole('dialog',{name:'Detalle de Incidencia',exact:true});
    if(await detail.count()===1)await detail.getByText('Cerrar',{exact:true}).click();
    const draft=page.getByRole('dialog',{name:'Aportar solución',exact:true});
    if(await draft.count()===1)await draft.getByText('Cancelar',{exact:true}).click();
    await page.getByText('Todas',{exact:true}).click();
    await clearIncidentDateFilter(page);
    const search=page.getByPlaceholder('Buscar...',{exact:true});
    await search.fill(orderId);await search.press('Enter');
   }
  }
  let targetVisible=false;
  try{
   if(name==='chatby')await ensureChatbyView(page);
   else await page.getByText(new RegExp(orderId)).first().waitFor({timeout:30000});
   targetVisible=true;
  }catch{/* Preserve diagnostic state without treating a missing row as logout. */}
  const text=await page.locator('body').innerText();
  report.sites[name]={url:page.url(),authError,targetVisible,authenticated:!new URL(page.url()).pathname.includes('login')&&(name!=='chatby'||targetVisible),
   accountVerified:name==='chatby'?page.url().includes('/accounts/298087'):text.replace(/\s/g,'').includes('17431'),
   text,rows:name==='dropea'?await page.getByText(new RegExp(orderId)).evaluateAll(es=>es.map(e=>(e.closest('tr')||e.parentElement.parentElement.parentElement).outerHTML)):[],controls:await page.locator('input,button,[role="combobox"]').evaluateAll(es=>es.map(e=>({tag:e.tagName,role:e.getAttribute('role'),type:e.getAttribute('type'),placeholder:e.getAttribute('placeholder'),text:e.innerText,aria:e.getAttribute('aria-label')})))};
  await fs.writeFile('/evidence/session-probe.json',JSON.stringify(report));
  if(name==='dropea'&&inspection&&/^\d+$/.test(inspection.issueId||'')&&['DETAIL','FORM'].includes(inspection.view)){
   const row=page.locator('tr.clickable-row').filter({has:page.getByText(inspection.issueId,{exact:true})});
   if(await row.count()!==1||!(await row.innerText()).includes(orderId))throw Error('INSPECTION_IDENTITY_MISMATCH');
   await row.locator('button.option-button').click();
   await page.getByText(inspection.view==='DETAIL'?'Ver detalle':'Aportar solución',{exact:true}).click();
   const dialog=page.getByRole('dialog',{name:inspection.view==='DETAIL'?'Detalle de Incidencia':'Aportar solución',exact:true});await dialog.waitFor({timeout:15000});
   if(inspection.view==='FORM'){
    await dialog.getByText('Selecciona solución',{exact:true}).click();
    await fs.writeFile('/evidence/dropea-options.json',JSON.stringify({text:await page.locator('body').innerText(),options:await page.getByRole('option').allTextContents()}));
    await page.getByText('Reintentar entrega',{exact:true}).filter({visible:true}).click();
    if(/^\d{4}-\d{2}-\d{2}$/.test(inspection.testDate||'')){
     const date=inspection.testDate.split('-').reverse().join('/');
     const version=(await fs.stat(new URL('./dropea-ui.mjs',import.meta.url))).mtimeMs;
     const {selectRetryDate}=await import(`./dropea-ui.mjs?v=${version}`);
     const input=dialog.locator('input.p-datepicker-input');await selectRetryDate(page,dialog,inspection.testDate);
     await fs.writeFile('/evidence/dropea-calendar.json',JSON.stringify({html:await page.locator('.p-datepicker-panel').evaluateAll(es=>es.map(e=>e.outerHTML))}));
     await fs.writeFile('/evidence/dropea-date-test.json',JSON.stringify({requested:date,retained:await input.inputValue(),saved:false}));
    }
   }
   await fs.writeFile('/evidence/dropea-inspect.json',JSON.stringify({text:await dialog.innerText(),html:await dialog.evaluate(e=>e.outerHTML)}));
   if(inspection.testDate)await dialog.getByText('Cancelar',{exact:true}).click();
  }
 }
 await fs.writeFile('/evidence/session-probe.json',JSON.stringify(report));
 return Object.fromEntries(Object.entries(report.sites).map(([k,v])=>[k,{authenticated:v.authenticated,accountVerified:v.accountVerified}]));
}

export async function probeSessions(context){
 try{
  const result=await runProbe(context);
  const fixture=await context.newPage();
  try{
   await fixture.route('**/*',route=>route.abort());
   await fixture.setContent('<html><body><label>Technical file test<input type="file"></label></body></html>');
   await fixture.locator('input').setInputFiles('/evidence/runtime-selftest.png');
   const uploaded=await fixture.locator('input').evaluate(e=>({count:e.files.length,size:e.files[0]?.size,type:e.files[0]?.type}));
   const size=(await fs.stat('/evidence/runtime-selftest.png')).size;
   result.uploadSelfTest=uploaded.count===1&&uploaded.size===size&&uploaded.type==='image/png';
   await fs.writeFile('/state/upload-selftest.json',JSON.stringify({at:new Date().toISOString(),passed:result.uploadSelfTest,externalRequests:0}));
  }finally{await fixture.close();}
  return result;
 }
 catch(error){
  await fs.writeFile('/evidence/probe-error.json',JSON.stringify({at:new Date().toISOString(),name:error.name,message:String(error.message).slice(0,2000)}),{mode:0o600});
  throw Error('SESSION_PROBE_FAILED');
 }
}
