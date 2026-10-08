import {timingSafeEqual} from 'node:crypto';
import {captureSupportEvidence} from './discount-support-capture.mjs';
import {createSupportGmail} from './discount-support-gmail.mjs';
import {validateSupportEvidence} from '../workflows/accepted-discount-support.mjs';

// Operator-only connection check. It cannot send mail or change an incident.
export function probeAuthorized(header, secret) {
 if (!secret) return false;
 const actual=Buffer.from(String(header||'')),expected=Buffer.from(`Bearer ${secret}`);
 return actual.length===expected.length&&timingSafeEqual(actual,expected);
}
export function validCaptureProbe(p) {
 return p&&['orderId','issueId','offerMessageId','acceptanceMessageId'].every(k=>/^[1-9]\d{0,19}$/.test(p[k]))
  && /^\+34[6789]\d{8}$/.test(p.phone||'')&&/^f\d+u\d+$/.test(p.conversationId||'')
  && typeof p.customerName==='string'&&p.customerName.length>0&&p.customerName.length<=200
  && typeof p.snapshot==='string'&&p.snapshot.length>0&&p.snapshot.length<=200
  && Number.isSafeInteger(p.finalCents)&&p.finalCents>0
  && Number.isFinite(Date.parse(p.offerAt))&&Date.parse(p.acceptedAt)>Date.parse(p.offerAt);
}
let busy=false;
export async function probeSupportConnections(plan,{env=process.env,capture=captureSupportEvidence,mail=createSupportGmail({env})}={}) {
 if(!validCaptureProbe(plan))throw Error('PROBE_INPUT_INVALID');
 if(busy)throw Error('PROBE_BUSY');
 busy=true;
 try {
  await mail.check();
  const evidence=await capture(plan,{env});
  if(!validateSupportEvidence(plan,evidence))throw Error('PROBE_EVIDENCE_INVALID');
  return {ok:true,gmailVerified:true,captureVerified:true,capturedAt:evidence.capturedAt,
   attachments:evidence.attachments.map(a=>({filename:a.filename,mimeType:a.mimeType,base64:a.bytes.toString('base64')}))};
 }finally{busy=false;}
}
