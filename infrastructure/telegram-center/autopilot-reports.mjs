const TIMES=['07:00','12:00','19:00','22:30','23:59'];
export class AutopilotReports {
  constructor({config,api,store,gateway,now=()=>Date.now()}){Object.assign(this,{config,api,store,gateway,now});this.busy=false;}
  async tick(){
    if(!this.config.autopilotReportsEnabled||!this.gateway||this.busy)return;
    const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(this.now()).map(x=>[x.type,x.value]));
    const time=`${p.hour}:${p.minute}`,day=`${p.year}-${p.month}-${p.day}`;
    const minute=Number(p.hour)*60+Number(p.minute);
    let due=TIMES.find(t=>{const [h,m]=t.split(':').map(Number);return minute>=h*60+m&&minute<=h*60+m+5;});
    let dueDay=day;
    if(!due&&minute<5){due='23:59';dueDay=new Date(Date.parse(day+'T12:00:00Z')-86400000).toISOString().slice(0,10);}
    if(!due)return;
    this.busy=true;
    try {
      this.store.state.autopilotDeliveries||={};
      for(const id of this.config.allowedUserIds){
        const key=`${dueDay}:${due}:${id}`;if(this.store.state.autopilotDeliveries[key])continue;
        let report;try{report=await this.gateway.read({action:'autopilot',cycleKey:`${dueDay}:${due}`},{user:id,chat:id});}catch{continue;}
        const cycle=report.autopilot?.slots.find(s=>s.slot_key===`${dueDay}:${due}`&&s.state!=='EXECUTING');
        if(!cycle||!report.autopilot.enabled||report.cycleKey!==`${dueDay}:${due}`||!report.cycleText)continue;
        this.store.state.autopilotDeliveries[key]={state:'SENDING',at:this.now()};this.store.save();
        try{await this.api.telegram('sendMessage',{chat_id:id,text:report.cycleText.slice(0,3900),disable_web_page_preview:true});this.store.state.autopilotDeliveries[key].state='SENT';}
        catch{this.store.state.autopilotDeliveries[key].state='UNKNOWN';}
        this.store.save();
      }
    }finally{this.busy=false;}
  }
}
