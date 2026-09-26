// Official ResolveIssueInput / ResolutionAddress / ResolutionRetry contract.
export const DROPEA_RESOLUTION_ACTIONS=Object.freeze({
 MANAGING_WITH_CUSTOMER:{option:'MANAGED_BY_CLIENT',status:'MANAGING_WITH_CLIENT',resolution:null,final:true},
 PROVIDE_SOLUTION:{option:'PROVIDE_SOLUTION',status:'RESOLVED',resolution:'SOLUTION_PROVIDED'},
 RETRY_DELIVERY:{option:'RETRY',status:'RESOLVED',resolution:'RETRY'},
 CHANGE_ADDRESS:{option:'CHANGE_ADDRESS',status:'RESOLVED',resolution:'CHANGE_ADDRESS'},
 PICKUP_AT_AGENCY:{option:'PICKUP_AT_AGENCY',status:'RESOLVED',resolution:'PICKUP_AT_AGENCY'},
 REQUEST_RETURN:{option:'RETURN_REQUESTED',status:'RESOLVED',resolution:'RETURN_REQUESTED'}
});
const text=v=>typeof v==='string'&&v.trim().length>0;
const normal=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
export function buildDropeaResolutionBody(action,data={}){
 const spec=DROPEA_RESOLUTION_ACTIONS[action];if(!spec)throw Error('UNSUPPORTED_RESOLUTION_ACTION');
 const body={status:spec.status,...(spec.resolution?{resolution_status:spec.resolution}:{})};
 if(action==='MANAGING_WITH_CUSTOMER'&&data.finalStateAcknowledged!==true)throw Error('MANAGING_IS_FINAL_NOT_WAITING');
 if(action==='PROVIDE_SOLUTION'){
  if(!text(data.note)||data.note.length>500)throw Error('SOLUTION_NOTE_INVALID');body.resolution_note=data.note.trim();
 }
 if(action==='CHANGE_ADDRESS'){
  const a=data.address||{};if(['street','postal_code','city','state','country'].some(k=>!text(a[k]))||!/^[A-Z]{2}$/.test(a.country))throw Error('STRUCTURED_ADDRESS_INCOMPLETE');
  body.resolution_data={address:Object.fromEntries(['street','address_line_2','postal_code','city','state','country'].filter(k=>text(a[k])).map(k=>[k,a[k].trim()]))};
 }
 if(action==='RETRY_DELIVERY'){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(data.date||'')||!Number.isFinite(Date.parse(data.date))||new Date(data.date).toISOString().slice(0,10)!==data.date||!['morning','afternoon','evening'].includes(data.time_window))throw Error('DELIVERY_SLOT_REQUIRED');
  body.resolution_data={date:data.date,time_window:data.time_window};
 }
 return body;
}
export function planDropeaResolution(issue,action,data={}){
 const raw=issue?.raw||issue,spec=DROPEA_RESOLUTION_ACTIONS[action];
 if(!spec||raw?.status!=='PENDING'||raw?.is_active!==true||!raw.allowed_resolution_options?.includes(spec.option))return {allowed:false,reason:'CAPABILITY_NOT_ALLOWED',action};
 try{return {allowed:true,action,body:buildDropeaResolutionBody(action,data)};}catch(e){return {allowed:false,action,reason:e.message};}
}
export function verifyDropeaResolution(current,{issueId,orderId,action,body}){
 const issue=current?.issue?.raw||current?.issue;
 if(String(issue?.id)!==String(issueId)||String(issue?.order_id)!==String(orderId)||issue?.status!==body.status)return false;
 if(body.resolution_status&&issue.resolution_status!==body.resolution_status)return false;
 if(action==='CHANGE_ADDRESS'){
  const persisted=issue.resolution_data?.address;
  return !!persisted&&Object.entries(body.resolution_data.address).every(([k,v])=>normal(persisted[k])===normal(v));
 }
 if(action==='RETRY_DELIVERY')return Object.entries(body.resolution_data).every(([k,v])=>issue.resolution_data?.[k]===v);
 return true;
}
