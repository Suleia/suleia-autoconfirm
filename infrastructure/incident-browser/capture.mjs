import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
const normalize=s=>String(s||'').replace(/\s+/g,' ').trim();

// Read-only UI operations. This never types into the message composer.
export async function captureRetryEvidence(context,plan){
 if(!/^\d+$/.test(plan.orderId)||!/^\d+$/.test(plan.messageId)||!/^\d{9}$/.test(plan.phone)||!plan.text||!plan.customerName)throw Error('CAPTURE_IDENTITY_REQUIRED');
 const page=context.pages().find(p=>p.url().startsWith('https://app.chatby.io/'));
 if(!page)throw Error('CHATBY_SESSION_REQUIRED');
 let stage='SEARCH';
 try{
  await page.bringToFront();
  await page.setViewportSize({width:1900,height:2200});
  const search=page.getByPlaceholder('Buscar',{exact:true}).filter({visible:true});
  await search.waitFor({timeout:30000});
  const all=page.locator('.el-dropdown-menu__item').filter({has:page.locator('.el-icon-tickets')});
  if(await all.count()===1&&await all.isVisible())await all.click();
  await search.fill(plan.phone);
  stage='CONTACT';
  const alreadyOpen=await page.locator('#msg-'+plan.messageId).count()===1&&(await page.locator('body').innerText()).includes(plan.conversationId);
  if(!alreadyOpen){
   const contact=page.getByText(plan.customerName,{exact:true}).filter({visible:true});
   await contact.waitFor({timeout:30000});
   await contact.click();
  }
  stage='MESSAGE';
  const message=page.locator('#msg-'+plan.messageId);
  await message.waitFor({timeout:30000});
  const body=await page.locator('body').innerText();
  if(!body.includes(plan.conversationId)||!body.includes(plan.orderId)||!body.replace(/[\s+]/g,'').includes('34'+plan.phone))throw Error('CONVERSATION_IDENTITY_MISMATCH');
  if(!normalize(await message.innerText()).includes(normalize(plan.text)))throw Error('MESSAGE_TEXT_MISMATCH');
  const stamp=await message.locator('.text-timestamp [title]').getAttribute('title');
  if(Date.parse(stamp)!==Date.parse(plan.messageAt))throw Error('MESSAGE_TIME_MISMATCH');
  stage='VISIBLE_PROOF';
  await message.scrollIntoViewIfNeeded();
  const expectedDate=new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',day:'numeric',month:'short',year:'numeric'}).format(new Date(plan.messageAt)).toLowerCase().replace(/[^a-z0-9]/g,'');
  const dateLabel=new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',day:'numeric',month:'short',year:'numeric'}).format(new Date(plan.messageAt));
  const dateHeader=page.locator('.card-date').filter({hasText:dateLabel});
  if(await dateHeader.count()===1)await dateHeader.evaluate(e=>e.scrollIntoView({block:'nearest',inline:'nearest'}));
  await fs.writeFile('/evidence/capture-date-diagnostic.json',JSON.stringify({expectedDate,dates:await page.locator('.card-date').evaluateAll(es=>es.map(e=>({text:e.textContent,html:e.outerHTML,rect:e.getBoundingClientRect().toJSON()})))}));
  const visible=await page.evaluate(({id,phone,date})=>{
   const inView=e=>{
    if(!e)return false;
    const r=e.getBoundingClientRect();
    if(!(r.width>0&&r.height>0&&r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth))return false;
    for(let p=e.parentElement;p;p=p.parentElement){
     const s=getComputedStyle(p),b=p.getBoundingClientRect();
     if(/auto|scroll|hidden|clip/.test(s.overflowY)&&(r.top<b.top||r.bottom>b.bottom))return false;
     if(/auto|scroll|hidden|clip/.test(s.overflowX)&&(r.left<b.left||r.right>b.right))return false;
    }
    const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
    return Boolean(hit&&(hit===e||e.contains(hit)));
   };
   const message=document.getElementById('msg-'+id);
   return {message:inView(message),time:inView(message?.querySelector('.text-timestamp')),
    phone:[...document.querySelectorAll('input')].some(e=>e.value===phone&&inView(e)),
    date:[...document.querySelectorAll('.card-date')].some(e=>inView(e)&&e.textContent.toLowerCase().replace(/[^a-z0-9]/g,'')===date)};
  },{id:plan.messageId,phone:plan.phone,date:expectedDate});
  await fs.writeFile('/evidence/capture-visibility.json',JSON.stringify(visible));
  if(Object.values(visible).some(v=>v!==true))throw Error('PROOF_FIELDS_NOT_VISIBLE');
  const path=`/evidence/retry-${plan.orderId}-${plan.messageId}.png`;
  const bytes=await page.screenshot({path,fullPage:false,timeout:15000});
  const proof={verified:true,path,sha256:createHash('sha256').update(bytes).digest('hex'),at:new Date().toISOString(),messageId:plan.messageId,visible};
  await fs.writeFile(path+'.json',JSON.stringify(proof));
  return proof;
 }catch(error){
  await fs.writeFile('/evidence/capture-diagnostic.json',JSON.stringify({stage,text:await page.locator('body').innerText().catch(()=>''),controls:await page.locator('input,button').evaluateAll(es=>es.map(e=>({tag:e.tagName,text:e.innerText,placeholder:e.getAttribute('placeholder'),aria:e.getAttribute('aria-label')}))).catch(()=>[])}));
  await page.screenshot({path:'/evidence/capture-diagnostic.png',timeout:10000}).catch(async e=>{await fs.writeFile('/evidence/capture-screenshot-error.txt',String(e.message).slice(0,1200));});
  throw Error(`CAPTURE_${stage}_${/^[A-Z_]+$/.test(error.message)?error.message:'FAILED'}`);
 }
}
