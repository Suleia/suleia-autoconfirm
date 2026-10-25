import {readFile} from 'node:fs/promises';
import {POLICY,safeCode} from './policy.mjs';

// API sees only this contact-free projection, never the private SQLite/key.
export function recoveryOverviewReader(file,{now=Date.now}={}){
  return async()=>{
    const data=JSON.parse(await readFile(file,'utf8'));
    if(data.policy!==POLICY||data.available!==true||!['SHADOW','LIVE'].includes(data.mode)||!Array.isArray(data.items)||
       !data.metrics||!Number.isFinite(Date.parse(data.observedAt)))throw Error('IMPORT_RECOVERY_PROJECTION_INVALID');
    const keys=['address_import_failures','address_recoverable','auto_corrected','customer_required','recovered','manual_review','duplicates_prevented','pending'];
    const metrics=Object.fromEntries(keys.map(k=>{if(!Number.isSafeInteger(data.metrics[k])||data.metrics[k]<0)throw Error('IMPORT_RECOVERY_METRICS_INVALID');return [k,data.metrics[k]];}));
    const items=data.items.slice(0,200).map(r=>{
      if(!/^[a-f0-9]{64}$/.test(r.id)||!/^\d{1,20}$/.test(r.shopify_order_id)||!Number.isFinite(Date.parse(r.detected_at)))throw Error('IMPORT_RECOVERY_ROW_INVALID');
      return {id:r.id,shopify_order_id:r.shopify_order_id,failure_code:safeCode(r.failure_code),failure_class:safeCode(r.failure_class),category:r.category?safeCode(r.category):null,detected_at:r.detected_at,address_status:safeCode(r.address_status),confidence_level:['HIGH','MEDIUM','LOW'].includes(r.confidence_level)?r.confidence_level:null,next_action:safeCode(r.next_action),last_error:r.last_error?safeCode(r.last_error):null,resolved_at:r.resolved_at&&Number.isFinite(Date.parse(r.resolved_at))?r.resolved_at:null};
    });
    return {available:true,policy:POLICY,mode:data.mode,observedAt:data.observedAt,stale:now()-Date.parse(data.observedAt)>90*60_000,metrics,items};
  };
}
