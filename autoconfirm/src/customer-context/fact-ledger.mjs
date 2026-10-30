import {hash} from '../customer-care/context.mjs';
import {madridDate} from '../workflows/incident-intent-v2.mjs';
const preferenceTypes=new Set(['DELIVERY_DATE','DELIVERY_WINDOW','TIME_FROM','TIME_TO','CALL_BEFORE_ARRIVAL','DELIVERY_AVAILABILITY']);
const instructionTypes=new Set(['WANTS_ORDER','WANTS_RETURN','CANCEL_INTENT','ACCEPTS_DISCOUNT','REJECTS_DISCOUNT','REQUESTS_AGENCY','ADDRESS_CHANGE_REQUESTED','DELIVERY_DATE','DELIVERY_WINDOW','TIME_FROM','TIME_TO']);
const iso=at=>new Date(at).toISOString();
function endOfMadridDay(day){
  // Find the next local midnight, including DST transitions, without assuming UTC.
  let cursor=Date.parse(day+'T12:00:00Z');
  while(madridDate(cursor)===day)cursor+=3600000;
  let low=cursor-3600000,high=cursor;
  while(high-low>1){const mid=Math.floor((low+high)/2);if(madridDate(mid)===day)low=mid;else high=mid;}
  return iso(high);
}
export function materializeFacts(records,{now=Date.now(),attemptKey}={}){
  const active={};
  for(const fact of records){
    if(fact.status!=='CURRENT')continue;
    if(fact.valid_until&&Date.parse(fact.valid_until)<=now)continue;
    if(fact.attempt_key&&fact.attempt_key!==attemptKey)continue;
    active[fact.fact_type]=fact;
  }
  return active;
}
export function mergeFactLedger(previous,incoming,{orderId,issueId,now,attemptKey,eventVersions={}}){
  const rows=structuredClone(previous||[]),created=iso(now);
  for(const old of rows){
    if(old.status!=='CURRENT')continue;
    if(old.authority==='CUSTOMER_DERIVED'&&eventVersions[old.source_event_id]&&eventVersions[old.source_event_id]!==old.source_event_hash){old.status='RETRACTED';old.updated_at=created;}
    if(old.valid_until&&Date.parse(old.valid_until)<=now||old.attempt_key&&old.attempt_key!==attemptKey){old.status='EXPIRED';old.updated_at=created;}
  }
  const sorted=[...incoming].sort((a,b)=>a.source_event_at.localeCompare(b.source_event_at)||a.type.localeCompare(b.type));
  for(const input of sorted){
    const id=hash([orderId,issueId,input.authority,input.type,input.value,input.source_event_hash]);
    if(rows.some(r=>r.fact_id===id))continue;
    const fact={fact_id:id,canonical_order_id:orderId,canonical_issue_id:issueId,fact_type:input.type,value_json:input.value,
      authority:input.authority,confidence:input.confidence,source_event_id:input.source_event_id,
      source_event_hash:input.source_event_hash,source_event_at:input.source_event_at,valid_from:input.source_event_at,
      valid_until:input.type==='DELIVERY_DATE'?endOfMadridDay(input.value):preferenceTypes.has(input.type)&&input.related_delivery_date?endOfMadridDay(input.related_delivery_date):['GREETING','THANKS'].includes(input.type)?iso(Date.parse(input.source_event_at)+15*60000):null,
      superseded_by:null,status:'CURRENT',created_at:created,updated_at:created,
      attempt_key:preferenceTypes.has(input.type)?attemptKey:null};
    for(const old of rows.filter(r=>r.fact_type===fact.fact_type&&r.status==='CURRENT')){
      if(old.source_event_at>fact.source_event_at){fact.status='SUPERSEDED';fact.superseded_by=old.fact_id;continue;}
      // Customer observations never overwrite provider/system-controlled truth.
      if(old.authority!==fact.authority){fact.status='CONFLICT';continue;}
      old.status='SUPERSEDED';old.superseded_by=id;old.updated_at=created;
    }
    const exclusive=input.type==='DELIVERY_AVAILABILITY'?['TIME_FROM','TIME_TO','DELIVERY_WINDOW']:input.type==='DELIVERY_WINDOW'?['TIME_FROM','TIME_TO','DELIVERY_AVAILABILITY']:['TIME_FROM','TIME_TO'].includes(input.type)?['DELIVERY_WINDOW','DELIVERY_AVAILABILITY']:[];
    for(const old of rows.filter(r=>r.status==='CURRENT'&&exclusive.includes(r.fact_type)&&r.source_event_at<fact.source_event_at&&r.authority===fact.authority)){
      old.status='SUPERSEDED';old.superseded_by=id;old.updated_at=created;
    }
    if(instructionTypes.has(fact.fact_type))for(const old of rows.filter(r=>r.status==='CURRENT'&&r.fact_type.startsWith('ASKS_')&&r.source_event_at<fact.source_event_at&&r.authority===fact.authority)){
      old.status='SUPERSEDED';old.superseded_by=id;old.updated_at=created;
    }
    if(fact.valid_until&&Date.parse(fact.valid_until)<=now)fact.status='EXPIRED';
    rows.push(fact);
  }
  return rows;
}
