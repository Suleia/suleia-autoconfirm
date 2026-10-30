import {interpretMessage,fold,hash} from '../customer-care/context.mjs';
import {madridDate} from '../workflows/incident-intent-v2.mjs';
import validateOutput from './fact-validator.generated.mjs';

const slots={wants_order:'WANTS_ORDER',wants_return:'WANTS_RETURN',cancel_intent:'CANCEL_INTENT',
  delivery_date:'DELIVERY_DATE',delivery_window:'DELIVERY_WINDOW',time_from:'TIME_FROM',time_to:'TIME_TO',
  call_before_arrival:'CALL_BEFORE_ARRIVAL',agency_requested:'REQUESTS_AGENCY',
  reports_no_delivery_attempt:'REPORTS_NO_DELIVERY_ATTEMPT',address:'ADDRESS',postal_code:'POSTAL_CODE',
  asks_status:'ASKS_STATUS',complaint:'COMPLAINT'};
const boolTypes=new Set(['WANTS_ORDER','WANTS_RETURN','CANCEL_INTENT','ACCEPTS_DISCOUNT','REJECTS_DISCOUNT',
  'REQUESTS_REDELIVERY','REQUESTS_AGENCY','CALL_BEFORE_ARRIVAL','REPORTS_NO_DELIVERY_ATTEMPT',
  'ASKS_STATUS','ASKS_DELIVERY_DATE','ASKS_PAYMENT','ASKS_PRODUCT','ASKS_USAGE','COMPLAINT','GREETING','THANKS']);
const dayAdd=(date,n)=>new Date(Date.parse(date+'T12:00:00Z')+86400000*n).toISOString().slice(0,10);
const validDate=d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
export function validateCustomerFacts(result,evidence){
  if(!validateOutput(result))throw Error('CUSTOMER_FACT_SCHEMA_INVALID');
  const hashes=new Set(evidence.map(e=>e.source_event_hash));
  for(const fact of result.facts){
    if(!hashes.has(fact.evidence_hash))throw Error('UNBOUND_FACT_EVIDENCE');
    if(boolTypes.has(fact.type)&&typeof fact.value!=='boolean')throw Error('FACT_VALUE_TYPE');
    if(fact.type==='DELIVERY_DATE'&&(typeof fact.value!=='string'||!validDate(fact.value)))throw Error('FACT_DATE_INVALID');
    if(fact.type==='DELIVERY_WINDOW'&&!['MORNING','AFTERNOON','EVENING'].includes(fact.value))throw Error('FACT_WINDOW_INVALID');
    if(['TIME_FROM','TIME_TO'].includes(fact.type)&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(fact.value))throw Error('FACT_CLOCK_INVALID');
    if(fact.type==='POSTAL_CODE'&&!/^\d{5}$/.test(fact.value))throw Error('FACT_POSTAL_INVALID');
    if(fact.type==='PHONE'&&!(typeof fact.value==='object'&&/^[a-f0-9]{64}$/.test(fact.value.hash)))throw Error('PHONE_MUST_BE_HASHED');
  }
  return result;
}

