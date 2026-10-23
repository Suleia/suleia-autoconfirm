import {reviewWindow} from '../review/periods.mjs';
import {contentHash,buildExecutive} from './report.mjs';
import {dailySlot,nextExecution,localClock} from './schedule.mjs';
import {setTimeout as pause} from 'node:timers/promises';
export function createExecutiveService({review,ledger,accountId,readBudget=null,panelUrl=null,enabled=false,recipients=[],now=()=>Date.now(),sleep=pause,generationMs=180000}){
 const account=String(accountId).replace(/^act_/,'');if(!/^\d+$/.test(account))throw Error('ACCOUNT_INVALID');
 if(enabled&&(!panelUrl||!recipients.length))throw Error('EXECUTIVE_CONFIGURATION_INVALID');
 const allowed=new Set(recipients);if(recipients.some(x=>!/^\d+$/.test(x)))throw Error('EXECUTIVE_RECIPIENT_INVALID');
 const jobs=new Map();
 const dailyId=day=>contentHash(`executive:v8:${account}:${day}`);
 const requireId=id=>{if(!/^[a-f0-9]{64}$/.test(id||''))throw Error('QUERY_INVALID');};
 async function read(query,deadline){
  for(let i=0;i<30;i++){
   if(now()>=deadline)throw Error('EXECUTIVE_READ_TIMEOUT');
   try{
    const value=await review.report(query),code=value?.diagnostic?.code;
    // A retained snapshot can accompany an in-flight canonical refresh. Reuse
    // that bounded job instead of completing the report with its old cut.
    if(value?.freshness!=='FRESH'&&['ADS_REPORT_PREPARING','ADS_REPORT_BUSY','META_RATE_LIMITED','META_HTTP_429'].includes(code))throw Object.assign(Error(code),{code});
    return value;
   }catch(error){const code=error.code||error.message;if(!['ADS_REPORT_PREPARING','ADS_REPORT_BUSY','META_RATE_LIMITED','META_HTTP_429'].includes(code)||i===29)throw error;await sleep(Math.min(['META_RATE_LIMITED','META_HTTP_429'].includes(code)?60000:3000,Math.max(0,deadline-now())));}
  }
 }
 async function generate({id,lease,day,kind,query}){
  const failures=[],deadline=now()+generationMs;
  const get=async(name,q)=>{try{return await read(q,deadline);}catch{failures.push(name+'_UNAVAILABLE');return null;}};
  try{
   // Sequential windows respect the existing canonical client's concurrency and
   // share one snapshot for campaign/ad levels. No independent Meta client.
   const today=await get('CURRENT',{...query,period:query.period||'hoy',level:'campaign'});
   const week=await get('WEEK',{period:'7d',level:'campaign'});
   const ads=week?await get('ADS',{period:'7d',level:'ad'}):null;
   const month=await get('MONTH',{period:'30d',level:'campaign'});
   let budget=null;try{budget=readBudget?await readBudget():null;}catch{failures.push('BUDGET_AUDIT_UNAVAILABLE');}
   const valid=r=>r&&now()-Date.parse(r.observedAt)>=120000?{...r,freshness:'STALE',recommendations:[],rankings:[]}:r;
   const body=buildExecutive({today:valid(today),week:valid(week),ads:valid(ads),month:valid(month),budget,failures,targetDate:day,kind,generatedAt:new Date(now()).toISOString(),panelUrl,reportId:id});
   await ledger.complete(id,lease,body);
  }catch{await ledger.fail(id,lease);}finally{jobs.delete(id);}
 }
 async function prepare({kind='MANUAL',query={},principal='scheduler'}={}){
  if(!review)throw Error('ADS_REVIEW_DISABLED');
  const slot=dailySlot(now()),day=slot.day;
  if(kind==='DAILY'&&!enabled)throw Error('EXECUTIVE_DISABLED');
  if(kind==='DAILY'&&!slot.due){
   if(slot.missed){
    const id=dailyId(day),previous=await ledger.get(id,account);
    if(previous?.state==='READY'){
     const deliveries=await ledger.deliveries(id),complete=[...allowed].every(user=>previous.body.messages.every(m=>deliveries.some(d=>d.recipient===user&&d.part===m.part&&d.state==='SENT')));
     return {id,state:complete?'DELIVERED':'DELIVERY_INCOMPLETE',nextExecution:nextExecution(now()),metaWrites:0};
    }
    await ledger.missed({id,account,day,now:now()});
   }
   return {state:slot.missed?'MISSED':'NOT_DUE',nextExecution:nextExecution(now()),metaWrites:0};
  }
  // A manual audit never claims the scheduled report's id or delivery lanes.
  if(kind!=='DAILY'&&kind!=='MANUAL')throw Error('QUERY_INVALID');
  if(!query||typeof query!=='object'||Object.keys(query).some(k=>!['period','since','until'].includes(k)))throw Error('QUERY_INVALID');
  reviewWindow(query,now());
  if(jobs.size>=2)return {state:'BUSY',nextExecution:nextExecution(now()),metaWrites:0};
  const id=kind==='DAILY'?dailyId(day):contentHash(['manual',account,principal,query,Math.floor(now()/60000)]);
  const lease=await ledger.claim({id,account,day,kind,principal,now:now()});
  if(lease&&!jobs.has(id)){
   const task=generate({id,lease,day,kind,query});jobs.set(id,task);task.catch(()=>{});
  }
  return {id,...await detail(id),nextExecution:nextExecution(now()),metaWrites:0};
 }
 async function detail(id){requireId(id);const row=await ledger.get(id,account);if(!row)throw Error('NOT_FOUND');return {id,state:row.state,kind:row.kind,errorCode:row.error_code||null,attempts:row.attempts,body:row.body||null,deliveries:await ledger.deliveries(id),dailyEnabled:enabled,externalWrites:0};}
 async function command(body){
  const actor=body.actor;if(!actor||actor.user!==actor.chat||!allowed.has(actor.user))throw Error('ACTOR_UNAUTHORIZED');
  if(!enabled)throw Error('EXECUTIVE_DISABLED');
  if(body.operation==='due'){
   await ledger.expirePrior(account,localClock(now()).day);
   const value=await prepare({kind:'DAILY'});
   if(value.state!=='READY'||!dailySlot(now()).due)return {executive:value};
   const d=value.deliveries.filter(d=>d.recipient===actor.user);
   // Strict part ordering; UNKNOWN/SENDING stops further parts for this user.
   for(const m of value.body.messages){
    const previous=d.find(x=>x.part===m.part);if(previous?.state==='SENT')continue;
    const claim=await ledger.claimPart({id:value.id,recipient:actor.user,part:m.part,hash:m.hash,now:now()});
    return {executive:{id:value.id,state:claim?'SEND':'WAIT',message:claim?m:null,claim,recipient:actor.user,part:m.part,metaWrites:0}};
   }
   return {executive:{id:value.id,state:'DELIVERED',metaWrites:0}};
  }
  if(body.operation==='finish'){
   requireId(body.id);const row=await ledger.get(body.id,account);
   if(!row||row.kind!=='DAILY'||!Number.isInteger(body.part)||!row.body?.messages[body.part]||typeof body.claim!=='string'||body.claim.length>64||!['SENT','UNKNOWN','RETRY','REJECTED'].includes(body.state))throw Error('QUERY_INVALID');
   if(body.state==='SENT'&&(!Number.isSafeInteger(body.messageId)||body.messageId<=0))throw Error('EXECUTIVE_RECEIPT_REQUIRED');
   const result=await ledger.finishPart({id:body.id,recipient:actor.user,part:body.part,claim:body.claim,state:body.state,messageId:body.state==='SENT'?body.messageId:null,retrySeconds:Math.max(1,Math.min(1800,Number(body.retrySeconds)||60)),code:body.state==='RETRY'?'TELEGRAM_429':body.state==='UNKNOWN'?'TELEGRAM_RESULT_UNCERTAIN':body.state==='REJECTED'?'TELEGRAM_REJECTED':null});
   return {executive:{state:result?'RECORDED':'UNCHANGED',metaWrites:0}};
  }
  throw Error('QUERY_INVALID');
 }
 return {prepare,detail,command,history:async q=>({...await ledger.history(account,q),enabled,recipientsCount:allowed.size,nextExecution:nextExecution(now()),timezone:'Europe/Madrid',time:'22:30',recoveryWindow:'22:30–23:00',model:'DETERMINISTIC_EXISTING_REVIEW_AGENT',externalWrites:0}),pending:()=>Promise.allSettled([...jobs.values()])};
}
