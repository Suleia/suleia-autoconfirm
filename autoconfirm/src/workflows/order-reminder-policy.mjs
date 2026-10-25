import {createHash} from 'node:crypto';

export const REMINDER_TEMPLATE='dropea_pedido_reminder_v1';
export const INITIAL_TEMPLATE='dropea_pedido_nuevo_v1';
export const REMINDER_LOCALE='es_ES';
export const REMINDER_OWNER='render_order_reminder';
export const REMINDER_JOB='ORDER_CONFIRMATION_REMINDER_SCAN';
export const REMINDER_TIMER='ORDER_CONFIRMATION_REMINDER_2H';
export const REMINDER_COMPONENT_HASH='aedc6d5323134e060b06332a0ce67e47dacad3c53efb2f0f2c636347d1f165fc';
export const REMINDER_BUTTON_HASH='a1747e6a5ddee303e8ef3de475ce56d65a1f4a0cc8853b9c5ee6dd4fc457d8c9';
export const REMINDER_TERMINAL=new Set(['CLAIMED','SENDING','SEND_UNKNOWN','SEND_REJECTED','VERIFIED']);
export const reminderHash=value=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
function stable(value){return Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value;}
function deliveryContent(value){return Array.isArray(value)?value.map(deliveryContent):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>!['example','examples'].includes(key)).map(([key,v])=>[key,deliveryContent(v)])):value;}
export function reminderKey(id){if(!/^[A-Za-z0-9:_-]{1,160}$/.test(String(id)))throw Error('REMINDER_CANONICAL_ID_INVALID');return `ORDER_REMINDER:${id}:${REMINDER_TEMPLATE}`;}
export function numericId(value){const m=String(value??'').trim().match(/^(?:ES|#)?(\d+)$/i);return m?m[1]:null;}
export function instant(value){if(typeof value!=='string'||!/(?:Z|[+-]\d\d:\d\d)$/.test(value))return null;const n=Date.parse(value);return Number.isFinite(n)?n:null;}
export function purchaseAnchor(order){
 const raw=order?.raw||{};
 // Local first-seen/updated timestamps are deliberately excluded.
 const external=raw.external_created_at;
 if(external!=null&&external!=='')return instant(external);
 return instant(raw.created_at);
}
export function exactPhone(value){let n=String(value??'').replace(/\D/g,'');if(n.startsWith('00'))n=n.slice(2);if(/^\d{9}$/.test(n))n='34'+n;return /^34\d{9}$/.test(n)?n:null;}
export function messageAt(message){const n=Number(message?.ts);return Number.isInteger(n)&&n>0?n*1000:null;}
export function providerTemplate(message){return message?.payload?.name||message?.payload?.template?.name||message?.template?.name||null;}
export function approvedReminder(row){
 let components=row?.components;if(typeof components==='string'){try{components=JSON.parse(components);}catch{return false;}}
 const quick=Object.fromEntries(Object.entries(row?.default_values?.params||{}).filter(([k])=>k.startsWith('QUICK_REPLY_')));
 return row?.name===REMINDER_TEMPLATE&&row?.language===REMINDER_LOCALE&&row?.status==='APPROVED'&&row?.category==='UTILITY'
  &&String(row.id)==='1472493'&&String(row.wa_template_id)==='1344752647520812'
  &&row.default_values?.lang===REMINDER_LOCALE&&typeof row.namespace==='string'&&Boolean(row.namespace)
  &&reminderHash(deliveryContent(components))===REMINDER_COMPONENT_HASH&&reminderHash(quick)===REMINDER_BUTTON_HASH;
}
export function reminderParameters(order){
 const raw=order.raw||{},shipping=raw.shipping_address||{};
 const amount=Number(raw.total_amount);
 if(raw.currency!=='EUR'||raw.payment_method!=='COD'||!Number.isFinite(amount)||amount<=0)throw Error('REMINDER_ORDER_DATA_UNVERIFIABLE');
 const street=[shipping.address_line_1,shipping.address_line_2].filter(v=>typeof v==='string'&&v.trim()).join(', ').trim();
 const city=String(shipping.city||'').trim(),zip=String(shipping.postal_code||'').trim();
 if(!street||!city||!/^\d{5}$/.test(zip)||!exactPhone(shipping.phone_number))throw Error('REMINDER_ORDER_DATA_UNVERIFIABLE');
 return {'BODY_{{1}}':new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(amount),'BODY_{{2}}':street,'BODY_{{3}}':city,'BODY_{{4}}':zip};
}
export function confirmationOrderField(subscriber){
 const values=(subscriber?.user_fields||[]).filter(x=>/^(?:#?pedido|id[ _-]?pedido|dropea\s*:\s*(?:n[uú]mero|numero|pedido))$/i.test(String(x.name||'').trim())).map(x=>numericId(x.value));
 return values.length&&values.every(x=>x&&x===values[0])?values[0]:null;
}
export function initialProof({order,subscriber,messages,initialLedger}){
 const id=numericId(order.orderId),created=purchaseAnchor(order),ledger=initialLedger;
 if(!ledger||numericId(ledger.order_id)!==id||String(ledger.template_name||'').replace(/^es_ES\s+/,'')!==INITIAL_TEMPLATE
  ||!['sent','already_seen','verified'].includes(String(ledger.status).toLowerCase())||!ledger.raw?.provider_message_id)return null;
 const mid=ledger.raw.provider_message_id,rows=messages.filter(m=>m.mid===mid);
 if(rows.length!==1)return null;
 const row=rows[0],sent=messageAt(row),ledgerSent=instant(ledger.sent_at);
 if(row.type!=='out'||!String(mid).startsWith('wamid.')||providerTemplate(row)!==INITIAL_TEMPLATE||sent===null||ledgerSent!==sent||created===null||sent<created
  ||String(row.user_ns)!==String(subscriber.user_ns)||String(ledger.chatby_user_ns)!==String(subscriber.user_ns))return null;
 return {messageId:mid,sentAt:new Date(sent).toISOString(),sentMs:sent};
}
export function evaluateReminder(context,{now=Date.now(),lookbackHours=48}={}){
 const {order,subscriber,messages=[],historyComplete,initialLedger,workflow,delivery}=context;
 const created=purchaseAnchor(order),due=created===null?null:created+7200000;
 const result={state:'CHATBY_NOT_VERIFIABLE',reason:'BLOCKED_CHATBY_READ',dueAt:due===null?null:new Date(due).toISOString(),createdAt:created===null?null:new Date(created).toISOString(),customerActivityAfterInitial:null,confirmedAtCheck:order?.confirmedAt||order?.raw?.confirmed_at||null};
 const block=(state,reason=state)=>({...result,state,reason});
 if(REMINDER_TERMINAL.has(delivery?.status))return block('REMINDER_ALREADY_SENT',delivery.status);
 if(!order||!numericId(order.orderId)||order.raw?.source!=='DROPEA_PUBLIC_API_V2'||created===null||created>now)return block('ORDER_NOT_VERIFIABLE');
 if(created<=now-lookbackHours*3600000)return block('OUTSIDE_LOOKBACK');
 if(order.confirmedAt||order.raw.confirmed_at||['CONFIRMED','PROCESSING','PREPARING','PREPARED','SHIPPING','IN_TRANSIT','TRANSIT','DELIVERED'].includes(order.status))return block('ALREADY_CONFIRMED','ORDER_NOT_PENDING_CONFIRMATION');
 if(order.status!=='PENDING'||order.raw.status!=='PENDING'||order.raw.sub_status!=='PENDING')return block('ORDER_NOT_PENDING','ORDER_NOT_PENDING_CONFIRMATION');
 if(workflow?.incidentActive)return block('INCIDENT_ACTIVE');
 if(workflow?.addressPending||workflow?.importRecovery||order.addressPending||order.status==='PENDING_ADDRESS_CHANGE')return block('OTHER_WORKFLOW_ACTIVE');
 if(workflow?.verified!==true)return block('WORKFLOW_NOT_VERIFIABLE');
 if(!subscriber||!historyComplete||confirmationOrderField(subscriber)!==numericId(order.orderId)
  ||!exactPhone(order.customerPhone)||exactPhone(subscriber.phone||subscriber.user_id)!==exactPhone(order.customerPhone)
  ||(subscriber.phone&&subscriber.user_id&&exactPhone(subscriber.phone)!==exactPhone(subscriber.user_id)))return block('CHATBY_NOT_VERIFIABLE');
 const initial=initialProof(context);
 if(!initial)return block('INITIAL_TEMPLATE_NOT_VERIFIED');
 result.initialTemplateSentAt=initial.sentAt;result.initialMessageId=initial.messageId;
 const after=messages.filter(m=>{const at=messageAt(m);return at===null||at>=initial.sentMs;});
 if(after.some(m=>!['in','out','agent','note','system'].includes(m.type)||messageAt(m)===null||messageAt(m)>now))return block('CHATBY_NOT_VERIFIABLE','ACTIVITY_HISTORY_UNVERIFIABLE');
 if(after.some(m=>m.type==='in'))return {...block('CUSTOMER_RESPONDED'),customerActivityAfterInitial:true};
 result.customerActivityAfterInitial=false;
 const seen=after.filter(m=>providerTemplate(m)===REMINDER_TEMPLATE);
 if(seen.length)return block('REMINDER_ALREADY_SENT','REMINDER_OBSERVED_IN_PROVIDER');
 if(now<due)return block('NOT_DUE');
 try{result.parameterHash=reminderHash(reminderParameters(order));}catch{return block('ORDER_DATA_NOT_VERIFIABLE');}
 return {...result,state:'ELIGIBLE',reason:'SILENT_PENDING_ORDER_DUE'};
}
