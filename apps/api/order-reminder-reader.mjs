const KEYS=['reminder_candidates','reminder_not_due','reminder_customer_responded','reminder_already_confirmed','reminder_initial_missing','reminder_blocked_incident','reminder_sent','reminder_verified','reminder_send_unknown','reminder_duplicate_prevented','eligible'];
const count=value=>Number.isSafeInteger(value)&&value>=0?value:null;
export function createOrderReminderReader({request,now=Date.now}={}){
 if(typeof request!=='function')return async()=>({available:false,state:'NOT_CONFIGURED',externalWrites:0});
 let cached=null,pending=null;
 return async()=>{
  if(cached&&now()-cached.at<15000)return cached.value;
  if(!pending)pending=(async()=>{
   try{
    const body=await request('/api/order-reminder/status',{method:'GET'}),r=body.reminder;
    if(body.ok!==true||!r||typeof r.enabled!=='boolean')throw Error('REMINDER_STATUS_INVALID');
    const observed=Date.parse(r.at),fresh=Number.isFinite(observed)&&observed<=now()&&now()-observed<15*60000;
    const value={available:true,enabled:r.enabled,mode:['LIVE','CANARY','SHADOW','DISABLED'].includes(r.mode)?r.mode:'SHADOW',state:r.enabled?(fresh?'FRESH':'STALE'):'DISABLED',at:Number.isFinite(observed)?new Date(observed).toISOString():null,singleSenderVerified:r.singleSenderVerified===true,counts:Object.fromEntries(KEYS.map(k=>[k,count(r.counts?.[k])])),coverage:r.coverage?{queried:count(r.coverage.queried),evaluated:count(r.coverage.evaluated),allEvaluated:r.coverage.allEvaluated===true}:null,canary:r.canary?{state:r.canary.state==='VERIFIED'?'VERIFIED':'PENDING',verifiedAt:Number.isFinite(Date.parse(r.canary.verifiedAt))?new Date(r.canary.verifiedAt).toISOString():null}:null,naturalCycles:Array.isArray(r.naturalCycles)?r.naturalCycles.slice(-3).map(c=>({at:Number.isFinite(Date.parse(c.at))?new Date(c.at).toISOString():null,mode:['LIVE','CANARY','SHADOW'].includes(c.mode)?c.mode:'SHADOW',verified:count(c.counts?.reminder_verified),unknown:count(c.counts?.reminder_send_unknown)})):[],source:'RENDER_ORDER_CONFIRMATION_REMINDER',externalWrites:0};
    cached={at:now(),value};return value;
   }catch{return {available:false,state:'READ_UNAVAILABLE',externalWrites:0};}
  })().finally(()=>{pending=null;});
  return pending;
 };
}
