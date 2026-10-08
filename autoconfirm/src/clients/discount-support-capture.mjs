// Uses a dedicated authenticated browser session, never the operator's live tab.
// No reconstructed chat image is accepted as screenshot evidence.
export function supportCaptureConfigured(env=process.env){return Boolean(env.DISCOUNT_CHATBY_STORAGE_STATE&&env.DISCOUNT_CHATBY_URL&&(env.DISCOUNT_BROWSER_CDP_URL||env.DISCOUNT_BROWSER_EXECUTABLE));}
export async function captureSupportEvidence(plan,{env=process.env}={}) {
 if(!supportCaptureConfigured(env))throw Error('SCREENSHOT_CONNECTION_REQUIRED');
 const url=new URL(env.DISCOUNT_CHATBY_URL);if(url.origin!=='https://app.chatby.io'||!url.hash.startsWith('#/chat/'))throw Error('CHATBY_CAPTURE_URL_INVALID');
 const storageState=JSON.parse(env.DISCOUNT_CHATBY_STORAGE_STATE);
 if(!Array.isArray(storageState.cookies)||storageState.cookies.some(c=>!/^\.?([a-z0-9-]+\.)*chatby\.io$/.test(c.domain))
   ||(storageState.origins||[]).some(o=>o.origin!=='https://app.chatby.io'))throw Error('CHATBY_SESSION_SCOPE_INVALID');
 const {chromium}=await import('playwright-core');
 const browser=env.DISCOUNT_BROWSER_CDP_URL?await chromium.connectOverCDP(env.DISCOUNT_BROWSER_CDP_URL):await chromium.launch({executablePath:env.DISCOUNT_BROWSER_EXECUTABLE,headless:true});
 let context;
 try{
  context=await browser.newContext({storageState,viewport:{width:1600,height:1400},locale:'es-ES',timezoneId:'Europe/Madrid',acceptDownloads:false});
  const page=await context.newPage();page.setDefaultTimeout(20000);
  // Capture code must never send a message or resolve an incident.
  await page.route('**/*',route=>/\/send(?:-|\/)|\/resolve(?:\?|$)|\/set-user-field/.test(route.request().url())?route.abort():route.continue());
  await page.goto(url.href,{waitUntil:'domcontentloaded'});
  const search=page.getByPlaceholder('Buscar',{exact:true});
  await search.waitFor({state:'visible'});
  if(await search.count()!==1)throw Error('CHATBY_SEARCH_NOT_UNIQUE');
  // The saved session can retain Open/Pending filters. Use the status All row,
  // identified by its tickets icon; the assignment All row is a different filter.
  const allStatuses=page.locator('.el-dropdown-menu__item').filter({has:page.locator('.el-icon-tickets')});
  await allStatuses.waitFor({state:'visible'});
  if(await allStatuses.count()!==1)throw Error('CHATBY_STATUS_FILTER_NOT_UNIQUE');
  await allStatuses.click();
  await search.fill(plan.phone.slice(3));
  const contact=page.getByText(plan.customerName,{exact:true});await contact.waitFor({state:'visible'});
  if(await contact.count()!==1)throw Error('CHATBY_CONTACT_NOT_UNIQUE');await contact.click();
  const acceptance=page.locator('#msg-'+plan.acceptanceMessageId),offer=page.locator('#msg-'+plan.offerMessageId);
  await acceptance.waitFor({state:'attached'});await offer.waitFor({state:'attached'});
  const body=await page.locator('body').innerText();
  if(!body.includes(plan.conversationId)||!body.includes(plan.orderId)||!body.replace(/[\s+]/g,'').includes(plan.phone.slice(1)))throw Error('SCREENSHOT_IDENTITY_MISMATCH');
  const acceptText=await acceptance.innerText(),offerText=await offer.innerText();
  if(!/quiero el descuento|acepto (el )?descuento|^acepto[.!]?\s/im.test(acceptText)||!offerText.includes((plan.finalCents/100).toFixed(2).replace('.',',')))throw Error('SCREENSHOT_OFFER_MISMATCH');
  const timestamp=await acceptance.locator('.text-timestamp [title]').getAttribute('title');
  if(Date.parse(timestamp)!==Date.parse(plan.acceptedAt))throw Error('SCREENSHOT_TIME_MISMATCH');
  const attachments=[];
  for(const [name,element] of [['oferta',offer],['aceptacion',acceptance]]){
   await element.scrollIntoViewIfNeeded();
   // Check date, time, phone and relevant message are actually in the viewport.
   const expectedDate=new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',day:'numeric',month:'short',year:'numeric'}).format(new Date(name==='oferta'?plan.offerAt:plan.acceptedAt)).toLowerCase().replace(/[^a-z0-9]/g,'');
   const visible=await page.evaluate(({messageId,phone,expectedDate})=>{
    const inView=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth;};
    const message=document.getElementById('msg-'+messageId);
    const date=[...document.querySelectorAll('.card-date')].some(e=>inView(e)&&e.textContent.toLowerCase().replace(/[^a-z0-9]/g,'')===expectedDate);
    const number=[...document.querySelectorAll('input')].some(e=>e.value===phone&&inView(e));
    const time=message?.querySelector('.text-timestamp');
    return Boolean(message&&inView(message)&&time&&inView(time)&&date&&number);
   },{messageId:name==='oferta'?plan.offerMessageId:plan.acceptanceMessageId,phone:plan.phone.slice(3),expectedDate});
   if(!visible)throw Error('SCREENSHOT_REQUIRED_FIELDS_NOT_VISIBLE');
   attachments.push({filename:`ES${plan.orderId}-${name}.png`,mimeType:'image/png',bytes:await page.screenshot({type:'png',fullPage:false})});
  }
  return {source:'CHATBY_BROWSER_SCREENSHOT',snapshot:plan.snapshot,orderId:plan.orderId,conversationId:plan.conversationId,phone:plan.phone,
   offerMessageId:plan.offerMessageId,acceptanceMessageId:plan.acceptanceMessageId,acceptedAt:plan.acceptedAt,capturedAt:new Date().toISOString(),
   visiblePhone:true,visibleDateTime:true,visibleAcceptance:true,visibleOffer:true,attachments};
 } finally {await context?.close();await browser.close();}
}
