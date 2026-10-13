import crypto from 'node:crypto';
import {findDetailsReceipt} from './address-receipt.mjs';

// The Render owner sent these messages. Reconcile its exact provider receipt;
// never send another message or treat a customer reply as delivery proof.
export async function reconcileAddressDetails(){
 const {selectRows,updateRows}=await import('../../autoconfirm/src/clients/supabase.mjs');
 const {addressCapabilityStore}=await import('../../autoconfirm/src/workflows/address-capability-store.mjs');
 const {addressResponseDecision}=await import('../../autoconfirm/src/workflows/address-response-policy.mjs');
 const {messageTimestamp}=await import('../../autoconfirm/src/workflows/incident-discount-policy.mjs');
 const {readDropeaV2ReturnIssueState}=await import('../../autoconfirm/src/clients/dropea-v2-incidents.mjs');
 const {getIncidentChatMessages,loadSubscriberIndex,findSubscriberInIndexForExactOrder}=await import('../../autoconfirm/src/clients/chatby.mjs');
 const actions=await selectRows('template_delivery_ledger',{query:{template_name:'like.address_capability_action_v1:DETAILS:*',status:'in.(unknown,verified)',order:'attempted_at.desc'},limit:10,timeoutMs:10000});
 if(!actions.length)return {checked:0,reconciled:0};
 const cache=(await selectRows('app_state',{query:{key:'eq.incidents_cache',select:'value'},limit:1,timeoutMs:10000}))[0];
 const names={street:'calle',number:'número',postal_code:'código postal',city:'localidad',province:'provincia',country:'país (código de dos letras)'};
 let reconciled=0,index;
 for(const action of actions){
  const orderId=String(action.order_id),issueId=String(action.raw?.issue_id||'');
  const incident=cache?.value?.incidents?.find(i=>String(i.orderId)===orderId&&String(i.incidenceId)===issueId);
  if(!incident?.chatbyUserNs||incident.chatbyOrderAssociation!=='EXACT_ORDER')continue;
  const cap=await addressCapabilityStore.get('DETAILS');
  if(cap?.value?.phase!=='HUMAN_REVIEW'||cap.value.canary?.action_id!==action.raw?.action_id)continue;
  const requests=await selectRows('template_delivery_ledger',{query:{order_id:`eq.${orderId}`,template_name:`eq.address_missing_fields_v1:${issueId}`},limit:2,timeoutMs:10000});
  if(requests.length!==1||!['delivery_unverified','sent'].includes(requests[0].status))continue;
  const request=requests[0],current=await readDropeaV2ReturnIssueState(incident,{includeOrder:true});
  index ||=await loadSubscriberIndex({maxPages:30,force:true});
  if(findSubscriberInIndexForExactOrder(index,{phone:current.order.customerPhone,orderId})?.user_ns!==incident.chatbyUserNs)continue;
  const messages=await getIncidentChatMessages(incident.chatbyUserNs),attempted=Date.parse(request.attempted_at);
  const decision=addressResponseDecision({incident:{...incident,chatbyReadVerified:true},...current,messages:messages.filter(m=>messageTimestamp(m)<=attempted),now:attempted});
  if(decision.action!=='ASK_MISSING_FIELDS'||!decision.missing_fields.length)continue;
  const content=`Para completar la dirección de tu pedido, indícanos: ${decision.missing_fields.map(k=>names[k]).join(', ')}. Gracias.`;
  const proof=findDetailsReceipt({messages,content,attemptedAt:request.attempted_at,conversationId:incident.chatbyUserNs});if(!proof)continue;
  const at=new Date().toISOString();
  const patch=async(row,values)=>updateRows('template_delivery_ledger',{...values,updated_at:at},{query:{template_key:`eq.${row.template_key}`,status:`eq.${row.status}`,updated_at:`eq.${row.updated_at}`},returning:'representation'});
  if((await patch(request,{status:'sent',sent_at:proof.sentAt,raw:{...request.raw,status:'DETAILS_REQUEST_SENT',verified:true,message_id:proof.messageId,last_required_field_request_at:proof.sentAt,reconciled_at:at}})).length!==1)continue;
  if((await patch(action,{status:'verified',sent_at:proof.sentAt,raw:{...action.raw,status:'VERIFIED',verified_at:at,breaker_effect:'CLOSED',provider_result:{status:'DETAILS_REQUEST_SENT',verified:true,provider_receipt:true,message_id:proof.messageId},reconciliation:{at,source:'EXACT_CHATBY_OUTGOING_WAMID',resent:false}}})).length!==1)continue;
  const value={...cap.value,revision:crypto.randomUUID(),mode:'LIVE',phase:'VERIFIED',breaker:'CLOSED',reason:null,promotion:{verified:true,at,action_id:action.raw.action_id,issue_id:issueId,order_id:orderId,writes:1,from:cap.value.mode,to:'LIVE',source:'EXACT_CHATBY_OUTGOING_WAMID'},reconciliation:{at,resent:false,message_id:proof.messageId}};
  if(await addressCapabilityStore.cas('DETAILS',cap,value))reconciled++;
 }
 return {checked:actions.length,reconciled};
}
