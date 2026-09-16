// Owner-scoped GET-only audit in the trusted worker. No identifiers/text/secrets
// leave the approved infrastructure; never sends or changes a customer record.
const id = process.env.AUDIT_ISSUE_ID;
if (!/^\d+$/.test(id || '')) throw new Error('EXACT_PRIVATE_CASE_REQUIRED');
const source = new URL(process.env.SUPABASE_URL);
if(source.protocol!=='https:' || !source.hostname.endsWith('.supabase.co')) throw new Error('SOURCE_HOST_NOT_ALLOWED');
const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
const query=new URLSearchParams({select:'raw',incidence_id:`eq.${id}`,limit:'1'});
const response=await fetch(`${source.origin}/rest/v1/incidents?${query}`,{method:'GET',redirect:'error',headers:{apikey:key,Authorization:`Bearer ${key}`}});
if(!response.ok) throw new Error(`PRIVATE_SOURCE_HTTP_${response.status}`);
const row=(await response.json())[0];
const raw=typeof row?.raw==='string'?JSON.parse(row.raw):row?.raw;
if(!raw) throw new Error('PRIVATE_CASE_NOT_PRESENT');
const ns=raw.chatbyUserNs;
console.log(JSON.stringify({case:'OWNER_REPORTED_CASE',subscriber_reference_available:Boolean(ns)}));
if(!ns) process.exit(0);
const headers={Authorization:`Bearer ${process.env.CHATBY_TOKEN}`,Accept:'application/json'};
const info=await fetch(`https://app.chatby.io/api/subscriber/get-info?${new URLSearchParams({user_ns:ns})}`,{method:'GET',redirect:'error',headers});
if(!info.ok) throw new Error(`CHATBY_READ_HTTP_${info.status}`);
const subscriber=(await info.json()).data;
const {chatbyReadOnlyInternals:parse}=await import('../services/integrations/chatby/readonly-sync.mjs');
const refs=parse.technicalReferences(subscriber);
if(!refs.some(r=>[String(raw.orderId),String(raw.externalOrderId)].includes(r.reference))) throw new Error('CURRENT_CASE_SUBSCRIBER_IDENTITY_NOT_VERIFIED');
const messagesResponse=await fetch(`https://app.chatby.io/api/subscriber/chat-messages?${new URLSearchParams({user_ns:ns})}`,{method:'GET',redirect:'error',headers});
if(!messagesResponse.ok) throw new Error(`CHATBY_READ_HTTP_${messagesResponse.status}`);
const payload=await messagesResponse.json();
const messages=Array.isArray(payload?.data)?payload.data:[];
console.log(JSON.stringify({verified_current_contact:true,read_at:new Date().toISOString(),returned_messages:messages.length,
  provider_pagination_declared:Boolean(payload.meta || payload.links),messages:messages.map(m=>({at:parse.occurredAt(m),direction:parse.direction(m),
    type:parse.messageType(m),template:m.msg_type==='template'?m.payload?.name||parse.templateSlug(m):null,intent:parse.direction(m)==='INBOUND'?parse.classifyIntent(m):null}))}));
