import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareAbsentTemplateApproval } from './absent-template-admin.mjs';
import { absentTemplatePayload } from '../../../packages/platform-core/src/incident/absent-template.mjs';
const response = data => new Response(JSON.stringify(data),{status:200});
test('approval creation is administrative only, exactly once, then exact roundtrip checked', async () => {
  const calls=[]; let created=false;
  const fetchImpl=async(url,options)=>{
    calls.push(new URL(url).pathname);
    if (url.endsWith('/create')) { assert.deepEqual(JSON.parse(options.body),absentTemplatePayload()); created=true; return response({status:'success'}); }
    return response({data:created?[{...absentTemplatePayload(),id:1,wa_template_id:'meta-fixture',status:'PENDING'}]:[]});
  };
  const r=await prepareAbsentTemplateApproval({token:'fixture',fetchImpl,submit:true});
  assert.deepEqual(calls,['/api/whatsapp-template/list','/api/whatsapp-template/create','/api/whatsapp-template/list']);
  assert.equal(r.content_roundtrip_verified,true); assert.equal(r.approval_status,'PENDING');
  assert.equal(r.customer_messages_sent,0); assert.equal(r.live_flags.CHATBY_REAL_SENDS,false);
});
test('same exact approved template reused; approval cannot activate customer sends', async()=>{
  let calls=0;
  const r=await prepareAbsentTemplateApproval({token:'fixture',submit:true,fetchImpl:async(url)=>{calls++; assert.match(url,/\/list\?/); return response({data:[{...absentTemplatePayload(),status:'APPROVED',id:1}]});}});
  assert.equal(calls,1); assert.equal(r.reused,true); assert.equal(r.live_flags.AUSENTE_AUTOMATION_LIVE,false);
});
test('same name different content never overwritten; safe v2 validated',async()=>{
  const old=absentTemplatePayload(); old.components[0].text='Different existing body';
  const r=await prepareAbsentTemplateApproval({token:'fixture',fetchImpl:async()=>response({data:[old]})});
  assert.equal(r.template_name,'dropea_ausente_v2'); assert.equal(r.created,false);
});
test('rejected exact template is not resubmitted or silently versioned',async()=>{
  const r=await prepareAbsentTemplateApproval({token:'fixture',submit:true,fetchImpl:async(url)=>{assert.match(url,/\/list\?/); return response({data:[{...absentTemplatePayload(),status:'REJECTED',rejected_reason:'fixture rejection'}]});}});
  assert.equal(r.approval_status,'REJECTED'); assert.equal(r.created,false);
});
test('uncertain create is never automatically retried',async()=>{
  let creates=0;
  await assert.rejects(prepareAbsentTemplateApproval({token:'fixture',submit:true,fetchImpl:async(url)=>{
    if(url.endsWith('/create')) {creates++; throw new Error('uncertain');} return response({data:[]});
  }})); assert.equal(creates,1);
});
