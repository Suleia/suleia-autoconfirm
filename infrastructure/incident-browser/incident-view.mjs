const origin='https://v2.app.dropea.com';
const dated=url=>url.searchParams.has('date_from')||url.searchParams.has('date_to');
const incidentUrl=url=>url.origin===origin&&url.pathname.endsWith('/incidences');

// A persisted upper date bound can hide today's saved issue after midnight.
// Clear only the uniquely observed date filter in the existing private view.
// The caller must still identify the exact issue/order row before any action.
export async function clearIncidentDateFilter(page){
 const before=new URL(page.url());
 if(!incidentUrl(before))throw Error('INCIDENT_VIEW_REQUIRED');
 const date=page.getByPlaceholder('Fecha',{exact:true});
 const dates=await date.count();
 if(dates===0&&!dated(before))return {cleared:false};
 if(dates!==1)throw Error('INCIDENT_DATE_FILTER_UNVERIFIED');
 // Angular retains the old URL until the next search is submitted. The live
 // form is authoritative here; an already empty date must not clear a
 // different filter or wait forever for a navigation that has not happened.
 if(!(await date.inputValue()).trim())return {cleared:false};
 const remove=page.getByRole('button',{name:'Quitar filtro',exact:true}).filter({visible:true});
 if(await remove.count()!==1)throw Error('INCIDENT_DATE_FILTER_UNVERIFIED');
 await remove.click();
 await remove.waitFor({state:'hidden',timeout:15000});
 const after=new URL(page.url());
 if(!incidentUrl(after)||after.pathname!==before.pathname||(await date.inputValue()).trim())throw Error('INCIDENT_DATE_FILTER_NOT_CLEARED');
 return {cleared:true};
}
