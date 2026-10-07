import test from 'node:test';
import assert from 'node:assert/strict';
import {createSupportGmail,supportMime} from './discount-support-gmail.mjs';
const env={DISCOUNT_GMAIL_CLIENT_ID:'test',DISCOUNT_GMAIL_CLIENT_SECRET:'test',DISCOUNT_GMAIL_REFRESH_TOKEN:'test',DISCOUNT_GMAIL_FROM:'test@example.gmail.com'};
env.DISCOUNT_GMAIL_FROM='example@gmail.com';
const plan={key:'abc123',email:{to:'soporte@dropea.com',subject:'Aplicar descuento en pedido ES123',text:'Importe 24,99€. Prueba.'}};
const files=[{filename:'proof.png',mimeType:'image/png',bytes:Buffer.from('fixture-image')}];
test('MIME includes exact subject and byte-preserving attachment',()=>{
 const raw=Buffer.from(supportMime(plan,files,env.DISCOUNT_GMAIL_FROM),'base64url').toString();assert.match(raw,/Message-ID: <abc123@suleia.invalid>/);assert.ok(raw.includes(files[0].bytes.toString('base64')));assert.ok(raw.includes(Buffer.from(plan.email.text).toString('base64')));
});
function fake({corrupt=false,duplicate=false,wrongAccount=false}={}){
 const requests=[];const fetchImpl=async(url,options={})=>{requests.push([url,options.method]);let p;
  if(url.endsWith('/token'))p={access_token:'fake',expires_in:3600};
  else if(url.endsWith('/profile'))p={emailAddress:wrongAccount?'wrong@gmail.com':env.DISCOUNT_GMAIL_FROM};
  else if(url.includes('messages?q='))p={messages:duplicate?[{id:'prior'}]:[]};
  else if(url.endsWith('/messages/send'))p={id:'sent1'};
  else if(url.endsWith('/attachments/a1'))p={data:Buffer.from(corrupt?'wrong':'fixture-image').toString('base64url')};
  else p={labelIds:['SENT'],payload:{headers:[{name:'To',value:plan.email.to},{name:'From',value:env.DISCOUNT_GMAIL_FROM},{name:'Subject',value:plan.email.subject}],parts:[{mimeType:'text/plain',body:{data:Buffer.from(plan.email.text).toString('base64url')}},{filename:'proof.png',mimeType:'image/png',body:{attachmentId:'a1'}}]}};
  return {ok:true,json:async()=>p};};return {client:createSupportGmail({env,fetchImpl}),requests};
}
test('reads SENT body and actual attachment bytes after sending',async()=>{
 const f=fake();assert.equal(await f.client.send(plan,files),'sent1');assert.equal(await f.client.verify('sent1',plan,files),true);assert.ok(f.requests.some(([u])=>u.endsWith('/attachments/a1')));
});
test('changed attachment fails independent readback',async()=>assert.equal(await fake({corrupt:true}).client.verify('sent1',plan,files),false));
test('existing request or wrong mailbox blocks send',async()=>{
 for(const config of [{duplicate:true},{wrongAccount:true}]){const f=fake(config);await assert.rejects(f.client.send(plan,files));assert.ok(!f.requests.some(([u])=>u.endsWith('/messages/send')));}
});
