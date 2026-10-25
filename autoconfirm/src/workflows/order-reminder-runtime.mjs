import {getAppConfig} from '../config.mjs';
import {supabaseRequest} from '../clients/supabase.mjs';
import {getDropeaV2OrderById} from '../clients/dropea-v2-orders.mjs';
import {createDropeaV2IncidentClient,loadDropeaV2IncidentStoreConfigs} from '../clients/dropea-v2-incidents.mjs';
import {getOrderReminderTemplate,getOrderReminderSubscriber,getOrderReminderMessages,sendOrderConfirmationReminder,getChatbyRetryAfterMs} from '../clients/chatby.mjs';
import {createOrderReminderService} from './order-reminder-service.mjs';
import {INITIAL_TEMPLATE,REMINDER_TEMPLATE,REMINDER_TIMER,REMINDER_OWNER,numericId,purchaseAnchor,reminderHash,reminderParameters,exactPhone} from './order-reminder-policy.mjs';

export const REMINDER_STATUS_KEY='order_confirmation_reminder_v1';
export function loadReminderConfig(env=process.env){
 const cancellation=Number(env.UNANSWERED_CANCEL_AFTER_HOURS||36);
 const lookbackHours=Math.min(72,cancellation);
 if(!Number.isFinite(lookbackHours)||lookbackHours<2)throw Error('REMINDER_LOOKBACK_INVALID');
 return {enabled:env.ORDER_REMINDER_ENABLED==='true',realSends:env.ORDER_REMINDER_REAL_SENDS==='true',canaryEnabled:env.ORDER_REMINDER_CANARY_ENABLED==='true',canaryOrderId:env.ORDER_REMINDER_CANARY_ORDER_ID||'',owner:env.ORDER_CONFIRMATION_REMINDER_OWNER||'unassigned',nativeSendersDisabled:env.ORDER_REMINDER_NATIVE_SENDERS_DISABLED==='true',ownerReference:env.ORDER_REMINDER_OWNER_REFERENCE||'',lookbackHours,batchSize:2};
}
export function createReminderDeliveryStore({request=supabaseRequest,storeId='suleia'}={}){
 const fence=key=>{if(!/^ORDER_REMINDER:[A-Za-z0-9:_-]{1,160}:dropea_pedido_reminder_v1$/.test(String(key)))throw Error('REMINDER_LEDGER_NAMESPACE_REQUIRED');};
 const get=async key=>{fence(key);const rows=await request('/rest/v1/template_delivery_ledger',{query:{select:'template_key,status,raw',template_key:'eq.'+key,template_name:'eq.'+REMINDER_TEMPLATE,limit:1},timeoutMs:10000});if(!Array.isArray(rows))throw Error('REMINDER_LEDGER_UNAVAILABLE');return rows[0]||null;};
 return {get,
  async claim(key,receipt){
   fence(key);
   const values={template_key:key,store_id:storeId,order_id:receipt.dropea_order_id,template_name:REMINDER_TEMPLATE,provider:'chatby',status:'CLAIMED',attempted_at:new Date().toISOString(),updated_at:new Date().toISOString(),raw:receipt};
   try{
    const rows=await request('/rest/v1/template_delivery_ledger',{method:'POST',body:[values],headers:{Prefer:'return=representation'},timeoutMs:10000});
    return {acquired:Array.isArray(rows)&&rows.length===1&&rows[0].raw?.claim_id===receipt.claim_id,persistent:true};
   }catch{
    const old=await get(key);
    if(old?.status==='CLAIMED'&&old.raw?.claim_id===receipt.claim_id)return {acquired:true,persistent:true};
    if(old?.status==='PRE_SEND_BLOCKED'&&!old.raw?.send_started_at){
     const rows=await request('/rest/v1/template_delivery_ledger',{method:'PATCH',query:{template_key:'eq.'+key,template_name:'eq.'+REMINDER_TEMPLATE,status:'eq.PRE_SEND_BLOCKED','raw->>send_started_at':'is.null'},body:values,headers:{Prefer:'return=representation'},timeoutMs:10000});
     return {acquired:Array.isArray(rows)&&rows.length===1&&rows[0].raw?.claim_id===receipt.claim_id,persistent:true};
    }
    return {acquired:false,persistent:Boolean(old)};
   }
  },
  async finish(key,claimId,status,receipt){
   fence(key);
   if(!['PRE_SEND_BLOCKED','SENDING','SEND_UNKNOWN','VERIFIED'].includes(status))throw Error('REMINDER_LEDGER_STATE_INVALID');
   const rows=await request('/rest/v1/template_delivery_ledger',{method:'PATCH',query:{template_key:'eq.'+key,template_name:'eq.'+REMINDER_TEMPLATE,'raw->>claim_id':'eq.'+claimId,status:'in.(CLAIMED,SENDING,SEND_UNKNOWN,PRE_SEND_BLOCKED)'},body:{status,raw:receipt,updated_at:new Date().toISOString(),...(status==='VERIFIED'?{sent_at:receipt.send_started_at}:{})},headers:{Prefer:'return=representation'},timeoutMs:10000});
   return Array.isArray(rows)&&rows.length===1&&rows[0].raw?.claim_id===claimId&&rows[0].status===status;
  }
 };
}
export function createReminderPorts({env=process.env,app=getAppConfig(),request=supabaseRequest,orderRead=getDropeaV2OrderById}={}){
 let issueIndex=null;
 const stores=()=>{const values=loadDropeaV2IncidentStoreConfigs(env);if(values.length!==1||values[0].market!=='ES')throw Error('REMINDER_STORE_SCOPE_UNVERIFIED');return values[0];};
 const db=async(table,query)=>{
  const rows=await request('/rest/v1/'+table,{query:{select:'*',...query},timeoutMs:10000});
  if(!Array.isArray(rows))throw Error('REMINDER_DATABASE_READ_UNVERIFIED');return rows;
 };
 const ports={
  async candidates({now,lookbackHours,replay}){
   if(getChatbyRetryAfterMs()>0)throw Object.assign(Error(),{code:'REMINDER_PROVIDER_COOLDOWN'});
   const store=stores(),lower=new Date(now-lookbackHours*3600000).toISOString(),upper=new Date(now-(replay?0:7200000)).toISOString();
   const or=`(and(raw->raw->>external_created_at.gte.${lower},raw->raw->>external_created_at.lte.${upper}),and(raw->raw->>external_created_at.is.null,raw->raw->>created_at.gte.${lower},raw->raw->>created_at.lte.${upper}))`;
   const all=[];let complete=false;
   for(let page=0;page<3;page++){
    const rows=await db('orders',{select:'order_id,store_id,status,confirmed_at,created_at_source,chatby_user_ns,raw',store_id:'eq.'+app.defaultStore.id,or,...(!replay?{status:'in.(PENDING,PENDING_ADDRESS_CHANGE)'}:{}),order:'order_id.asc',limit:100,offset:page*100});
    all.push(...rows);
    if(rows.length<100){complete=true;break;}
   }
   const orders=all.filter(row=>numericId(row.order_id)&&row.raw?.raw?.source==='DROPEA_PUBLIC_API_V2').map(row=>({orderId:String(row.order_id),canonicalOrderId:`dropea:${store.store_id}:${row.order_id}`,local:row}));
   issueIndex=null;
   if(orders.length){
    const client=createDropeaV2IncidentClient({token:store.token,market:store.market,maxReadRetries:0,timeoutMs:8000});
    const issues=await client.listAll('listIssues',{only_pending_to_resolve:true},{maxPages:3,maxRecords:300,requestedLimit:100});
    if(!issues.complete)throw Error('REMINDER_ISSUE_READ_INCOMPLETE');
    issueIndex={at:Date.now(),ids:new Set(issues.items.map(x=>String(x.order_id)))};
   }
   return {orders,complete};
  },
  async readContext(candidate){
   const store=stores();
   const order=await orderRead(candidate.orderId,{env,clientFactory:options=>createDropeaV2IncidentClient({...options,maxReadRetries:0,timeoutMs:8000})});
   if(!order||String(order.orderId)!==String(candidate.orderId)||String(order.raw?.store_id)!==store.store_id)throw Error('REMINDER_ORDER_IDENTITY_UNVERIFIED');
   const recent=await db('orders',{select:'order_id,status,confirmed_at,chatby_user_ns,raw',order_id:'eq.'+candidate.orderId,store_id:'eq.'+app.defaultStore.id,limit:2});
   if(recent.length!==1)throw Error('REMINDER_LOCAL_BINDING_UNVERIFIED');
   const local=recent[0];order.confirmedAt=local.confirmed_at;
   const initial=await db('template_delivery_ledger',{order_id:'eq.'+candidate.orderId,store_id:'eq.'+app.defaultStore.id,template_name:'in.(es_ES '+INITIAL_TEMPLATE+','+INITIAL_TEMPLATE+')',limit:3});
   const accepted=initial.filter(x=>['sent','already_seen','verified'].includes(String(x.status).toLowerCase())&&x.raw?.provider_message_id);
   const initialLedger=accepted.length===1?accepted[0]:null;
   const userNs=local.chatby_user_ns||initialLedger?.chatby_user_ns;
   if(!issueIndex||Date.now()-issueIndex.at>=120000){const client=createDropeaV2IncidentClient({token:store.token,market:store.market,maxReadRetries:0,timeoutMs:8000});const issues=await client.listAll('listIssues',{only_pending_to_resolve:true},{maxPages:3,maxRecords:300,requestedLimit:100});if(!issues.complete)throw Error('REMINDER_ISSUE_READ_INCOMPLETE');issueIndex={at:Date.now(),ids:new Set(issues.items.map(x=>String(x.order_id)))};}
   const workflow={verified:true,incidentActive:issueIndex.ids.has(String(candidate.orderId)),addressPending:local.status==='PENDING_ADDRESS_CHANGE'||local.raw?.addressPending===true||local.raw?.raw?.addressPending===true,importRecovery:local.raw?.importRecoveryPending===true||local.raw?.raw?.importRecoveryPending===true};
   if(!userNs)return {order,workflow,initialLedger,historyComplete:false,messages:[],subscriber:null};
   const subscriber=await getOrderReminderSubscriber(userNs);
   const anchor=purchaseAnchor(order);
   if(anchor===null)return {order,workflow,initialLedger,subscriber,historyComplete:false,messages:[]};
   const history=await getOrderReminderMessages(userNs,{sinceMs:anchor});
   return {order,workflow,initialLedger,subscriber,historyComplete:history.complete,messages:history.messages,checkedAt:new Date().toISOString()};
  },
  async verifyFreshOrder(expected){
   const store=stores(),fresh=await orderRead(expected.orderId,{env,clientFactory:options=>createDropeaV2IncidentClient({...options,maxReadRetries:0,timeoutMs:8000})});
   if(!fresh||String(fresh.orderId)!==String(expected.orderId)||String(fresh.raw?.store_id)!==store.store_id||fresh.status!=='PENDING'||fresh.raw?.status!=='PENDING'||fresh.raw?.sub_status!=='PENDING'||fresh.raw?.confirmed_at||purchaseAnchor(fresh)!==purchaseAnchor(expected)||exactPhone(fresh.customerPhone)!==exactPhone(expected.customerPhone))return false;
   const local=await db('orders',{select:'order_id,status,confirmed_at,raw',order_id:'eq.'+expected.orderId,store_id:'eq.'+app.defaultStore.id,limit:2});
   if(local.length!==1||local[0].confirmed_at||local[0].status==='PENDING_ADDRESS_CHANGE'||local[0].raw?.importRecoveryPending===true)return false;
   return Boolean(issueIndex&&Date.now()-issueIndex.at<120000&&!issueIndex.ids.has(String(expected.orderId))&&reminderHash(reminderParameters(fresh))===reminderHash(reminderParameters(expected)));
  },
  readTemplate:getOrderReminderTemplate,
  send:sendOrderConfirmationReminder,
  delivery:createReminderDeliveryStore({request,storeId:app.defaultStore.id}),
  status:{
   async get(){const rows=await db('app_state',{key:'eq.'+REMINDER_STATUS_KEY,limit:1});return rows[0]?.value||{};},
   async save(value){
    const sanitized={...value,results:value.results.map(({providerMessageId,...row})=>row)};
    await request('/rest/v1/app_state',{method:'POST',query:{on_conflict:'key'},headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:{key:REMINDER_STATUS_KEY,value:sanitized,updated_at:new Date().toISOString()},timeoutMs:10000});
   }
  }
 };
 return ports;
}
let runtime=null;
let lastReport=null;
export function orderReminderRuntime(){
 if(!runtime){const config=loadReminderConfig();runtime=createOrderReminderService({config,ports:createReminderPorts()});}
 return runtime;
}
export async function reminderPublicStatus(){
 const config=loadReminderConfig();
 if(!config.enabled)return {enabled:false,mode:'DISABLED',timer:REMINDER_TIMER,counts:{},owner:config.owner};
 try{const report=lastReport||(await orderReminderRuntime().status());return {enabled:true,mode:report.mode||'SHADOW',timer:REMINDER_TIMER,owner:config.owner,singleSenderVerified:report.singleSenderVerified===true,at:report.at||null,counts:report.counts||{},coverage:report.coverage||null,canary:report.canary?{state:report.canary.state,verifiedAt:report.canary.verifiedAt}:null,naturalCycles:report.naturalCycles||[]};}
 catch{return {enabled:true,mode:'SHADOW',timer:REMINDER_TIMER,owner:config.owner,state:'READ_UNAVAILABLE',counts:{}};}
}
export async function runOrderReminderScan(options={}){const report=await orderReminderRuntime().scan(options);if(!options.replay)lastReport=report;return report;}
export function reminderHealthStatus(){const cfg=loadReminderConfig();return {enabled:cfg.enabled,mode:cfg.enabled?(lastReport?.mode||'SHADOW'):'DISABLED',at:lastReport?.at||null};}
