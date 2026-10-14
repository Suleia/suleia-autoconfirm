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
