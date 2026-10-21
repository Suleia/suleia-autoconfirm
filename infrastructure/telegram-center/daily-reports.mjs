const clean=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export function dailySettingsCommand(text,actor,config,store) {
 const t=clean(text);if(!/informe diario/.test(t))return null;
 store.state.dailyReportSettings||={};
 const old=store.state.dailyReportSettings[actor]||{enabled:config.dailyReportsEnabled===true,time:'23:55',format:'pdf'};
 const value={...old};
 if(/desactiva|desactivar|apaga|no enviar/.test(t))value.enabled=false;
 else if(/activa|activar|envia|enviar/.test(t))value.enabled=true;
 const at=/\b([01]\d|2[0-3]):([0-5]\d)\b/.exec(t);if(at)value.time=at[0];
 if(/imagen/.test(t))value.format='image';else if(/pdf/.test(t))value.format='pdf';
 if(/\d+:\d+/.test(t)&&!at)return {text:'Indica una hora válida HH:MM, Europe/Madrid.'};
 store.state.dailyReportSettings[actor]=value;store.save();
 return {text:`Informe diario ${value.enabled?'activado':'desactivado'} · ${value.time} Europe/Madrid · ${value.format==='image'?'imagen':'PDF'}.\nPuedes escribir «Desactiva el informe diario», «Activa el informe diario» o «Informe diario a las 23:55 en PDF». El cierre es provisional.`};
}
export class DailyReports {
 constructor({config,api,store,gateway,now=()=>Date.now()}){Object.assign(this,{config,api,store,gateway,now});this.busy=false;this.attempts=new Map();}
 async tick(){
  if(this.busy||!this.gateway)return;this.busy=true;
  try{
   const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(this.now())).map(x=>[x.type,x.value]));
   const day=`${parts.year}-${parts.month}-${parts.day}`,minute=Number(parts.hour)*60+Number(parts.minute);
   this.store.state.dailyReportDeliveries||={};
   for(const id of this.config.allowedUserIds){
    const settings=this.store.state.dailyReportSettings?.[id]||{enabled:this.config.dailyReportsEnabled===true,time:'23:55',format:'pdf'};
    const [h,m]=settings.time.split(':').map(Number),due=h*60+m,key=`${day}:${id}`;
    if(!settings.enabled||minute<due||minute>due+10||this.store.state.dailyReportDeliveries[key]||this.now()-(this.attempts.get(key)||0)<60000)continue;
    this.attempts.set(key,this.now());let result;
    try{result=await this.gateway.read({action:'daily-report',period:{preset:'custom',from:day,to:day},format:settings.format},{user:id,chat:id});if(!result.media)continue;}catch{continue;}
    // Persist before the first send. An uncertain send is never automatically repeated.
    this.store.state.dailyReportDeliveries[key]={state:'SENDING',at:new Date(this.now()).toISOString(),format:settings.format};this.store.save();
    try{await this.api.media(id,result.media);this.store.state.dailyReportDeliveries[key].state='SENT';}
    catch{this.store.state.dailyReportDeliveries[key].state='UNKNOWN';}
    this.store.save();
   }
  }finally{this.busy=false;}
 }
}
