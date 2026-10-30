import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('./main.js',import.meta.url),'utf8');
const renderer=source.slice(source.indexOf('function renderIncidents()'),source.indexOf('function discountStatusLabel('));
function render(incident){
 const nodes={'#incidents-table':{},'#incidents-summary':{}};
 const context={state:{dashboard:{incidents:{incidents:[incident],intervalMinutes:30}}},document:{querySelector:k=>nodes[k]},
  setText:()=>{},matchesQuery:()=>true,incidentMatchesFilter:()=>true,incidentHasCustomerActivity:i=>i.customerActivityDetected===true,
  inferredIncidentType:i=>i.incidentType,incidentTone:()=> 'neutral',inferredIncidentTone:()=> 'neutral',incidentConfidence:()=>null,
  incidentConfidenceTone:()=> 'neutral',incidentConfidenceLabel:()=> '',incidentTypeLabel:x=>x,formatDateTime:x=>x||'—',
  escapeHtml:x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')};
 vm.runInNewContext(renderer+';renderIncidents();',context);
 return nodes['#incidents-table'].innerHTML;
}
test('activity is beside the order, shows button text/time and escapes customer HTML',()=>{
 const html=render({orderId:'fixture',incidentType:'address',customerActivityDetected:true,customerActivityVerified:true,
  customerActivityActionLabel:'Aporta dirección',customerActivityLastText:'<img src=x>',customerActivityLastAt:'2026-10-14T10:00:00Z',customerActivityInteractionType:'BUTTON'});
 assert.match(html,/Cliente ha actuado/);assert.match(html,/Aporta dirección/);assert.match(html,/&lt;img src=x&gt;/);assert.doesNotMatch(html,/<img src=x>/);
 assert.match(html,/2026-10-14T10:00:00Z/);assert.match(html,/botón de Chatby/);
 assert.ok(html.indexOf('incident-activity-cell')<html.indexOf('Sin nombre'));
});
test('failed history read is visibly unknown instead of reporting no customer activity',()=>{
 const html=render({orderId:'fixture',customerActivityDetected:false,customerActivityVerified:false});
 const cell=html.split('incident-activity-cell')[1].split('</td>')[0];
 assert.match(cell,/Sin lectura verificada/);assert.doesNotMatch(cell,/Sin actividad posterior|Sin respuesta ni acción posterior/);
});
test('unresolved customer reply shows an expanded decision with reason and required input',()=>{
 const html=render({orderId:'fixture',customerActivityLastText:'<script>customer</script>',incidentResolution:{customer_replied:true,current_owner:'HUMAN',human_review_reason:'DELIVERY_DATE_AND_WINDOW_REQUIRED',customer_event_at:'2026-10-20T10:00:00Z',observed_at:'2026-10-20T10:30:00Z'}});
 assert.match(html,/Necesita tu decisión/);assert.match(html,/Falta una fecha/);assert.match(html,/Obtener del cliente el día/);assert.match(html,/2026-10-20T10:30:00Z/);assert.doesNotMatch(html,/<script>/);
});
test('verified actions and customer waits do not request a human decision',()=>{
 for(const twin of [{customer_replied:true,current_owner:'PROVIDER',verification_status:'VERIFIED'}, {customer_replied:false,current_owner:'CUSTOMER'}])assert.doesNotMatch(render({orderId:'fixture',incidentResolution:twin}),/Necesita tu decisión/);
});
test('unknown blockers remain visible and escaped rather than hiding the reply',()=>{
 const html=render({orderId:'fixture',incidentResolution:{customer_replied:true,current_owner:'HUMAN',human_review_reason:'<unknown>'}});
 assert.match(html,/Necesita tu decisión/);assert.match(html,/Qué falta/);assert.match(html,/&lt;unknown&gt;/);
});

test('customer-care context is additive, visibly shadow and escapes all model fields',()=>{
 const html=render({orderId:'fixture',customerCare:{mode:'SHADOW',latest_customer_intents:['WANTS_ORDER'],wants_order:true,delivery_date:'2026-11-02',delivery_window:'AFTERNOON',next_best_action:'HUMAN_REVIEW',reason:'<unsafe>',owner:'existing_incident_action_gateway',proposed_response:'<script>draft</script>',conversation_version:3}});
 assert.match(html,/Contexto de atención · SHADOW/);assert.match(html,/2026-11-02/);assert.match(html,/&lt;unsafe&gt;/);assert.match(html,/&lt;script&gt;draft/);assert.doesNotMatch(html,/<script>/);assert.match(html,/existing_incident_action_gateway/);
});
