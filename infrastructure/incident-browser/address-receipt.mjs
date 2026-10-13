import {addressMessageText} from '../../autoconfirm/src/workflows/address-response-policy.mjs';
import {extractWamid,isCustomerInteraction,messageTimestamp} from '../../autoconfirm/src/workflows/incident-discount-policy.mjs';
const norm=s=>String(s||'').replace(/\s+/g,' ').trim();
export function findDetailsReceipt({messages,content,attemptedAt,conversationId}){
 const start=Date.parse(attemptedAt);if(!Number.isFinite(start)||!content||!conversationId)return null;
 const matches=messages.filter(m=>!isCustomerInteraction(m)&&String(m.user_ns)===conversationId&&extractWamid(m)&&
  messageTimestamp(m)>=start&&messageTimestamp(m)<=start+120000&&norm(addressMessageText(m))===norm(content));
 const unique=[...new Map(matches.map(m=>[extractWamid(m),m])).values()];
 return unique.length===1?{messageId:extractWamid(unique[0]),sentAt:new Date(messageTimestamp(unique[0])).toISOString()}:null;
}