// Produces customer-derived facts only; provider/system authority is absent
// from both the schema and this interface.
export function extractCustomerFacts(event,{question=null,offerVerified=false,incidentType=null,current={},structuredButton=null}={}){
  const at=Date.parse(event.source_event_at),t=fold(event.text);
  const parsed=interpretMessage(event.message,{question,offerVerified,at,incidentType});
  const facts=new Map(),unresolved=new Set(parsed.uncertainties||[]),contradictions=[];
  const put=(type,value,confidence=.99)=>facts.set(type,{type,value,confidence,evidence_hash:event.source_event_hash});
  for(const [key,value]of Object.entries(parsed.facts))if(slots[key]&&value!==null){
    const addressFields=['street','number','postal_code','city','province','floor','door','country','kind'];
    put(slots[key],key==='address'?Object.fromEntries(addressFields.filter(k=>typeof value[k]==='string').map(k=>[k,value[k]])):value);
  }
  for(const intent of parsed.intents)if(boolTypes.has(intent))put(intent,true);
  if(parsed.facts.discount_response)put(parsed.facts.discount_response==='ACCEPTED'?'ACCEPTS_DISCOUNT':'REJECTS_DISCOUNT',true);

  // Negation scope: negating a return or a discount is not a refusal of goods.
  if(/no quiero devolverlo|no (?:lo )?devuelvan|no quiero cancelar/.test(t)){
    put('WANTS_RETURN',false);put('CANCEL_INTENT',false);
    if(!/no (?:lo quiero|quiero (?:el|mi) pedido)/.test(t))facts.delete('WANTS_ORDER');
    unresolved.delete('CONDITIONAL_OR_CONTRADICTORY_INTENT');
  }
  if(/no quiero (?:el )?descuento|rechazo (?:el )?descuento/.test(t)){
    put('REJECTS_DISCOUNT',true);put('ACCEPTS_DISCOUNT',false);
    if(/pero (?:si )?quiero (?:el|mi) pedido/.test(t)){put('WANTS_ORDER',true);put('WANTS_RETURN',false);put('CANCEL_INTENT',false);}
  }
  if(/nadie ha venido|no se ha pasado nadie|no han intentado entregarlo|sigo esperando|no me ha llegado/.test(t)&&!facts.get('WANTS_RETURN')?.value){
    put('REPORTS_NO_DELIVERY_ATTEMPT',true);put('WANTS_ORDER',true);put('REQUESTS_REDELIVERY',true);put('WANTS_RETURN',false);put('CANCEL_INTENT',false);
  }
  // Day-of-month answers are relative to the event, not the scheduler.
  const numbered=/\bel dia (\d{1,2})\b/.exec(t);
  if(numbered){
    const day=madridDate(at);let year=+day.slice(0,4),month=+day.slice(5,7);
    if(+numbered[1]<+day.slice(8)){if(++month===13){month=1;year++;}}
    const date=`${year}-${String(month).padStart(2,'0')}-${numbered[1].padStart(2,'0')}`;
    if(validDate(date))put('DELIVERY_DATE',date);else unresolved.add('INVALID_DELIVERY_DATE');
  }
  if(/pasado manana/.test(t))put('DELIVERY_DATE',dayAdd(madridDate(at),2));
  if(/^noche[.! ]*$|por la noche/.test(t))put('DELIVERY_WINDOW','EVENING');
  if(/^manana[.! ]*$/.test(t)&&question==='TIME_WINDOW'){facts.delete('DELIVERY_DATE');put('DELIVERY_WINDOW','MORNING');}
  if(/^tarde[.! ]*$|solo por la tarde/.test(t))put('DELIVERY_WINDOW','AFTERNOON');
  if(/cuando salga del trabajo/.test(t)){unresolved.add('TIME_FROM');facts.delete('TIME_FROM');facts.delete('TIME_TO');}
  const words={una:1,dos:2,tres:3,cuatro:4,cinco:5,seis:6,siete:7,ocho:8,nueve:9,diez:10,once:11,doce:12};
  const boundary=/\b(a partir de|despues de|antes de|a) las? (\d{1,2}|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)(?::(\d{2}))?\b/.exec(t);
  if(boundary){
    let hour=words[boundary[2]]||+boundary[2];const minute=+(boundary[3]||0);
    const window=facts.get('DELIVERY_WINDOW')?.value||current.DELIVERY_WINDOW;
    if(hour<12&&['AFTERNOON','EVENING'].includes(window))hour+=12;
    if(hour>23||minute>59)unresolved.add('INVALID_CLOCK');
    else if(hour<8&&window!=='MORNING'&&!['AFTERNOON','EVENING'].includes(window)){
      unresolved.delete('AMBIGUOUS_CLOCK');unresolved.add(boundary[1]==='antes de'?'TIME_TO':'TIME_FROM');
      facts.delete('TIME_FROM');facts.delete('TIME_TO');
    }else {put(boundary[1]==='antes de'?'TIME_TO':'TIME_FROM',`${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`);unresolved.delete('AMBIGUOUS_CLOCK');}
  }
  if(facts.get('DELIVERY_DATE')||facts.get('DELIVERY_WINDOW')||facts.get('TIME_FROM')||facts.get('TIME_TO')){
    if(!facts.get('WANTS_RETURN')?.value){put('WANTS_ORDER',true);if(incidentType)put('REQUESTS_REDELIVERY',true);}
  }
  if(/entreg(?:uen|arlo|a).*casa|domicilio.*(?:entrega|mejor)/.test(t)&&current.REQUESTS_AGENCY){put('REQUESTS_AGENCY',false);put('REQUESTS_REDELIVERY',true);put('WANTS_ORDER',true);}
  if(facts.get('REQUESTS_AGENCY')?.value)put('REQUESTS_REDELIVERY',false);
  if(parsed.confidence<.65&&!facts.size&&!unresolved.size)unresolved.add('UNCLASSIFIED_CUSTOMER_TEXT');
  for(const type of ['WANTS_ORDER','WANTS_RETURN','CANCEL_INTENT']){
    // Explicit source slots override incidental intent names from the old parser.
    const key=Object.keys(slots).find(k=>slots[k]===type);
    if(parsed.facts[key]===false&&!/no quiero devolverlo|no quiero cancelar/.test(t))put(type,false);
  }
  if(structuredButton==='REQUEST_RETURN'){put('WANTS_RETURN',true,1);put('WANTS_ORDER',false,1);put('CANCEL_INTENT',true,1);unresolved.clear();}
  if(structuredButton==='ACCEPT_DISCOUNT_5'){
    if(offerVerified){put('ACCEPTS_DISCOUNT',true,1);put('REJECTS_DISCOUNT',false,1);put('WANTS_ORDER',true,1);put('WANTS_RETURN',false,1);unresolved.clear();}
    else unresolved.add('VERIFIED_CURRENT_OFFER_REQUIRED');
  }
  if(structuredButton==='REJECT_DISCOUNT'){put('REJECTS_DISCOUNT',true,1);put('ACCEPTS_DISCOUNT',false,1);}
  if(['ABSENT_TOMORROW_MORNING','ABSENT_TOMORROW_AFTERNOON'].includes(structuredButton)){
    put('DELIVERY_DATE',dayAdd(madridDate(at),1),1);put('DELIVERY_WINDOW',structuredButton.endsWith('MORNING')?'MORNING':'AFTERNOON',1);put('WANTS_ORDER',true,1);put('WANTS_RETURN',false,1);put('REQUESTS_REDELIVERY',true,1);unresolved.clear();
  }
  if(structuredButton==='ABSENT_PICKUP_AGENCY'){put('REQUESTS_AGENCY',true,1);put('REQUESTS_REDELIVERY',false,1);put('WANTS_ORDER',true,1);unresolved.clear();}
  if(facts.get('WANTS_ORDER')?.value&&facts.get('WANTS_RETURN')?.value){contradictions.push('WANTS_ORDER_VS_RETURN');}
  return validateCustomerFacts({facts:[...facts.values()],contradictions,unresolved:[...unresolved]},[event]);
}
