import {createServer} from 'node:http';
import {createHash,timingSafeEqual} from 'node:crypto';
import {authorizeNativeAbsent} from './recipient-absent-native-gate.mjs';

const digest=value=>createHash('sha256').update(String(value)).digest();
export function createAbsentNativeHttpServer({token,readFresh,ledger,now}){
  if(typeof token!=='string' || token.length<32)throw new Error('NATIVE_GATE_AUTH_REQUIRED');
  const tokenHash=digest(`Bearer ${token}`);
  return createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
    const respond=(code,data)=>{if(!res.writableEnded){res.writeHead(code);res.end(JSON.stringify(data));}};
    if(req.url==='/health' && req.method==='GET')return respond(200,{ok:true,service:'recipient-absent-native-gate'});
    if(req.url!=='/absent/native/authorize' || req.method!=='POST')return respond(404,{allow:false});
    if(!timingSafeEqual(digest(req.headers.authorization || ''),tokenHash))return respond(401,{allow:false});
    let raw='';
    try{
      for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>4096)return respond(413,{allow:false});}
      const request=JSON.parse(raw);
      if(!request || !/^\d+$/.test(String(request.issue_id)) || !/^\d+$/.test(String(request.order_id))
        || typeof request.user_ns!=='string' || request.user_ns.length>100)return respond(400,{allow:false});
      const result=await authorizeNativeAbsent({readFresh,ledger,request,now});
      // Native flow must match EXACT prefix 201. No custom subscriber field is
      // used: a stale allow=true field cannot leak across concurrent triggers.
      return respond(result.allow?201:409,result);
    }catch{return respond(503,{allow:false,reason:'AUTHORIZATION_NOT_VERIFIED'});}
  });
}
