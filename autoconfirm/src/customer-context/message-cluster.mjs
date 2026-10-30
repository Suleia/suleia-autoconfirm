import {hash} from '../customer-care/context.mjs';
import {isCustomerInteraction,messageTimestamp,extractWamid} from '../workflows/incident-discount-policy.mjs';
import {addressMessageText} from '../workflows/address-response-policy.mjs';
export function relevantMessageCluster(input){
  const start=Date.parse(input.order?.createdAt),now=input.now??Date.now();
  const unique=new Map();
  for(const m of input.messages||[]){
    const at=messageTimestamp(m);
    if(isCustomerInteraction(m)&&(!Number.isFinite(at)||at>now))throw Error('CUSTOMER_EVENT_TIME_UNVERIFIED');
    if(!Number.isFinite(at)||at<start)continue;
    const id=String(m.id||m.mid||hash(m));
    const text=addressMessageText(m)||m.payload?.body||'';
    const record={event_id:hash(id),source_event_at:new Date(at).toISOString(),text,
      direction:isCustomerInteraction(m)?'INBOUND':'OUTBOUND',message:m,
      source_event_hash:hash([id,at,isCustomerInteraction(m),text,m.payload?.name,m.payload?.reply_to_mid,extractWamid(m)])};
    if(unique.has(id)&&unique.get(id).source_event_hash!==record.source_event_hash)throw Error('CONFLICTING_DUPLICATE_EVENT');
    unique.set(id,record);
  }
  return [...unique.values()].sort((a,b)=>a.source_event_at.localeCompare(b.source_event_at)||a.event_id.localeCompare(b.event_id));
}
export const clusterHash=events=>hash(events.map(e=>[e.event_id,e.source_event_hash]));
