import {setTimeout as delay} from 'node:timers/promises';
// One existing poller. SQL owns claims; the local fsynced result closes an ACK
// loss without sending twice. Never retry an ambiguous Telegram response.
export class OrderAlertNotifications {
 constructor({config,api,store,gateway,signal,now=()=>Date.now(),pause=ms=>delay(ms)}){Object.assign(this,{config,api,store,gateway,signal,now,pause});this.busy=false;this.nextTick=0;}
 async tick(){
  if(this.busy||!this.config.orderAlertsEnabled||!this.gateway?.orderAlerts||this.signal?.aborted||this.now()<this.nextTick)return;
  this.busy=true;this.nextTick=this.now()+15000;let failure=null;
  try{
   this.store.state.orderAlertReceipts||={};
   for(const user of this.config.allowedUserIds){
    if(this.signal?.aborted)break;
    const actor={user,chat:user};let acknowledged=true;
    for(const [id,r]of Object.entries(this.store.state.orderAlertReceipts).filter(([,r])=>r.user===user)){
     if(!r.finish){r.finish={operation:'finish',id,claim:r.claim,state:'UNKNOWN'};this.store.save();}
     try{await this.gateway.orderAlerts(r.finish,actor);delete this.store.state.orderAlertReceipts[id];this.store.save();}
     catch{acknowledged=false;this.store.state.orderAlertHealth=failure={ok:false,code:'ACK_PENDING',at:this.now()};this.store.save();break;}
    }
    if(!acknowledged)continue;
    for(let i=0;i<5&&!this.signal?.aborted;i++){
     let due;try{due=await this.gateway.orderAlerts({operation:'due'},actor);}catch{this.store.state.orderAlertHealth=failure={ok:false,code:'SOURCE_UNAVAILABLE',at:this.now()};this.store.save();break;}
     if(due.state!=='SEND'){this.store.state.orderAlertHealth={ok:true,code:due.state,at:this.now()};this.store.save();break;}
     if(!/^[a-f0-9]{64}$/.test(due.id||'')||!/^[a-f0-9-]{36}$/.test(due.claim||'')||typeof due.text!=='string'||due.text.length>3500)throw Error('ORDER_ALERT_CONTRACT_INVALID');
     const receipt={user,claim:due.claim,state:'SENDING',at:this.now()};this.store.state.orderAlertReceipts[due.id]=receipt;this.store.save();
     const finish={operation:'finish',id:due.id,claim:due.claim,state:'UNKNOWN'};
     try{
      const sent=await this.api.telegram('sendMessage',{chat_id:user,text:due.text,parse_mode:'HTML',disable_notification:false,disable_web_page_preview:true});
      if(!Number.isSafeInteger(sent?.message_id)||sent.message_id<=0)throw Error('TELEGRAM_RECEIPT_INVALID');
      finish.state='SENT';finish.messageId=sent.message_id;
     }catch(e){
      if(e.service==='TELEGRAM'&&e.status===429){finish.state='RETRY';finish.retrySeconds=Math.max(1,Math.min(1800,e.retryAfter||60));}
      else if(e.service==='TELEGRAM'&&[400,401,403,404].includes(e.status))finish.state='REJECTED';
     }
     receipt.finish=finish;receipt.state=finish.state;this.store.save();
     try{await this.gateway.orderAlerts(finish,actor);delete this.store.state.orderAlertReceipts[due.id];this.store.save();}catch{this.store.state.orderAlertHealth=failure={ok:false,code:'ACK_PENDING',at:this.now()};this.store.save();break;}
     this.store.state.orderAlertHealth={ok:finish.state==='SENT',code:finish.state,at:this.now()};this.store.save();
     if(finish.state!=='SENT'){failure=this.store.state.orderAlertHealth;break;}
     await this.pause(1100);
    }
   }
  }finally{if(failure){this.store.state.orderAlertHealth=failure;this.store.save();}this.busy=false;}
 }
}
