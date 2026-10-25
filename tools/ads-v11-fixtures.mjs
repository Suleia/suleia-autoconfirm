// Controlled synthetic Graph transport for QA. No credentials or external calls.
export function createV11GraphFixture({delayMs=20,now=()=>Date.now(),rateLimit=false}={}){
 const calls=[];let active=0,maxActive=0,limited=rateLimit;
 const campaigns=Array.from({length:5},(_,i)=>({id:String(101+i),account_id:'9',name:['DEMO · Colágeno dental','DEMO · NIDA','DEMO · Seoul','DEMO · Prospección','DEMO · Retargeting'][i],status:'ACTIVE',effective_status:'ACTIVE',daily_budget:String(2500+i*500),lifetime_budget:'0',objective:'OUTCOME_SALES',created_time:'2026-01-01T00:00:00Z',updated_time:'2026-08-01T00:00:00Z'}));
 const sets=campaigns.map((c,i)=>({id:String(201+i),campaign_id:c.id,name:'DEMO · Conjunto '+(i+1),status:'ACTIVE',effective_status:'ACTIVE',optimization_goal:'OFFSITE_CONVERSIONS',learning_stage_info:{status:'SUCCESS'},created_time:c.created_time,updated_time:c.updated_time}));
 const ads=campaigns.map((c,i)=>({id:String(301+i),campaign_id:c.id,adset_id:sets[i].id,name:'DEMO · Creatividad '+(i+1),status:'ACTIVE',effective_status:'ACTIVE',created_time:c.created_time,updated_time:c.updated_time,creative:{id:String(401+i),thumbnail_url:'/__fixture-creative/'+(401+i)}}));
 const shift=(d,n)=>new Date(Date.parse(d+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
 function insight(level,c,index,since,until){
  const days=(Date.parse(until)-Date.parse(since))/86400000+1,mod=(Date.parse(since)/86400000)%11;
  const daily=10+index*3+(mod+11)%3,purchases=(index===3?1:index===2?2:4)*days;
  return {account_id:'9',campaign_id:c.id,campaign_name:c.name,...(level!=='campaign'?{adset_id:sets[index].id,adset_name:sets[index].name}:{}),...(level==='ad'?{ad_id:ads[index].id,ad_name:ads[index].name}:{}),date_start:since,date_stop:until,spend:String(daily*days),impressions:String((daily*100)*days),reach:String(daily*70*days),frequency:'1.43',inline_link_clicks:String(daily*5*days),outbound_clicks:[{action_type:'outbound_click',value:String(daily*4*days)}],actions:[['offsite_conversion.fb_pixel_purchase',purchases],['landing_page_view',daily*3*days],['offsite_conversion.fb_pixel_add_to_cart',daily*days],['offsite_conversion.fb_pixel_initiate_checkout',Math.max(purchases,daily*days-2)]].map(([action_type,value])=>({action_type,value:String(value)})),action_values:[{action_type:'offsite_conversion.fb_pixel_purchase',value:String(purchases*30)}]};
 }
 async function fetchImpl(url,options={}){
  const u=new URL(url);calls.push({path:u.pathname,level:u.searchParams.get('level'),daily:u.searchParams.get('time_increment')==='1',range:u.searchParams.get('time_range'),method:options.method||'GET'});active++;maxActive=Math.max(maxActive,active);
  try{
   if(delayMs)await new Promise((resolve,reject)=>{const t=setTimeout(resolve,delayMs);options.signal?.addEventListener('abort',()=>{clearTimeout(t);reject(new DOMException('aborted','AbortError'));},{once:true});});
   if(limited)return new Response(JSON.stringify({error:{code:17,error_subcode:2446079,is_transient:false}}),{status:400,headers:{'Retry-After':'60','x-ad-account-usage':'{"acc_id_util_pct":100}'}});
   let result={data:[]};const path=u.pathname;
   if(path.endsWith('/act_9'))result={id:'act_9',currency:'EUR',timezone_name:'Europe/Madrid',account_status:1};
   else if(path.endsWith('/campaigns'))result={data:campaigns};
   else if(path.endsWith('/adsets'))result={data:sets};
   else if(path.endsWith('/ads'))result={data:ads};
   else if(path.endsWith('/insights')){
    const range=JSON.parse(u.searchParams.get('time_range')),level=u.searchParams.get('level')||'campaign';
    if(level==='account')result={data:[{account_id:'9',date_start:range.since,date_stop:range.until,spend:'120'}]};
    else{const periods=[];if(u.searchParams.get('time_increment')==='1')for(let d=range.since;d<=range.until;d=shift(d,1))periods.push({since:d,until:d});else periods.push(range);
     result={data:periods.flatMap(p=>campaigns.map((c,i)=>insight(level,c,i,p.since,p.until)))};
    }
   }
   return new Response(JSON.stringify(result),{status:200,headers:{'x-app-usage':'{"call_count":8,"total_cputime":6,"total_time":7}','Content-Type':'application/json'}});
  }finally{active--;}
 }
 return {fetchImpl,calls,campaigns,sets,ads,setLimited:v=>{limited=v;},stats:()=>({requests:calls.length,insights:calls.filter(c=>c.path.endsWith('/insights')).length,maxConcurrent:maxActive,mutations:calls.filter(c=>c.method!=='GET').length,externalConnections:0,at:new Date(now()).toISOString()})};
}
