// Scoped to the absent reader: other workflows retain their existing queries.
export async function readAbsentMessageHistory({transport,base,token,userNs,maxPages=10}) {
 const items=new Map();let end=null;
 for(let page=0;page<Math.min(maxPages,10);page++) {
  const url=new URL('/api/subscriber/chat-messages',base.origin);
  url.searchParams.set('user_ns',userNs);url.searchParams.set('include_bot','1');url.searchParams.set('limit','100');
  if(end!==null)url.searchParams.set('end_time',String(end));
  const response=await transport(url,{method:'GET',headers:{Accept:'application/json',Authorization:`Bearer ${token}`}});
  if(!response.ok){
   const error=new Error(`CHATBY_ABSENT_MESSAGES_HTTP_${response.status}`);error.code=`CHATBY_MESSAGES_HTTP_${response.status}`;
   if(response.status===429){const h=response.headers.get('retry-after'),seconds=Number(h),reset=Number(response.headers.get('x-ratelimit-reset'));
    error.retryNotBefore=Math.max(Date.now()+60000,h && Number.isFinite(seconds)?Date.now()+seconds*1000:Date.parse(h)||0,Number.isFinite(reset)?reset*1000:0);}
   throw error;
  }
  const payload=await response.json(),rows=payload?.data ?? payload;
  if(!Array.isArray(rows))throw Object.assign(new Error('CHATBY_ABSENT_MESSAGES_INVALID'),{code:'CHATBY_ABSENT_MESSAGES_INVALID'});
  for(const row of rows)items.set(String(row.mid || row.id || JSON.stringify(row)),row);
  if(rows.length<100)return {items:[...items.values()],complete:true,pages:page+1,reused_message_count:0};
  const times=rows.map(r=>Number(r.ts));if(times.some(t=>!Number.isInteger(t)||t<=0))break;
  const oldest=Math.min(...times);if(end!==null && oldest>=end)break;end=oldest;
 }
 throw Object.assign(new Error('CHATBY_ABSENT_HISTORY_INCOMPLETE'),{code:'CHATBY_ABSENT_HISTORY_INCOMPLETE'});
}
