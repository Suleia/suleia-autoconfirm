const origin='https://v2.app.dropea.com';
const dated=url=>url.searchParams.has('date_from')||url.searchParams.has('date_to');
const incidentUrl=url=>url.origin===origin&&url.pathname.endsWith('/incidences');

// A persisted upper date bound can hide today's saved issue after midnight.
// Clear only the uniquely observed date filter in the existing private view.
// The caller must still identify the exact issue/order row before any action.
export async function clearIncidentDateFilter(page){
 const before=new URL(page.url());
 if(!incidentUrl(before))throw Error('INCIDENT_VIEW_REQUIRED');
 if(!dated(before))return {cleared:false};
 const date=page.getByPlaceholder('Fecha',{exact:true});
 const remove=page.getByRole('button',{name:'Quitar filtro',exact:true}).filter({visible:true});
 if(await date.count()!==1||await remove.count()!==1)throw Error('INCIDENT_DATE_FILTER_UNVERIFIED');
 await remove.click();
 await page.waitForURL(url=>incidentUrl(url)&&url.pathname===before.pathname&&!dated(url),{timeout:15000});
 const after=new URL(page.url());
 if(!incidentUrl(after)||after.pathname!==before.pathname||dated(after))throw Error('INCIDENT_DATE_FILTER_NOT_CLEARED');
 return {cleared:true};
}
