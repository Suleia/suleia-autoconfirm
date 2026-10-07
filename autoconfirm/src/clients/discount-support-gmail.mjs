import crypto from 'node:crypto';
import {SUPPORT_TO} from '../workflows/accepted-discount-support.mjs';
const b64=s=>Buffer.from(s).toString('base64');
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
export function gmailSupportConfigured(env=process.env) {
 return ['DISCOUNT_GMAIL_CLIENT_ID','DISCOUNT_GMAIL_CLIENT_SECRET','DISCOUNT_GMAIL_REFRESH_TOKEN','DISCOUNT_GMAIL_FROM'].every(k=>Boolean(env[k]));
}
export function supportMime(plan,attachments,from) {
 if (!/^[a-zA-Z0-9._+-]+@gmail\.com$/.test(from)||plan.email.to!==SUPPORT_TO)throw Error('MAIL_IDENTITY_INVALID');
 const boundary='support_'+plan.key;
 const lines=[`From: ${from}`,`To: ${SUPPORT_TO}`,`Subject: =?UTF-8?B?${b64(plan.email.subject)}?=`,`Message-ID: <${plan.key}@suleia.invalid>`,
  'MIME-Version: 1.0',`Content-Type: multipart/mixed; boundary="${boundary}"`,'',`--${boundary}`,'Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',b64(plan.email.text)];
 for(const a of attachments)lines.push(`--${boundary}`,`Content-Type: ${a.mimeType}`,`Content-Disposition: attachment; filename="${a.filename}"`,'Content-Transfer-Encoding: base64','',a.bytes.toString('base64'));
 lines.push(`--${boundary}--`,'');return Buffer.from(lines.join('\r\n')).toString('base64url');
}
export function createSupportGmail({env=process.env,fetchImpl=fetch}={}) {
 let token=null,expires=0;
 async function access(){
  if(!gmailSupportConfigured(env))throw Error('GMAIL_NOT_CONFIGURED');
  if(token&&expires>Date.now()+60000)return token;
  const r=await fetchImpl('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:env.DISCOUNT_GMAIL_CLIENT_ID,client_secret:env.DISCOUNT_GMAIL_CLIENT_SECRET,refresh_token:env.DISCOUNT_GMAIL_REFRESH_TOKEN}),signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error('GMAIL_AUTH_FAILED');const p=await r.json();if(!p.access_token)throw Error('GMAIL_AUTH_INVALID');token=p.access_token;expires=Date.now()+Number(p.expires_in||300)*1000;return token;
 }
 async function api(path,method='GET',body){const r=await fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/'+path,{method,headers:{Authorization:`Bearer ${await access()}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('GMAIL_HTTP_'+r.status);return r.json();}
 async function identity(){const p=await api('profile');if(p.emailAddress!==env.DISCOUNT_GMAIL_FROM)throw Error('GMAIL_SENDER_MISMATCH');}
 return {
  ready:()=>gmailSupportConfigured(env),
  async check(){await identity();return true;},
  async send(plan,attachments){await identity();
   // Do not resend a previously sent support request, including manual requests.
   const q=`in:sent to:${SUPPORT_TO} subject:"${plan.email.subject}"`;
   const existing=await api('messages?q='+encodeURIComponent(q)+'&maxResults=10');
   if(existing.messages?.length)throw Error('EXISTING_SUPPORT_MAIL_RECONCILE');
   const sent=await api('messages/send','POST',{raw:supportMime(plan,attachments,env.DISCOUNT_GMAIL_FROM)});return sent.id;
  },
  async verify(id,plan,attachments){
   const m=await api('messages/'+encodeURIComponent(id)+'?format=full');
   const headers=Object.fromEntries((m.payload?.headers||[]).map(h=>[h.name.toLowerCase(),h.value]));
   if(!m.labelIds?.includes('SENT')||headers.to!==SUPPORT_TO||headers.from!==env.DISCOUNT_GMAIL_FROM||headers.subject!==plan.email.subject)return false;
   const parts=[];function walk(p){if(!p)return;parts.push(p);for(const c of p.parts||[])walk(c);}walk(m.payload);
   const text=parts.find(p=>p.mimeType==='text/plain');if(Buffer.from(text?.body?.data||'','base64url').toString('utf8')!==plan.email.text)return false;
   const files=parts.filter(p=>p.filename);if(files.length!==attachments.length)return false;
   for(const a of attachments){const part=files.find(p=>p.filename===a.filename&&p.mimeType===a.mimeType);if(!part)return false;
    const body=part.body?.attachmentId?await api(`messages/${encodeURIComponent(id)}/attachments/${encodeURIComponent(part.body.attachmentId)}`):part.body;
    if(digest(Buffer.from(body?.data||'','base64url'))!==digest(a.bytes))return false;
   }return true;
  }
 };
}
