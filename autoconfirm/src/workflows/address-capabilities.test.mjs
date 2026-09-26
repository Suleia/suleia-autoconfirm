import test from 'node:test';
import assert from 'node:assert/strict';
import {addressResponseDecision,parseCustomerAddress,addressStageAllowed,addressRuntimeStatus} from './address-response-policy.mjs';
const now=Date.now(),t=now-3*3600000;
const incident={incidentType:'address',incidenceId:'11',orderId:'22',incidenceDate:new Date(t-1000).toISOString(),chatbyReadVerified:true,chatbyOrderAssociation:'EXACT_ORDER',chatbyUserNs:'fixture'};
const notice={type:'out',mid:'wamid.initial',ts:t/1000,payload:{name:'dropea_incidencia_direccion_v1'}};
const issue={id:'11',order_id:'22',status:'PENDING',is_active:true,allowed_resolution_options:['CHANGE_ADDRESS','PROVIDE_SOLUTION','PICKUP_AT_AGENCY']};
const order={orderId:'22',customerPhone:'600000000',raw:{shipping_address:{address_line_1:'Calle Mayor 10',postal_code:'48012',city:'Bilbao',state:'Bizkaia',country:'ES'}}};
const decide=(texts,extra={})=>addressResponseDecision({incident,issue,order,now,messages:[notice,...texts.map((text,i)=>({type:'in',mid:`wamid.reply${i}`,ts:(now-60000+i*1000)/1000,text}))],...extra});
test('changed address prefers structured change, unchanged address uses solution, capability fallback is explicit',()=>{
 assert.equal(decide(['Calle Mayor 25, 48012 Bilbao']).action,'CHANGE_ADDRESS');
 assert.equal(decide(['Calle Mayor 10, 48012 Bilbao']).action,'PROVIDE_ADDRESS_SOLUTION');
 assert.equal(decide(['Calle Mayor 25, 48012 Bilbao'],{issue:{...issue,allowed_resolution_options:['PROVIDE_SOLUTION']}}).action,'PROVIDE_ADDRESS_SOLUTION');
 assert.equal(decide(['Calle Mayor 25, 48012 Bilbao'],{issue:{...issue,allowed_resolution_options:[]}}).eligible,false);
});
test('province and country completions resolve missing fields without inventing a new locality',()=>{
 const blank={...order,raw:{shipping_address:{}}};
 const d=decide(['Calle Mayor 25, 48012 Bilbao'],{order:blank});assert.deepEqual(d.missing_fields,['province','country']);
 const completed=decide(['Calle Mayor 25, 48012 Bilbao','Provincia Bizkaia','ES'],{order:blank});
 assert.equal(completed.action,'CHANGE_ADDRESS');assert.equal(completed.eligible,true);
 assert.equal(completed.provider_plan.body.resolution_data.address.state,'Bizkaia');
 assert.equal(parseCustomerAddress('Calle Mayor 25, 48012 Bilbao provincia Bizkaia').city,'Bilbao');
 assert.equal(decide(['48012 Bilbao','Calle Mayor 25']).action,'CHANGE_ADDRESS');
});
test('agency requires exact current capability; newer return supersedes it; stages fail closed independently',()=>{
 assert.equal(decide(['Prefiero recoger en agencia']).eligible,true);
 assert.equal(decide(['Prefiero recoger en agencia'],{issue:{...issue,allowed_resolution_options:[]}}).eligible,false);
 assert.equal(decide(['Prefiero recoger en agencia','Que vuelva']).action,'RETURN_TO_ORIGIN');
 const env={ADDRESS_AUTOMATION_ENABLED:'true',ADDRESS_CHANGE_ADDRESS_MODE:'CANARY',ADDRESS_CHANGE_ADDRESS_CANARY_ISSUE_ID:'11'};
 assert.equal(addressStageAllowed('CHANGE_ADDRESS',incident,env),true);
 assert.equal(addressStageAllowed('PICKUP_AT_AGENCY',incident,env),false);
 assert.equal(addressRuntimeStatus({},env).stages.change_address,'CANARY');
 assert.equal(addressRuntimeStatus({},env).stages.pickup,'SHADOW');
});
