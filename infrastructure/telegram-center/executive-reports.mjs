// Runs inside the existing Telegram consumer. PostgreSQL owns daily/recipient
// claims; local fsynced receipts reconcile an ACK loss without a second send.
export class ExecutiveReports {
 constructor({config,api,store,gateway,now=()=>Date.now()}){Object.assign(this,{config,api,store,gateway,now});this.busy=false;this.nextTick=0;}
 async tick(){
  if(this.busy||!this.config.executiveReportsEnabled||!this.gateway?.executive||this.now()<this.nextTick)return;
  this.busy=true;this.nextTick=this.now()+15000;
  try{
   this.store.state.executiveReceipts||={};
   const recipients=this.config.executiveRecipientIds||[];
   for(const user of recipients){
    if(!this.config.allowedUserIds.includes(user))continue;
    const actor={user,chat:user};
    // Reconcile only a known transport result. A crash with no receipt remains
    // SENDING/UNKNOWN in the database and requires human review.
    for(const [key,r]of Object.entries(this.store.state.executiveReceipts).filter(([,r])=>r.user===user&&!r.acknowledged&&r.finish)){
     try{await this.gateway.executive({operation:'finish',...r.finish},actor);r.acknowledged=true;if(r.finish?.state==='RETRY')delete this.store.state.executiveReceipts[key];this.store.save();}catch{this.store.state.executiveHealth={ok:false,code:'EXECUTIVE_RECEIPT_ACK_PENDING',at:this.now()};this.store.save();}
    }
    for(let part=0;part<4;part++){
     let value;try{value=await this.gateway.executive({operation:'due'},actor);}catch{this.store.state.executiveHealth={ok:false,code:'EXECUTIVE_GATEWAY_UNAVAILABLE',at:this.now()};this.store.save();break;}
     if(value.state!=='SEND'){
      this.store.state.executiveHealth={ok:!['MISSED','FAILED','DELIVERY_INCOMPLETE'].includes(value.state),code:value.state,reportId:value.id||null,at:this.now()};this.store.save();break;
     }
     const key=`${value.id}:${user}:${value.part}`,m=value.message;
     if(this.store.state.executiveReceipts[key])break;
     // Persist intent before transport. No generic retry of a Telegram POST.
     const receipt={user,reportId:value.id,part:value.part,claim:value.claim,state:'SENDING',at:this.now()};
     this.store.state.executiveReceipts[key]=receipt;this.store.save();
     const finish={id:value.id,part:value.part,claim:value.claim,state:'UNKNOWN'};
     try{
      const sent=await this.api.telegram('sendMessage',{chat_id:user,text:m.text,parse_mode:'HTML',disable_web_page_preview:true,...(m.markup?{reply_markup:m.markup}:{})});
      if(!Number.isSafeInteger(sent?.message_id)||sent.message_id<=0)throw Error('TELEGRAM_RECEIPT_INVALID');
      finish.state='SENT';finish.messageId=sent.message_id;
     }catch(error){
      // 429 is an explicit rejection, safe for a bounded retry; network/5xx or
      // malformed successful replies are ambiguous and must not be replayed.
      if(error.service==='TELEGRAM'&&error.status===429){finish.state='RETRY';finish.retrySeconds=Math.max(1,Math.min(1800,error.retryAfter||60));}
      else if(error.service==='TELEGRAM'&&[400,401,403,404].includes(error.status))finish.state='REJECTED';
     }
     receipt.state=finish.state;receipt.finish=finish;this.store.save();
     try{await this.gateway.executive({operation:'finish',...finish},actor);receipt.acknowledged=true;this.store.save();}catch{break;}
     if(finish.state==='RETRY'){
      // The durable SQL retry timestamp/attempt cap remains authoritative.
      delete this.store.state.executiveReceipts[key];this.store.save();break;
     }
     if(finish.state!=='SENT')break;
    }
   }
  }finally{this.busy=false;}
 }
}
