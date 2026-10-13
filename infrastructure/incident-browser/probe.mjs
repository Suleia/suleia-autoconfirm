import fs from 'node:fs/promises';

export async function probeSessions(context){
 const orderId=process.env.INCIDENT_PROBE_ORDER_ID;
 if(!/^\d+$/.test(orderId||''))throw Error('PROBE_ORDER_REQUIRED');
 const report={at:new Date().toISOString(),writes:0,sites:{}};
 for(const [name,url] of [
  ['chatby','https://app.chatby.io/settings/accounts/298087#/chat/f295175'],
  ['dropea',`https://v2.app.dropea.com/es/dropshipper/incidences?tab=all&search=${orderId}&search_type=order_number`]
 ]){
  const origin=new URL(url).origin;
  const page=context.pages().find(p=>p.url().startsWith(origin))||await context.newPage();
  await page.bringToFront();
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
  let targetVisible=false;
  try{
   if(name==='chatby')await page.getByPlaceholder('Buscar',{exact:true}).waitFor({timeout:30000});
   else await page.getByRole('row').filter({hasText:orderId}).first().waitFor({timeout:30000});
   targetVisible=true;
  }catch{/* Preserve diagnostic state without treating a missing row as logout. */}
  const text=await page.locator('body').innerText();
  report.sites[name]={url:page.url(),targetVisible,authenticated:!new URL(page.url()).pathname.includes('login'),
   accountVerified:name==='chatby'?page.url().includes('/accounts/298087'):text.replace(/\s/g,'').includes('17431'),
   text,controls:await page.locator('input,button,[role="combobox"]').evaluateAll(es=>es.map(e=>({tag:e.tagName,role:e.getAttribute('role'),type:e.getAttribute('type'),placeholder:e.getAttribute('placeholder'),text:e.innerText,aria:e.getAttribute('aria-label')})))};
  await fs.writeFile('/evidence/session-probe.json',JSON.stringify(report));
  try{await page.screenshot({path:`/evidence/${name}-session-probe.png`,fullPage:false,timeout:10000});}catch{}
 }
 await fs.writeFile('/evidence/session-probe.json',JSON.stringify(report));
 return Object.fromEntries(Object.entries(report.sites).map(([k,v])=>[k,{authenticated:v.authenticated,accountVerified:v.accountVerified}]));
}
