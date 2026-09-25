import {createServer} from 'node:http';
import {createHash,timingSafeEqual} from 'node:crypto';
import {authorizeNativeAbsent} from './recipient-absent-native-gate.mjs';

const digest=value=>createHash('sha256').update(String(value)).digest();
export function createAbsentNativeHttpServer({token,readFresh,ledger,now,health=async()=>true,enabled=async()=>true,
  audit=()=>{},rateLimit=12,rateWindowMs=60000,clock=Date.now}){
  if(typeof token!=='string' || token.length<32)throw new Error('NATIVE_GATE_AUTH_REQUIRED');
  const tokenHash=digest(`Bearer ${token}`);
  let windowStart=clock(),requests=0,inflight=false;
  return createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
    const respond=(code,data)=>{if(!res.writableEnded){
      // Never log request bodies, credentials, conversation IDs or provider errors.
      try{audit({event:'absent_native_http',status:code});}catch{}
      res.writeHead(code);res.end(JSON.stringify(data));}};
    if(req.url==='/health' && req.method==='GET'){
      try{const ok=await health();return respond(ok?200:503,{ok:Boolean(ok),service:'recipient-absent-native-gate'});}
      catch{return respond(503,{ok:false,service:'recipient-absent-native-gate'});}
    }
    if(req.url!=='/absent/native/authorize' || req.method!=='POST')return respond(404,{allow:false});
    if(!timingSafeEqual(digest(req.headers.authorization || ''),tokenHash))return respond(401,{allow:false});
    if(clock()-windowStart>=rateWindowMs){windowStart=clock();requests=0;}
    if(++requests>rateLimit || inflight){res.setHeader('Retry-After','60');return respond(429,{allow:false,reason:'RATE_LIMITED'});}
    inflight=true;
    let raw='';
    try{
      if(!await enabled())return respond(409,{allow:false,reason:'NATIVE_SEND_DISABLED'});
      for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>4096)return respond(413,{allow:false});}
      const request=JSON.parse(raw);
      const issueSupplied=request?.issue_id!==undefined && request?.issue_id!==null && request?.issue_id!=='';
      if(!request || (issueSupplied && !/^\d+$/.test(String(request.issue_id))) || !/^\d+$/.test(String(request.order_id))
        || typeof request.user_ns!=='string' || request.user_ns.length>100)return respond(400,{allow:false});
      const result=await authorizeNativeAbsent({readFresh,ledger,request,now});
      // Native flow must match EXACT prefix 201. No custom subscriber field is
      // used: a stale allow=true field cannot leak across concurrent triggers.
      return respond(result.allow?201:409,result);
    }catch{return respond(503,{allow:false,reason:'AUTHORIZATION_NOT_VERIFIED'});}
    finally{inflight=false;}
  });
}
