import {interpretMessage,fold,hash} from '../customer-care/context.mjs';
import {madridDate} from '../workflows/incident-intent-v2.mjs';
import validateOutput from './fact-validator.generated.mjs';
import {correctTemporalFacts} from './temporal-facts.mjs';

const slots={wants_order:'WANTS_ORDER',wants_return:'WANTS_RETURN',cancel_intent:'CANCEL_INTENT',
  delivery_date:'DELIVERY_DATE',delivery_window:'DELIVERY_WINDOW',time_from:'TIME_FROM',time_to:'TIME_TO',
  call_before_arrival:'CALL_BEFORE_ARRIVAL',agency_requested:'REQUESTS_AGENCY',
  reports_no_delivery_attempt:'REPORTS_NO_DELIVERY_ATTEMPT',address:'ADDRESS',postal_code:'POSTAL_CODE',
  asks_status:'ASKS_STATUS',complaint:'COMPLAINT',address_change_requested:'ADDRESS_CHANGE_REQUESTED'};
const boolTypes=new Set(['WANTS_ORDER','WANTS_RETURN','CANCEL_INTENT','ACCEPTS_DISCOUNT','REJECTS_DISCOUNT',
  'REQUESTS_REDELIVERY','REQUESTS_AGENCY','CALL_BEFORE_ARRIVAL','REPORTS_NO_DELIVERY_ATTEMPT',
  'ASKS_STATUS','ASKS_DELIVERY_DATE','ASKS_PAYMENT','ASKS_PRODUCT','ASKS_USAGE','COMPLAINT','GREETING','THANKS','REQUESTS_CONTACT','ADDRESS_CHANGE_REQUESTED','REPORTS_RECEIVED','REPORTS_CARRIER_PLAN']);
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
  if(question==='WANTS_ORDER_AND_SCHEDULE')question='WANTS_ORDER';
  const parsed=interpretMessage({id:event.message.id,content:event.text},{question,offerVerified,at,incidentType});
  const facts=new Map(),unresolved=new Set(parsed.uncertainties||[]),contradictions=[];
  const put=(type,value,confidence=.99)=>facts.set(type,{type,value,confidence,evidence_hash:event.source_event_hash});
  for(const [key,value]of Object.entries(parsed.facts))if(slots[key]&&value!==null){
    const addressFields=['street','number','postal_code','city','province','floor','door','country','kind'];
    put(slots[key],key==='address'?Object.fromEntries(addressFields.filter(k=>typeof value[k]==='string').map(k=>[k,value[k]])):value);
  }
  for(const intent of parsed.intents)if(boolTypes.has(intent))put(intent,true);
  for(const [key,type]of Object.entries(slots))if(parsed.facts[key]===false)put(type,false);
  if(parsed.facts.address){
    for(const [key,type]of [['postal_code','POSTAL_CODE'],['city','CITY'],['province','PROVINCE']])if(parsed.facts.address[key])put(type,parsed.facts.address[key]);
  }
  const phone=/\b(?:telefono|movil|llamad al)\s*[:+]?\s*(?:34)?\s*([67][\d ]{7,14}\d)\b/.exec(t);
  if(phone){const digits=phone[1].replace(/\D/g,'');if(digits.length===9)put('PHONE',{hash:hash(digits)});}
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
  if(/^(?:ok|vale|de acuerdo|perfecto|muchas gracias|gracias)[!. ,]*$/.test(t)||/^[\p{Extended_Pictographic}\s\uFE0F\u200D]+$/u.test(t)){put('THANKS',true);unresolved.clear();}
  if(/quiero el mismo (?:q|que) pedi|lo quiero para ese dia|si lo quiero/.test(t)&&!facts.get('WANTS_RETURN')?.value){put('WANTS_ORDER',true);put('WANTS_RETURN',false);}
  if(/por el momento no|ahora no (?:lo )?quiero/.test(t)&&current.WANTS_RETURN===true){put('WANTS_RETURN',true);put('WANTS_ORDER',false);}
  if(/(?:lo )?recojo en gls|recoger.*\bgls\b/.test(t)){put('REQUESTS_AGENCY',true);put('WANTS_ORDER',true);put('REQUESTS_REDELIVERY',false);}
  if(/cambiar datos de envio/.test(t))put('ADDRESS_CHANGE_REQUESTED',true);
  if(/^(?:dime )?que es(?:[. !?]|$)|de que (?:es|se trata)/.test(t)){put('ASKS_PRODUCT',true);}
  if(/(?:que me |que nos |por favor )?llamen|llamadme|llamarme/.test(t)){put('REQUESTS_CONTACT',true);}
  if(/tengo el dinero.*preparado|dinero.*en casa preparado|ya tengo el efectivo/.test(t)){put('COMPLAINT',true);}
  if(/avisar con tiempo|avisen con tiempo/.test(t))put('CALL_BEFORE_ARRIVAL',true);
  const multipleRanges=[...t.matchAll(/\bde (\d{1,2})(?::(\d{2}))?\s*h?\.?\s*a\s*(\d{1,2})(?::(\d{2}))?\s*h?\b/g)];
  if(multipleRanges.length===1){
    const r=multipleRanges[0],window=facts.get('DELIVERY_WINDOW')?.value||current.DELIVERY_WINDOW;
    let from=+r[1],to=+r[3];if(window==='AFTERNOON'||window==='EVENING'){if(from<12)from+=12;if(to<12)to+=12;}
    if(from>=8&&from<to&&to<=23&&+(r[2]||0)<=59&&+(r[4]||0)<=59&&!facts.get('WANTS_RETURN')?.value){
      put('TIME_FROM',`${String(from).padStart(2,'0')}:${r[2]||'00'}`);put('TIME_TO',`${String(to).padStart(2,'0')}:${r[4]||'00'}`);put('WANTS_ORDER',true);
      unresolved.delete('AMBIGUOUS_CLOCK');
    }
  }
  const bareClocks=[...t.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g)];
  if(bareClocks.length===1&&!facts.has('TIME_FROM')&&!facts.has('TIME_TO')&&(facts.has('DELIVERY_WINDOW')||['TIME_WINDOW','DATE_AND_WINDOW'].includes(question))&&!facts.get('WANTS_RETURN')?.value){
    const h=+bareClocks[0][1],window=facts.get('DELIVERY_WINDOW')?.value||current.DELIVERY_WINDOW;
    if(h>=8||window==='MORNING')put('TIME_FROM',`${String(h).padStart(2,'0')}:${bareClocks[0][2]}`);
  }
  if(multipleRanges.length>=2&&multipleRanges.length<=3&&multipleRanges.every(r=>+r[1]<+r[3]&&+r[3]<=23&&+(r[2]||0)<=59&&+(r[4]||0)<=59)){
    put('DELIVERY_AVAILABILITY',event.text.slice(0,300));put('WANTS_ORDER',true);put('REQUESTS_REDELIVERY',true);
    facts.delete('TIME_FROM');facts.delete('TIME_TO');unresolved.delete('MULTIPLE_CLOCKS');
  }
  if(/no (?:me )?encuentro en casa|no voy a estar en casa/.test(t))put('COMPLAINT',true);
  if(/ya no necesito (?:el|mi) pedido/.test(t)){put('WANTS_RETURN',true);put('WANTS_ORDER',false);put('CANCEL_INTENT',true);}
  const dayWords={uno:1,dos:2,tres:3,cuatro:4,cinco:5,seis:6,siete:7,ocho:8,nueve:9,diez:10,once:11,doce:12,trece:13,catorce:14,quince:15,dieciseis:16,diecisiete:17,dieciocho:18,diecinueve:19,veinte:20,veintiuno:21,veintidos:22,veintitres:23,veinticuatro:24,veinticinco:25,veintiseis:26,veintisiete:27,veintiocho:28,veintinueve:29,treinta:30};
  const months=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const wordDate=new RegExp(`\\b(?:el dia|dia) (${Object.keys(dayWords).join('|')})(?: de (${months.join('|')}))?\\b`).exec(t);
  if(wordDate){
    const eventDay=madridDate(at);let year=+eventDay.slice(0,4),month=wordDate[2]?months.indexOf(wordDate[2])+1:+eventDay.slice(5,7),day=dayWords[wordDate[1]];
    if(!wordDate[2]&&(/mes (?:q|que) viene/.test(t)||day<+eventDay.slice(8)))if(++month===13){month=1;year++;}
    const date=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;if(validDate(date)){put('DELIVERY_DATE',date);put('WANTS_ORDER',true);}else unresolved.add('INVALID_DELIVERY_DATE');
  }
  if(/no (?:tenia|llevaba) el efectivo|no (?:me )?encontraba en casa/.test(t)){put('COMPLAINT',true);}
  const reportedDelivery=/\b(?:me (?:dijo|indico)|repartidor.*(?:dijo|vendr|venia)|lo he recibido|lo recibi|ya (?:lo )?recibi)\b/.test(t);
  const asksDelivery=/\b(?:llegara|llega|llegado|vendra)\b/.test(t)&&(/[?¿]|(?:si o no|si 0 no|dimelo)/.test(t));
  const requestsDelivery=/\b(?:quiero|prefiero|pueden venir|podeis venir|puede venir|entregad|traed|solicito)\b/.test(t);
  if((reportedDelivery||asksDelivery)&&!requestsDelivery){
    for(const type of ['DELIVERY_DATE','DELIVERY_WINDOW','TIME_FROM','TIME_TO','REQUESTS_REDELIVERY'])facts.delete(type);
    if(!parsed.intents.includes('REPORTS_NO_DELIVERY_ATTEMPT')){facts.delete('WANTS_ORDER');facts.delete('WANTS_RETURN');facts.delete('CANCEL_INTENT');}
    if(asksDelivery)put('ASKS_DELIVERY_DATE',true);
    else put(/recib/.test(t)?'REPORTS_RECEIVED':'REPORTS_CARRIER_PLAN',true);
  }
  if(parsed.confidence<.65&&!facts.size&&!unresolved.size)unresolved.add('UNCLASSIFIED_CUSTOMER_TEXT');
  correctTemporalFacts(event,{facts,unresolved,put,question,current});
  if(['DELIVERY_DATE','DELIVERY_WINDOW','TIME_FROM','TIME_TO','DELIVERY_AVAILABILITY'].some(type=>facts.has(type))&&!facts.get('WANTS_RETURN')?.value){put('WANTS_ORDER',true);put('WANTS_RETURN',false);if(incidentType)put('REQUESTS_REDELIVERY',true);}
  const yes=/^(?:s+i+|ok(?:ey)?|vale|de acuerdo|claro|acepto|perfecto)(?: por favor)?[!. ,]*$/.test(t)||question==='AGENCY_PICKUP'&&/^si[, .]/.test(t);
  const no=/^no(?:[ ,]+(?:m?gracias|por favor))?[!. ,]*$/.test(t);
  if((yes||no)&&question==='AGENCY_PICKUP'){
    put('REQUESTS_AGENCY',yes);facts.delete('WANTS_RETURN');facts.delete('CANCEL_INTENT');
    if(yes){put('WANTS_ORDER',true);put('REQUESTS_REDELIVERY',false);}unresolved.clear();
  }else if(yes&&['WANTS_ORDER','CONFIRM_ORDER'].includes(question)){
    put('WANTS_ORDER',true);put('WANTS_RETURN',false);put('CANCEL_INTENT',false);unresolved.clear();
  }else if(no&&question==='WANTS_ORDER'){
    put('WANTS_RETURN',true);put('WANTS_ORDER',false);put('CANCEL_INTENT',true);unresolved.clear();
  }
  const originDisputed=/no (?:lo )?(?:he |e |ha )?(?:realizado|hecho|echo|pedido)|no hice (?:el|este) pedido|yo no pedi/.test(t);
  if(originDisputed){
    for(const type of ['WANTS_ORDER','WANTS_RETURN','CANCEL_INTENT','REQUESTS_REDELIVERY'])facts.delete(type);
    unresolved.add('ORDER_ORIGIN_DISPUTED');
  }
  const explicitRefusal=/no (?:me )?lo (?:mandes|mande|manden|envies|envie|envien)|no lo envien|no queremos (?:el )?producto|ya no me interesa|ya no necesito|no quiero (?:nada|el producto)|no (?:lo )?voy a recibir/.test(t)&&!originDisputed;
  if(explicitRefusal){put('WANTS_RETURN',true);put('WANTS_ORDER',false);put('CANCEL_INTENT',true);}
  const explicitDesire=/mandamela|mandamelo|ya me podeis mandar|me traigan|lo he aceptado|lo espero|si que me interesa el producto|quiero.*recibir|manda lo hoy aceptare/.test(t)&&!explicitRefusal&&!originDisputed;
  if(explicitDesire){put('WANTS_ORDER',true);put('WANTS_RETURN',false);put('CANCEL_INTENT',false);}
  if(/(?:ire|voy|recojo|recoger|retirar).*\b(?:agencia|oficina)\b/.test(t)){put('REQUESTS_AGENCY',true);put('WANTS_ORDER',true);put('REQUESTS_REDELIVERY',false);}
  if(/(?:y )?(?:precio|cantidad contra ?reembolso)\s*[?¿]|cuanto.*(?:pagar|cobrar)|cantidad.*contra ?reembolso|se puede pagar/.test(t))put('ASKS_PAYMENT',true);
  if(/que (?:crema|pedido|producto|envio)|crema.*falsa|como.*(?:usa|aplica)|no me acuerdo.*pedi|marca.*(?:verdadera|imitacion|autentica)|original.*(?:verdad|\?)|que he pedido|recomiendas la crema/.test(t))put(/como.*(?:usa|aplica)/.test(t)?'ASKS_USAGE':'ASKS_PRODUCT',true);
  if(/(?:ya lo tengo|me ha llegado|ya lo he recogido|he recibido (?:el|un) pedido|a llegado mi pedido|me entregaron el pedido|ya tengo la crema)/.test(t)&&!/no (?:me )?ha llegado|no lo tengo|no he recibido/.test(t))put('REPORTS_RECEIVED',true);
  if(/cuando.*(?:lleg|traer)|saber si.*traeran|me llegara|que dia.*mandar|que dia mebais/.test(t))put('ASKS_DELIVERY_DATE',true);
  if(/(?:empresa|enpresa).*(?:venir|viene|trae)/.test(t))put('ASKS_STATUS',true);
  if(/(?:me |nos )?(?:llame|llamen|puedes llamar)|llamar al|llamar antes|me llamaran/.test(t))put('REQUESTS_CONTACT',true);
  if(/(?:no |nadie ).*(?:ha |a |han |an )?venido|no .*rechazado|ningun momento.*rechazado|no tengo constancia.*venido|no viniste|no me han llamado|nunca llego|no (?:an|han) (?:toca|llamado)|no allegado nada/.test(t)&&!facts.get('WANTS_RETURN')?.value){put('REPORTS_NO_DELIVERY_ATTEMPT',true);put('WANTS_ORDER',true);put('WANTS_RETURN',false);}
  if(/lo estaba esperando|mandarme|reenviar|enviarmelo|mandarmelo/.test(t)&&!explicitRefusal){put('WANTS_ORDER',true);put('WANTS_RETURN',false);put('REQUESTS_REDELIVERY',true);}
  if(/que vuelva por favor/.test(t)){put('WANTS_ORDER',true);put('REQUESTS_REDELIVERY',true);}
  if(/^(?:otro dia|otro dia o datos)[.! ]*$/.test(t)){put('WANTS_ORDER',true);unresolved.add('DELIVERY_DATE');}
  if(/gls.*(?:el \d+ lo recojo|recoger)|donde ir a recogerlo|direccion.*para ir a recogerlo/.test(t)){put('REQUESTS_AGENCY',true);put('WANTS_ORDER',true);put('REQUESTS_REDELIVERY',false);}
  if(/me (?:h?an|a) dicho|medujo el repartidor/.test(t))put('REPORTS_CARRIER_PLAN',true);
  if(/no vino nadie|como q no habia alguien|no es posible.*no hubiese nadie/.test(t)){put('REPORTS_NO_DELIVERY_ATTEMPT',true);if(!facts.get('WANTS_RETURN')?.value)put('WANTS_ORDER',true);}
  if(/(?:por la manana|la manana).*no estoy/.test(t)&&facts.has('TIME_FROM')&&!/por la tarde|de la tarde/.test(t)){
    facts.get('TIME_FROM').confidence=.55;unresolved.add('TIME_FROM');
  }
  if(/(?:me dijeron|me han dicho|medijo|me dijo)/.test(t)&&!requestsDelivery)put('REPORTS_CARRIER_PLAN',true);
  // Conditional acceptance/refusal is evidence for review, never an unconditional instruction.
  if(/\b(?:solo si|si no (?:es|mandais|es asi)|si (?:yo )?veo|tal vez|quizas)\b/.test(t)){
    for(const type of ['WANTS_ORDER','WANTS_RETURN','CANCEL_INTENT','REQUESTS_AGENCY','REQUESTS_REDELIVERY'])if(facts.has(type))facts.get(type).confidence=.55;
    unresolved.add('CONDITIONAL_OR_CONTRADICTORY_INTENT');
  }
  if(current.WANTS_RETURN===true&&!explicitDesire&&!explicitRefusal&&!(yes&&question==='WANTS_ORDER')&&![...facts.values()].some(f=>f.type==='WANTS_RETURN'&&f.value===true)){
    // Availability supplied while explaining an existing refusal is not consent.
    if(facts.has('DELIVERY_DATE')||facts.has('DELIVERY_WINDOW')){
      facts.delete('WANTS_ORDER');facts.delete('WANTS_RETURN');facts.delete('CANCEL_INTENT');facts.delete('REQUESTS_REDELIVERY');unresolved.add('AVAILABILITY_AFTER_REFUSAL_REQUIRES_REVIEW');
    }
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
  const accepts=facts.get('ACCEPTS_DISCOUNT')?.value===true,rejects=facts.get('REJECTS_DISCOUNT')?.value===true;
  if(accepts&&rejects)contradictions.push('ACCEPTS_VS_REJECTS_DISCOUNT');
  else if(accepts)put('REJECTS_DISCOUNT',false);
  else if(rejects)put('ACCEPTS_DISCOUNT',false);
  if(facts.size&&unresolved.size===1&&unresolved.has('UNCLASSIFIED_CUSTOMER_TEXT'))unresolved.clear();
  if(facts.get('WANTS_ORDER')?.value&&facts.get('WANTS_RETURN')?.value){contradictions.push('WANTS_ORDER_VS_RETURN');}
  return validateCustomerFacts({facts:[...facts.values()],contradictions,unresolved:[...unresolved]},[event]);
}
