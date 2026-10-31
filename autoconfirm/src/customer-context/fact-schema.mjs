export const CUSTOMER_FACT_TYPES = Object.freeze([
  'WANTS_ORDER','WANTS_RETURN','CANCEL_INTENT','ACCEPTS_DISCOUNT','REJECTS_DISCOUNT',
  'REQUESTS_REDELIVERY','REQUESTS_AGENCY','DELIVERY_DATE','DELIVERY_WINDOW','TIME_FROM',
  'TIME_TO','CALL_BEFORE_ARRIVAL','REPORTS_NO_DELIVERY_ATTEMPT','ADDRESS','POSTAL_CODE',
  'CITY','PROVINCE','PHONE','ASKS_STATUS','ASKS_DELIVERY_DATE','ASKS_PAYMENT','ASKS_PRODUCT',
  'ASKS_USAGE','COMPLAINT','GREETING','THANKS','REQUESTS_CONTACT','ADDRESS_CHANGE_REQUESTED',
  'REPORTS_RECEIVED','REPORTS_CARRIER_PLAN','DELIVERY_AVAILABILITY',
  'REQUESTS_SINGLE_ORDER','DUPLICATE_ORDER_CONCERN','CUSTOMER_MENTIONED_AMOUNT',
  'CUSTOMER_FRUSTRATION','CONDITIONAL_RETURN_THREAT'
]);
export const factOutputSchema = {
  type:'object', additionalProperties:false, required:['facts','contradictions','unresolved'],
  properties:{
    facts:{type:'array',maxItems:40,items:{type:'object',additionalProperties:false,
      required:['type','value','confidence','evidence_hash'],properties:{
        type:{enum:CUSTOMER_FACT_TYPES},
        value:{anyOf:[{type:'boolean'},{type:'string',pattern:'^[\\s\\S]{1,300}$'},
          {type:'object',additionalProperties:false,properties:{
            street:{type:'string'},number:{type:'string'},postal_code:{type:'string'},
            city:{type:'string'},province:{type:'string'},floor:{type:'string'},door:{type:'string'},
            country:{type:'string'},kind:{type:'string'},hash:{type:'string'}
          }}]},
        confidence:{type:'number',minimum:0,maximum:1},
        evidence_hash:{type:'string',pattern:'^[a-f0-9]{64}$'}
      }}},
    contradictions:{type:'array',maxItems:20,items:{type:'string',pattern:'^[A-Z][A-Z0-9_]{0,99}$'}},
    unresolved:{type:'array',maxItems:20,items:{type:'string',pattern:'^[A-Z][A-Z0-9_]{0,99}$'}}
  }
};
