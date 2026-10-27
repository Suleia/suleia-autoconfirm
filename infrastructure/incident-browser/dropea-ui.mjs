import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ensureDropeaSession} from './dropea-session.mjs';
import {clearIncidentDateFilter} from './incident-view.mjs';

export async function selectRetryDate(page,dialog,iso){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(iso))throw Error('RETRY_DATE_REQUIRED');
 const [year,month,day]=iso.split('-').map(Number),key=`${year}-${month-1}-${day}`;
 const input=dialog.locator('input.p-datepicker-input');await input.click();
 const calendar=page.locator('.p-datepicker-panel').filter({visible:true});await calendar.waitFor({timeout:15000});
 const months=['january','february','march','april','may','june','july','august','september','october','november','december'];
 for(let n=0;n<25;n++){
  const cell=calendar.locator(`.p-datepicker-day[data-date="${key}"]`);
  if(await cell.count()===1){
   if((await cell.getAttribute('class')||'').split(/\s+/).includes('p-disabled'))throw Error('RETRY_DATE_NOT_ALLOWED');
   await cell.click();await calendar.waitFor({state:'hidden',timeout:15000});
   if(await input.inputValue()!==iso.split('-').reverse().join('/'))throw Error('RETRY_DATE_NOT_RETAINED');
   return;
  }
  const shownMonth=months.indexOf((await calendar.locator('.p-datepicker-select-month').innerText()).trim().toLowerCase());
  const shownYear=Number((await calendar.locator('.p-datepicker-select-year').innerText()).trim());
  if(shownMonth<0||!Number.isInteger(shownYear))throw Error('CALENDAR_MONTH_UNRECOGNIZED');
  const next=year*12+month-1>shownYear*12+shownMonth;
  await calendar.locator(`button[aria-label="${next?'Next':'Previous'} Month"]`).click();
 }
 throw Error('CALENDAR_DATE_OUT_OF_RANGE');
}

export async function incidentRow(context,plan){
 if(!/^\d+$/.test(plan.orderId)||!/^\d+$/.test(plan.issueId))throw Error('UI_IDENTITY_REQUIRED');
 const page=context.pages().find(p=>p.url().startsWith('https://v2.app.dropea.com/'));
 if(!page)throw Error('DROPEA_SESSION_REQUIRED');
 await page.bringToFront();await ensureDropeaSession(page);
 const dialogs=page.getByRole('dialog');
 if(await dialogs.count()){
  const dialog=dialogs.filter({visible:true});
  if(await dialog.count()!==1)throw Error('UNEXPECTED_DIALOG');
  const cancel=dialog.getByText('Cancelar',{exact:true}),close=dialog.getByText('Cerrar',{exact:true});
  if(await cancel.count()===1)await cancel.click();
  else if(await close.count()===1)await close.click();
  else throw Error('UNEXPECTED_DIALOG');
 }
 if(!new URL(page.url()).pathname.endsWith('/incidences')){
  // Use the observed Angular navigation link, preserving in-memory auth.
  const link=page.locator('a[href="/incidences"]');
  if(await link.count()!==1)throw Error('INCIDENT_NAVIGATION_REQUIRED');
  await link.evaluate(e=>e.click());
  await page.waitForURL(u=>u.pathname.endsWith('/incidences'),{timeout:15000});
 }
 await page.getByText('Todas',{exact:true}).click();
 await clearIncidentDateFilter(page);
 const search=page.getByPlaceholder('Buscar...',{exact:true});await search.fill(plan.orderId);await search.press('Enter');
 const row=page.locator('tr.clickable-row').filter({has:page.getByText(plan.issueId,{exact:true})});
 await row.waitFor({timeout:15000});
 if(await row.count()!==1||await row.locator(`a[href="/orders/ES${plan.orderId}"]`).count()!==1)throw Error('UI_ORDER_ISSUE_MISMATCH');
 return {page,row};
}

export async function prepareRetry(context,plan,proof){
 if(!proof?.verified||proof.messageId!==plan.messageId||!/^\/evidence\/retry-\d+-\d+\.png$/.test(proof.path))throw Error('VERIFIED_PROOF_REQUIRED');
 const bytes=await fs.readFile(proof.path);
 if(bytes.length>10*1024*1024||createHash('sha256').update(bytes).digest('hex')!==proof.sha256)throw Error('PROOF_CHANGED');
 const {page,row}=await incidentRow(context,plan);
 if(!(await row.innerText()).replace(/\s/g,'').includes('34'+plan.phone))throw Error('UI_PHONE_MISMATCH');
 await row.locator('button.option-button').click();
 await page.getByText('Aportar solución',{exact:true}).filter({visible:true}).click();
 const dialog=page.getByRole('dialog',{name:'Aportar solución',exact:true});
 await dialog.getByText('Selecciona solución',{exact:true}).click();
 await page.getByText('Reintentar entrega',{exact:true}).filter({visible:true}).click();
 const date=plan.date.split('-').reverse().join('/');
 const dateInput=dialog.locator('input.p-datepicker-input');
 await selectRetryDate(page,dialog,plan.date);
 if(await dateInput.inputValue()!==date)throw Error('RETRY_DATE_NOT_RETAINED');
 const label={morning:'Mañana',afternoon:'Tarde'}[plan.time_window];
 if(!label)throw Error('RETRY_WINDOW_UNSUPPORTED');
 const window=dialog.locator('p-select').nth(1).locator('[role="combobox"]');
 if((await window.innerText()).trim()!==label){await window.click();await page.getByText(label,{exact:true}).filter({visible:true}).click();}
 const upload=dialog.locator('#incidence-evidence-input');
 if(await upload.count()!==1)throw Error('EVIDENCE_UPLOAD_REQUIRED');
 await upload.setInputFiles(proof.path);
 await dialog.getByText(path.basename(proof.path),{exact:true}).waitFor({timeout:30000});
 const save=dialog.locator('button').filter({hasText:'Guardar'});
 if(await save.count()!==1||!await save.isEnabled())throw Error('RETRY_FORM_NOT_READY');
 await page.screenshot({path:`/evidence/prepared-${plan.orderId}-${plan.issueId}.png`,timeout:15000});
 return {
  save:async()=>{
   if(await dateInput.inputValue()!==date||(await window.innerText()).trim()!==label||!await save.isEnabled())throw Error('FORM_CHANGED');
   await save.click(); // Exactly one click; uncertain outcome must retain claim.
   await dialog.waitFor({state:'hidden',timeout:30000});
  },
  cancel:async()=>{await dialog.getByText('Cancelar',{exact:true}).click();}
 };
}

export async function readEvidenceDetail(context,plan){
 const {page,row}=await incidentRow(context,plan);
 await row.locator('button.option-button').click();
 await page.getByText('Ver detalle',{exact:true}).filter({visible:true}).click();
 const dialog=page.getByRole('dialog');await dialog.waitFor({timeout:15000});
 return {page,dialog,text:await dialog.innerText(),html:await dialog.evaluate(e=>e.outerHTML)};
}
