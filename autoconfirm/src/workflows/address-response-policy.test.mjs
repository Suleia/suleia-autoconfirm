import test from 'node:test';
import assert from 'node:assert/strict';
import {addressResponseDecision as decide,parseCustomerAddress,addressStageAllowed} from './address-response-policy.mjs';
const t=Date.parse('2026-09-20T10:00:00Z');
const incident={incidentType:'address',incidenceId:'11',orderId:'22',incidenceDate:new Date(t-3600000).toISOString(),chatbyReadVerified:true,chatbyOrderAssociation:'EXACT_ORDER',chatbyUserNs:'fixture'};
const order={orderId:'22',customerPhone:'600000000'};
const notice={type:'out',mid:'wamid.fixture',ts:t/1000,payload:{name:'dropea_incidencia_direccion_v1'}};
const reply=(text,h=2)=>({type:'in',ts:(t+h*3600000)/1000,text});
const d=(replies=[],h=3)=>decide({incident,order,messages:[notice,...replies],now:t+h*3600000});
test('A/D/H full address at2h/30h/47h59 supersedes both initial milestones',()=>{
 for(const h of [2,30,47+59/60]){const x=d([reply('Calle Mayor 25, 3B, 48012 Bilbao',h)],49);assert.equal(x.action,'PROVIDE_ADDRESS_SOLUTION');assert.equal(x.address.floor,'3');assert.equal(x.address.door,'B');assert.equal(x.initial_milestones,'SUPERSEDED_BY_CUSTOMER_RESPONSE');}
});
test('B/C 24/48h milestones use the real send, no initial send means no timer',()=>{
 assert.equal(d([],23.999).action,'WAIT_FOR_CUSTOMER');assert.equal(d([],24).action,'OFFER_5_EURO_DISCOUNT');assert.equal(d([],48).action,'RETURN_TO_ORIGIN');assert.equal(decide({incident,order,messages:[],now:t+99*3600000}).return_due_at,undefined);
});
test('E/F partial cooperation blocks silence and explicit later CP/city completes address',()=>{
 const partial=reply('Calle Mayor 25',10);assert.equal(d([partial],49).state,'WAITING_DETAILS_MANUAL_REVIEW');
 assert.equal(d([partial],11).action,'ASK_MISSING_FIELDS');
 for(const h of [34,48,49,96,720]){const x=d([partial],h);assert.equal(x.action,'HUMAN_REVIEW');assert.equal(x.eligible,false);assert.equal(x.initial_milestones,'SUPERSEDED_BY_CUSTOMER_RESPONSE');}
 const x=d([partial,reply('48012 Bilbao',30)],49);assert.equal(x.action,'PROVIDE_ADDRESS_SOLUTION');assert.deepEqual(x.missing_fields,[]);
});
test('G greetings do not stop timers; ambiguous address blocks autonomous action',()=>{
 for(const text of ['hola','🙂','ahora te digo']){const x=d([reply(text)],49);assert.equal(x.action,'RETURN_TO_ORIGIN');assert.equal(x.customer_message_present,true);assert.equal(x.intent,'NO_RESPONSE');}
 const ambiguous=d([reply('Quizá Calle Mayor 25, 48012 Bilbao')],49);assert.equal(ambiguous.eligible,false);assert.equal(ambiguous.intent,'AMBIGUOUS_ADDRESS');
 const cooperative=d([reply('Calle Mayor 25'),reply('gracias',3)],49);assert.equal(cooperative.action,'HUMAN_REVIEW');
});
test('J/K duplicate events do not restart timer or count twice; earlier order cannot anchor',()=>{
 assert.equal(d([notice,reply('hola'),reply('hola')]).response_count,1);
 assert.equal(d([notice]).notification_at,new Date(t).toISOString());
 assert.equal(decide({incident:{...incident,incidenceDate:new Date(t+1).toISOString()},messages:[notice],now:t+50*3600000}).notification_at,null);
});
test('L/M explicit return routes immediately, agency stays separate',()=>{
 assert.equal(d([reply('devolver')]).action,'RETURN_TO_ORIGIN');assert.equal(d([reply('prefiero recogerlo en agencia')]).state,'AGENCY_REQUEST');
});
test('exact correlation, unknown timestamps, contradictory ties and canary limits fail closed',()=>{
 assert.equal(decide({incident:{...incident,chatbyOrderAssociation:'PHONE_FALLBACK'},messages:[notice],now:t+50*3600000}).eligible,false);
 assert.equal(d([{...reply('hola'),user_ns:'other'}],49).eligible,false);
 assert.equal(d([{type:'in',text:'unknown date'}],49).eligible,false);
 assert.equal(d([reply('devolver'),reply('Calle Mayor 25, 48012 Bilbao')],49).eligible,false);
 const env={ADDRESS_AUTOMATION_ENABLED:'true',ADDRESS_RETURN_MODE:'CANARY',ADDRESS_RETURN_CANARY_ISSUE_ID:'11'};
 assert.equal(addressStageAllowed('RETURN_TO_ORIGIN',incident,env),true);assert.equal(addressStageAllowed('RETURN_TO_ORIGIN',{...incident,incidenceId:'12'},env),false);
 assert.equal(addressStageAllowed('RETURN_TO_ORIGIN',incident,{...env,ADDRESS_RETURN_BREAKER:'OPEN'}),false);
});
test('discount acceptance stays manual; refusing discount does not reject the order',()=>{
 const offer={type:'out',mid:'wamid.offer',ts:(t+24*3600000)/1000,text:'es_es_dropea_incidencia_descuento_5_v1'};
 assert.equal(d([offer,reply('Quiero el descuento',25),reply('Calle Mayor 25, 48012 Bilbao',26)],27).state,'MANUAL_DISCOUNT_RECOVERY');
 assert.equal(d([offer,reply('Quiero el descuento',25)],27).state,'MANUAL_DISCOUNT_RECOVERY');
 assert.equal(d([offer,reply('No quiero descuento pero mi dirección es Calle Mayor 25, 48012 Bilbao',26)],27).action,'PROVIDE_ADDRESS_SOLUTION');
});
test('never invent city/CP or accept two conflicting addresses',()=>{
 assert.deepEqual(parseCustomerAddress('Calle Mayor 25').missing_fields,['postal_code','city']);
 assert.equal(parseCustomerAddress('Calle Mayor 25 o Calle Real 14, 48012 Bilbao').kind,'AMBIGUOUS_ADDRESS');
});


test('canonical metadata follows exact issue version and verified read',()=>{
 const x=decide({incident,order,issue:{raw:{updated_at:'2026-09-20T09:30:00Z'}},messages:[notice],now:t+3600000});
 assert.equal(x.issue_version,'2026-09-20T09:30:00Z');assert.equal(x.read_verified,true);
 assert.equal(decide({incident:{...incident,chatbyReadVerified:false},messages:[notice],now:t+3600000}).read_verified,false);
});
test('partial response survives a later incomplete conversation read',()=>{
 const previous=d([reply('Calle Mayor 25')],3);
 const x=decide({incident,order,previous,messages:[notice,reply('hola',90)],now:t+96*3600000});
 assert.equal(x.action,'HUMAN_REVIEW');assert.equal(x.initial_milestones,'SUPERSEDED_BY_CUSTOMER_RESPONSE');
});
test('irrelevant text does not overwrite latest address evidence',()=>{
 const x=d([reply('Calle Mayor 25, 48012 Bilbao'),reply('buen finde',3)],4);
 assert.equal(x.action,'PROVIDE_ADDRESS_SOLUTION');assert.equal(x.address.postal_code,'48012');
});
