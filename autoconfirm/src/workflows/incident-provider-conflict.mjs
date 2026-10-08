export const verifiedProviderConflict=result=>result?.status==='PROVIDER_ALREADY_SOLVED'&&result.operation_status==='failed'&&result.provider_error_code==='GLS_INCIDENCE_ALREADY_SOLVED';
export const providerConflictResult=operation=>operation?.status==='failed'&&operation.errorCode==='GLS_INCIDENCE_ALREADY_SOLVED'
  ?{status:'PROVIDER_ALREADY_SOLVED',verified:false,operation_status:operation.status,provider_error_code:operation.errorCode}:null;
