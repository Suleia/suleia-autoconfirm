import fs from 'node:fs/promises';
import {canonicalPickup} from './gls-pickup-policy.mjs';
export async function inspectGlsPickup(context,input,{control,readCurrent,readTracking,write=fs.writeFile}={}){
 if(input?.glsPickupInspection!==true||!/^\d{1,14}$/.test(String(input.orderId))||!/^\d{1,14}$/.test(String(input.issueId))||Object.keys(input).some(k=>!['glsPickupInspection','orderId','issueId'].includes(k)))throw Error('GLS_INSPECTION_EXACT_ID_REQUIRED');
 if(!control)control=JSON.parse(await fs.readFile('/state/retry-control.json','utf8'));
 if(control.glsPickupNotice?.enabled!==true||control.glsPickupNotice?.authorizationRef!=='OWNER-2026-10-31-GLS-PICKUP-1')throw Error('GLS_INSPECTION_NOT_AUTHORIZED');
 if(!readCurrent){const {readDropeaV2ReturnIssueState,createDropeaV2IncidentClient}=await import('../../autoconfirm/src/clients/dropea-v2-incidents.mjs');readCurrent=i=>readDropeaV2ReturnIssueState(i,{includeOrder:true,clientFactory:c=>createDropeaV2IncidentClient({...c,maxReadRetries:1,timeoutMs:8000})});}
 const current=await readCurrent({orderId:String(input.orderId),incidenceId:String(input.issueId)});
 if(!canonicalPickup(current)||String(current.order.orderId)!==String(input.orderId)||String(current.issue.raw.id)!==String(input.issueId))throw Error('GLS_INSPECTION_NATIVE_IDENTITY_REQUIRED');
 if(!readTracking){const version=(await fs.stat(new URL('./gls-pickup-source.mjs',import.meta.url))).mtimeMs;readTracking=(await import('./gls-pickup-source.mjs?v='+version)).readGlsTracking;}
 const o=current.order.raw,tracking=await readTracking(context,{url:o.tracking_url,tracking:String(o.tracking_number),postal:String(o.shipping_address?.postal_code||'')},{saveDiagnostic:d=>write(`/evidence/gls-pickup-${input.orderId}-tracking-private.json`,JSON.stringify(d),{mode:0o600})});
 await write('/state/gls-pickup-inspection.json',JSON.stringify({at:new Date().toISOString(),order_id:String(input.orderId),issue_id:String(input.issueId),tracking}),{mode:0o600});
 return {GLS:{read_only:true,state:tracking.state,verified:tracking.verified,customer_messages:0,logistics_writes:0}};
}
