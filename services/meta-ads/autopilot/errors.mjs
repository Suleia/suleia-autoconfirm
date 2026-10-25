export function budgetDiagnostic(error,{stage='UNKNOWN',campaignId=null,postSent=false}={}){
 const raw=error?.code||error?.message;
 const code=/^[A-Z0-9_]{3,100}$/.test(raw||'')?raw:'AUTOPILOT_INTERNAL_ERROR';
 return {code,stage,campaignId:campaignId&&/^\d+$/.test(campaignId)?campaignId:null,
  providerCode:Number.isInteger(error?.providerCode)?error.providerCode:null,
  providerSubcode:Number.isInteger(error?.providerSubcode)?error.providerSubcode:null,
  httpStatus:Number.isInteger(error?.status)?error.status:null,
  errorType:['Error','TypeError','MetaAdsReadError','MetaBudgetTransportError','AbortError','TimeoutError'].includes(error?.name)?error.name:'Error',
  requestPhase:/^[A-Z_]{3,60}$/.test(error?.phase||'')?error.phase:stage,assignmentPostSent:error?.assignmentSent===true||postSent,
  validationPostSent:error?.validationSent===true,retryAfterSeconds:Number.isFinite(error?.retryAfterSeconds)?Math.max(1,error.retryAfterSeconds):null,
  verification:postSent||error?.assignmentSent?'UNKNOWN':'NOT_SENT'};
}
