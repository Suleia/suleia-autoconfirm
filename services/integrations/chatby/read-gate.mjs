import{createHash}from'node:crypto';
const scopes=new WeakMap();
const delay=ms=>new Promise(r=>setTimeout(r,ms));
export function chatbyRetryDeadline(headers,now){
 const raw=headers.get('retry-after'),seconds=raw===null?NaN:Number(raw),date=Number.isFinite(seconds)?NaN:Date.parse(raw||'');
 const resetRaw=headers.get('x-ratelimit-reset')??headers.get('ratelimit-reset'),reset=resetRaw===null?NaN:Number(resetRaw);
 const resetAt=Number.isFinite(reset)?reset>1e12?reset:reset>1e9?reset*1000:now+reset*1000:Date.parse(resetRaw||'');
 return Math.max(now+60000,Number.isFinite(seconds)?now+seconds*1000:date||0,resetAt||0);
}
export function createChatbyReadGate({fetchImpl=globalThis.fetch,now=Date.now,wait=delay,minRequestIntervalMs=1500}={}){
 let queue=Promise.resolve(),nextAt=0,retryNotBefore=0;const pending=new Map();
 const throttled=()=>Object.assign(Error('CHATBY_READ_RATE_LIMITED'),{code:'CHATBY_READ_HTTP_429',retryNotBefore});
 return function read(url,options={}){
  const method=String(options.method||'GET').toUpperCase();if(!['GET','HEAD'].includes(method)||options.body!=null)throw Error('CHATBY_READ_ONLY_REQUIRED');
  const key=createHash('sha256').update(JSON.stringify([method,String(url),new Headers(options.headers).get('authorization')])).digest('hex');
  let job=pending.get(key);
  if(!job){
   job=queue.catch(()=>{}).then(async()=>{
    if(now()<retryNotBefore)throw throttled();
    const pacing=Math.max(0,nextAt-now());if(pacing)await wait(pacing);
    if(now()<retryNotBefore)throw throttled();if(options.signal?.aborted)throw Object.assign(Error('CHATBY_READ_ABORTED_BEFORE_REQUEST'),{name:'AbortError'});
    try{const response=await fetchImpl(url,options);if(response.status===429)retryNotBefore=Math.max(retryNotBefore,chatbyRetryDeadline(response.headers,now()));return response;}
    finally{nextAt=now()+Math.max(0,minRequestIntervalMs);}
   });
   pending.set(key,job);queue=job.catch(()=>{});job.finally(()=>{if(pending.get(key)===job)pending.delete(key);}).catch(()=>{});
  }
  // Every consumer gets its own stream. Completed responses are never cached.
  return job.then(response=>response.clone());
 };
}
export function sharedChatbyReader(scope,{fetchImpl=globalThis.fetch,...options}={}){
 const identity=scope||fetchImpl;let clients=scopes.get(identity);if(!clients){clients=new WeakMap();scopes.set(identity,clients);}
 let read=clients.get(fetchImpl);if(!read){read=createChatbyReadGate({fetchImpl,...options});clients.set(fetchImpl,read);}return read;
}
