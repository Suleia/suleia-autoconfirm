export const ADDRESS_CAPABILITIES=['INTERPRETATION','DETAILS','CHANGE_ADDRESS','SOLUTION','OFFER','RETURN','PICKUP','RETRY'];
export const addressCapability=action=>({ASK_MISSING_FIELDS:'DETAILS',CHANGE_ADDRESS:'CHANGE_ADDRESS',PROVIDE_ADDRESS_SOLUTION:'SOLUTION',OFFER_5_EURO_DISCOUNT:'OFFER',RETURN_TO_ORIGIN:'RETURN',PICKUP_AT_AGENCY:'PICKUP'})[action];
const names={CHANGE_ADDRESS:'CHANGE',OFFER:'DISCOUNT_OFFER'};
export function configuredAddressMode(stage,env=process.env){return env[`ADDRESS_${names[stage]||stage}_MODE`]||env[`ADDRESS_${stage}_MODE`]||'SHADOW';}
export function configuredAddressBreaker(stage,env=process.env){return env[`ADDRESS_${names[stage]||stage}_BREAKER`]||env[`ADDRESS_${stage}_BREAKER`]||'CLOSED';}
export function addressExcluded(id,env=process.env){return new Set(['1309433',...(env.ADDRESS_EXCLUDED_ISSUE_IDS||'').split(',')]).has(String(id));}
export function governedAddressIssue(issue){
 const r=issue?.raw||issue,n=String(r?.initial_carrier_description||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
 return r?.type==='ADDRESS_INCORRECT'&&r.carrier==='GLS'&&r.market==='ES'
  &&(r.initial_carrier_code==='DI'||String(r.initial_carrier_code)==='-30'&&String(r.initial_carrier_substatus_code)==='13'&&n.includes('DIRECCION INCORRECTA'));
}
export function addressEffectiveMode(stage,row,env=process.env){
 const mode=configuredAddressMode(stage,env);
 if(env.ADDRESS_AUTOMATION_ENABLED!=='true'||['OFF','SHADOW'].includes(mode))return mode==='OFF'?'OFF':'SHADOW';
 if(stage==='PICKUP'||stage==='RETRY')return 'SHADOW';
 return row?.mode==='LIVE'&&row?.promotion?.verified===true?'LIVE':'CANARY';
}
export function addressPromotionAllowed(stage,result,{writes,regressionPassed,breaker}={}){
 return regressionPassed===true&&breaker==='CLOSED'&&result?.verified===true
  &&(stage==='INTERPRETATION'?writes===0&&result.real_read_verified===true:writes===1&&result.post_write_verified===true)
  &&result.identity_verified===true;
}
