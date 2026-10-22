import {LIVE_COMPILED} from './intelligence.mjs';
export class MetaBudgetTransportError extends Error {
  constructor(status=0,{definitiveRejection=false,notSent=false}={}){super('META_BUDGET_REQUEST_FAILED');this.status=status;this.definitiveRejection=definitiveRejection;this.notSent=notSent;}
}
// The sole monetary transport remains separate from the GET-only reader.
// Validation-only instances cannot execute the assigning method.
export function createMetaBudgetTransport({reader,accountId,accessToken,apiVersion,allowedCampaignIds,accountBudgetsAuthorized=false,mode,writesEnabled,liveCompiled=LIVE_COMPILED,validationOnly=false,validateBeforeWrite=false,fetchImpl=fetch}){
  if(validationOnly){if(!['SHADOW','SIMULATION'].includes(mode)||writesEnabled!==false)throw Error('VALIDATION_ONLY_CONFIG_INVALID');}
  else if(!liveCompiled||mode!=='LIVE'||writesEnabled!==true)throw Error('LIVE_NOT_AUTHORIZED');
  if(!/^\d+$/.test(String(accountId))||!/^v\d+\.0$/.test(apiVersion)||!accessToken||!Array.isArray(allowedCampaignIds)||(!accountBudgetsAuthorized&&(allowedCampaignIds.length!==1||!/^\d+$/.test(allowedCampaignIds[0]))))throw Error('LIVE_CANARY_CONFIG_INVALID');
  async function submit(id,cents,{expectedBefore,validate=false}={}){
    if(validationOnly&&!validate)throw Error('VALIDATION_ONLY_TRANSPORT');
    if(!/^\d+$/.test(String(id))||(!accountBudgetsAuthorized&&!allowedCampaignIds.includes(String(id)))||!Number.isSafeInteger(cents)||cents<=0||!Number.isSafeInteger(expectedBefore)||expectedBefore<=0)throw Error('BUDGET_WRITE_INPUT_INVALID');
    try{
      const row=await reader.readCampaign(id);
      if(String(row.account_id)!==String(accountId)||row.status!=='ACTIVE'||row.effective_status!=='ACTIVE'||Number(row.daily_budget)!==expectedBefore||Number(row.lifetime_budget)>0)throw Error('LAST_MOMENT_REVALIDATION_FAILED');
    }catch{throw new MetaBudgetTransportError(0,{notSent:true});}
    let response,body;
    try{
      // Exactly one absolute assignment. Never retry a POST, including 429/5xx.
      response=await fetchImpl(`https://graph.facebook.com/${apiVersion}/${id}`,{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({daily_budget:String(cents),...(validate?{execution_options:JSON.stringify(['validate_only'])}:{})}).toString(),signal:AbortSignal.timeout(15000)});
      body=await response.json();
    }catch{throw new MetaBudgetTransportError();}
    if(!response.ok||body?.error)throw new MetaBudgetTransportError(response.status,{definitiveRejection:response.status>=400&&response.status<500&&Number.isInteger(body?.error?.code)});
    if(body?.success!==true)throw new MetaBudgetTransportError(response.status);
    return {success:true}; // Never persist arbitrary provider bodies or headers.
  }
  const transport={
    async setDailyBudget(id,cents,options){if(validationOnly)throw Error('VALIDATION_ONLY_TRANSPORT');if(validateBeforeWrite)await transport.validateDailyBudget(id,cents,options);return submit(id,cents,options);},
    async validateDailyBudget(id,cents,{expectedBefore}={}){
      let account;
      try {account=await reader.readAccount();}catch{throw new MetaBudgetTransportError(0,{notSent:true});}
      if(String(account.id).replace(/^act_/,'')!==String(accountId)||account.currency!=='EUR'||account.timezone_name!=='Europe/Madrid'||account.account_status!==1)throw new MetaBudgetTransportError(0,{notSent:true});
      await submit(id,cents,{expectedBefore,validate:true});
      let after;
      try {after=await reader.readCampaign(id);}catch{throw new MetaBudgetTransportError();}
      if(String(after.id)!==String(id)||String(after.account_id)!==String(accountId)||Number(after.daily_budget)!==expectedBefore||Number(after.lifetime_budget)>0)throw new MetaBudgetTransportError();
      return {validated:true,accountId:String(accountId),campaignId:String(id),currency:'EUR',budgetCents:cents,unchangedBudgetCents:expectedBefore,externalWrites:0};
    }
  };
  return transport;
}
