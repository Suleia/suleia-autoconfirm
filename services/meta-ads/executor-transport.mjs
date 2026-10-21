import {LIVE_COMPILED} from './intelligence.mjs';
export class MetaBudgetTransportError extends Error {
  constructor(status=0,{definitiveRejection=false,notSent=false}={}){super('META_BUDGET_REQUEST_FAILED');this.status=status;this.definitiveRejection=definitiveRejection;this.notSent=notSent;}
}
// Deliberately separate from the GET-only reader. The release gate is false;
// only offline tests inject permission to inspect the actual request contract.
export function createMetaBudgetTransport({reader,accountId,accessToken,apiVersion,allowedCampaignIds,accountBudgetsAuthorized=false,mode,writesEnabled,liveCompiled=LIVE_COMPILED,fetchImpl=fetch}){
  if(!liveCompiled||mode!=='LIVE'||writesEnabled!==true)throw Error('LIVE_NOT_AUTHORIZED');
  if(!/^\d+$/.test(String(accountId))||!/^v\d+\.0$/.test(apiVersion)||!accessToken||!Array.isArray(allowedCampaignIds)||(!accountBudgetsAuthorized&&(allowedCampaignIds.length!==1||!/^\d+$/.test(allowedCampaignIds[0]))))throw Error('LIVE_CANARY_CONFIG_INVALID');
  return {async setDailyBudget(id,cents,{expectedBefore}={}){
    if(!/^\d+$/.test(String(id))||(!accountBudgetsAuthorized&&!allowedCampaignIds.includes(String(id)))||!Number.isSafeInteger(cents)||cents<=0||!Number.isSafeInteger(expectedBefore)||expectedBefore<=0)throw Error('BUDGET_WRITE_INPUT_INVALID');
    try{
      const row=await reader.readCampaign(id);
      if(String(row.account_id)!==String(accountId)||row.status!=='ACTIVE'||row.effective_status!=='ACTIVE'||Number(row.daily_budget)!==expectedBefore||Number(row.lifetime_budget)>0)throw Error('LAST_MOMENT_REVALIDATION_FAILED');
    }catch{throw new MetaBudgetTransportError(0,{notSent:true});}
    let response,body;
    try{
      // Exactly one absolute assignment. Never retry a POST, including 429/5xx.
      response=await fetchImpl(`https://graph.facebook.com/${apiVersion}/${id}`,{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({daily_budget:String(cents)}).toString(),signal:AbortSignal.timeout(15000)});
      body=await response.json();
    }catch{throw new MetaBudgetTransportError();}
    if(!response.ok||body?.error)throw new MetaBudgetTransportError(response.status,{definitiveRejection:response.status>=400&&response.status<500&&Number.isInteger(body?.error?.code)});
    if(body?.success!==true)throw new MetaBudgetTransportError(response.status);
    return {success:true}; // Never persist arbitrary provider bodies or headers.
  }};
}
