import { createHmac, timingSafeEqual } from 'node:crypto';
export function signAdsBridge(secret,timestamp,body){return createHmac('sha256',createHmac('sha256',secret).update('suleia:ads-bridge:v3').digest()).update(`${timestamp}.${body}`).digest('hex');}
export function verifyAdsBridge(secret,timestamp,body,signature,now=Date.now()){
  if(!secret||!/^\d{13}$/.test(timestamp||'')||Math.abs(now-Number(timestamp))>30000||!/^[a-f0-9]{64}$/.test(signature||''))return false;
  return timingSafeEqual(Buffer.from(signAdsBridge(secret,timestamp,body)),Buffer.from(signature));
}
