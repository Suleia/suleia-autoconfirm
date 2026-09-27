import {loadDropeaContract,marketHost,tokenScopes,assertTokenActive} from './contract.mjs';

export function absentSolutionCapability({issue,observedAt}) {
  const {document,checksum}=loadDropeaContract();
  const schema=document.components.schemas.ResolveIssueInput;
  const supportsNote=schema.properties.resolution_status.enum.includes('SOLUTION_PROVIDED') && schema.properties.resolution_note.maxLength===500;
  const allowed=issue.market==='ES' && issue.carrier==='GLS' && issue.allowed_resolution_options?.includes('PROVIDE_SOLUTION');
  return {verified:Boolean(supportsNote && allowed),canonical_issue_id:issue.canonical_issue_id,canonical_order_id:issue.canonical_order_id,
    action:'PROVIDE_SOLUTION',contract_hash:checksum,observed_at:observedAt,requires_window:false,
    supported_windows:supportsNote && allowed?['MORNING','AFTERNOON','ALL_DAY','UNSPECIFIED','DATE_ONLY','TIME_RANGE','FROM_TIME','UNTIL_TIME']:[],
    execution_semantics:'SUBMIT_DELIVERY_INSTRUCTION_NOT_CARRIER_BOOKING'};
}

export function createDropeaAbsentSolutionWriter({token,market,fetchImpl=globalThis.fetch,now=Date.now}={}) {
  const check=()=>{
    assertTokenActive(token,{now});
    if(!tokenScopes(token).includes('dp:issues:resolve'))throw new Error('WRITE_PERMISSION_NOT_AVAILABLE');
    if(market!=='ES')throw new Error('ABSENT_WRITE_MARKET_NOT_SUPPORTED');
    loadDropeaContract();
  };
  check();
  return Object.freeze({
    async provideSolution({issueId,resolution,idempotencyKey}) {
      check();
      if(!Number.isSafeInteger(Number(issueId)) || Number(issueId)<=0 || !resolution.can_execute
        || resolution.idempotency_key!==idempotencyKey || !/^[a-f0-9]{64}$/.test(idempotencyKey)
        || !resolution.resolution_text || resolution.resolution_text.length>500)throw new Error('ABSENT_WRITE_INPUT_INVALID');
      const body={status:'RESOLVED',resolution_status:'SOLUTION_PROVIDED',resolution_note:resolution.resolution_text};
      // One POST only. An uncertain outcome requires reconciliation, not retry.
      try {
        const response=await fetchImpl(`https://${marketHost(market)}/dropshipper/issues/${Number(issueId)}/resolve`,{
          method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Idempotency-Key':idempotencyKey},body:JSON.stringify(body)});
        const payload=await response.json().catch(()=>null), data=payload?.data;
        const confirmed=response.status===200 && payload?.success===true && String(data?.id)===String(issueId)
          && data?.status==='RESOLVED' && data?.resolution_status==='SOLUTION_PROVIDED' && Number.isFinite(Date.parse(data?.resolution_changed_at));
        return {confirmed,http_status:response.status,issue_id:data?.id===Number(issueId)?String(data.id):null,
          order_id:confirmed?String(data.order_id):null,status:confirmed?data.status:null,resolution_status:confirmed?data.resolution_status:null,
          resolution_changed_at:confirmed?data.resolution_changed_at:null,reason:confirmed?null:'PROVIDER_RESULT_UNVERIFIED'};
      } catch {return {confirmed:false,http_status:null,reason:'PROVIDER_RESULT_UNVERIFIED'};}
    }
  });
}
