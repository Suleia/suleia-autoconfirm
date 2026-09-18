import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {buildRecoveryOverview} from '../../packages/platform-core/src/incident/recovery-center.mjs';
class Element {
  constructor(tag='div'){this.tagName=tag;this.children=[];this.textContent='';this.events={};this.style={};this.classList={add(){},remove(){},toggle(){}};}
  append(...c){this.children.push(...c);} replaceChildren(...c){this.children=c;} setAttribute(k,v){this[k]=String(v);}
  addEventListener(k,fn){this.events[k]=fn;}
}
const content=e=>`${e.textContent||''} ${e.children.map(c=>typeof c==='string'?c:content(c)).join(' ')}`;
const all=e=>[e,...e.children.filter(c=>typeof c!=='string').flatMap(all)];
function fixture(){
  const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  const context={URL,URLSearchParams,Intl,console,Node:Element,AbortController,setInterval(){},location:{origin:'https://mcp.suleia.com',pathname:'/operations/',search:''},history:{replaceState(){}},sessionStorage:{getItem(){return null;},setItem(){},removeItem(){}},Option:class extends Element{constructor(label,value){super('option');this.textContent=label;this.value=value;}},
    document:{getElementById:get,createElement:tag=>new Element(tag),createElementNS:(_,tag)=>new Element(tag),createTextNode:t=>t,querySelectorAll:()=>[],addEventListener(){}},
    fetch:async()=>({ok:true,json:async()=>({oauth:{}})})};
  vm.runInNewContext(fs.readFileSync(new URL('./app.js',import.meta.url),'utf8')+'\nloadQueue=async()=>{};globalThis.ui={state,setView,renderSummary,renderRecoveryCenter,rowIncident,recoveryEvidenceDetail,recoveryDetail,recoveryTimelinePanel,renderFilters,renderHead};',context);
  return {context,get};
}
const raw={canonical_issue_id:'i',canonical_order_id:'o',dropea_issue_id:'test',dropea_order_id:'test-order',interpreted_type:'RECIPIENT_ABSENT',normalized_type:'RECIPIENT_ABSENT',status:'PENDING',is_active:true,created_at:'2026-09-18T10:00:00Z',updated_at:'2026-09-18T13:00:00Z',incident_notified_at:'2026-09-18T10:10:00Z',incident_notification_template:'dropea_ausente_v3',conversation_status:'FOUND',chatby_sync_current:true,dropea_sync_current:true,scoped_customer_message_hash:'a',latest_private_customer_message_hash:'a',customer_evidence:{code:'DELIVERY_RETRY',latest_message:'Mañana por la mañana',at:'2026-09-18T13:00:00Z',relation:'AFTER_NOTIFICATION',delivery_instruction:{requested_day:'SATURDAY'}}};
test('actual frontend renders every canonical KPI as a selected/toggleable shared filter and clear buttons reset it',()=>{
  const {context,get}=fixture(),data=buildRecoveryOverview([raw],{now:'2026-09-18T14:00:00Z',availableMonths:['2026-09']});
  context.ui.state.view='incidents';context.ui.state.summary={incidents:data.summary};context.ui.renderSummary();
  const cards=get('summary').children;assert.equal(cards.length,10);
  for(let i=0;i<cards.length;i++){assert.equal(cards[i].tagName,'button');assert.equal(cards[i]['aria-pressed'],'false');cards[i].events.click();assert.equal(context.ui.state.filters.recovery,data.summary.kpis[i].key);}
  context.ui.renderSummary();const selected=get('summary').children.at(-1);assert.equal(selected['aria-pressed'],'true');selected.events.click();assert.equal(context.ui.state.filters.recovery,'');
  context.ui.state.filters={recovery:'PENDING',priority:'1',month:'2026-09'};context.ui.renderFilters();
  get('filters').children.find(e=>e.className==='recovery-reset' && e.textContent==='Todas (incluye histórico)').events.click();
  assert.equal(context.ui.state.filters.scope,'ALL');assert.equal(context.ui.state.filters.month,'2026-09');assert.equal(context.ui.state.filters.priority,undefined);
  context.ui.renderFilters();get('filters').children.find(e=>e.className==='recovery-reset' && e.textContent==='Pendientes actuales').events.click();
  assert.equal(context.ui.state.filters.scope,'ACTIVE');assert.equal(context.ui.state.filters.month,undefined);
});
test('entering incidents selects the full current queue, not the current monthly history',()=>{
  const {context}=fixture();context.ui.setView('incidents');
  assert.equal(context.ui.state.filters.scope,'ACTIVE');assert.equal(context.ui.state.filters.month,undefined);
});
test('actual row and detail distinguish verified no action from unavailable read and ambiguous reply',()=>{
  const {context}=fixture();
  const silent=buildRecoveryOverview([{...raw,customer_evidence:{code:'NO_VALID_RESPONSE'},scoped_response_status:'NO_VALID_RESPONSE',incident_conversation_read_at:'2026-09-18T14:00:00Z'}],{now:'2026-09-18T14:00:00Z'}).items[0];
  for(const render of [context.ui.rowIncident,context.ui.recoveryEvidenceDetail])assert.match(content(render(silent)),/Ninguna acción realizada/);
  const stale=buildRecoveryOverview([{...silent,chatby_sync_current:false}],{now:'2026-09-18T14:00:00Z'}).items[0];
  assert.doesNotMatch(content(context.ui.rowIncident(stale)),/Ninguna acción realizada/);assert.match(content(context.ui.rowIncident(stale)),/Chatby no verificable/);
  const ambiguous=buildRecoveryOverview([{...raw,customer_evidence:{code:'UNKNOWN',latest_message:'Una duda de prueba',at:'2026-09-18T13:00:00Z',relation:'AFTER_NOTIFICATION'},latest_private_customer_message_type:'BUTTON'}],{now:'2026-09-18T14:00:00Z'}).items[0];
  assert.match(content(context.ui.rowIncident(ambiguous)),/Una duda de prueba/);assert.match(content(context.ui.rowIncident(ambiguous)),/Botón \/ acción/);
});
test('actual row/detail uses scoped evidence, all original states and missing events without execution buttons or HTML',()=>{
  const {context}=fixture(),data=buildRecoveryOverview([raw],{now:'2026-09-18T14:00:00Z'}),item=data.items[0];
  const row=context.ui.rowIncident(item);assert.equal(row.children.length,11);assert.match(content(row),/Cliente actuó|Esperando acción Suleia/);
  const injection='<img src=x onerror=alert(1)>';item.recovery.evidence.message=injection;
  const detail=context.ui.recoveryEvidenceDetail(item);assert.ok(content(detail).includes(injection));assert.equal(all(detail).some(e=>e.tagName==='img'),false);
  assert.equal(all(context.ui.recoveryDetail(item)).some(e=>e.tagName==='button'),false);
  item.customer_evidence.latest_message='CONFIRMAR MI PEDIDO';const invalid=buildRecoveryOverview([item],{now:'2026-09-18T14:00:00Z'}).items[0];
  assert.equal(content(context.ui.rowIncident(invalid)).includes('CONFIRMAR MI PEDIDO'),false);assert.equal(invalid.recovery.evidence.customer_acted,false);
});
test('recovery funnel uses N/D for absent events and new-delivery uses its own canonical filter',()=>{
  const {context,get}=fixture(),data=buildRecoveryOverview([raw],{now:'2026-09-18T14:00:00Z'});context.ui.state.view='incidents';context.ui.renderRecoveryCenter(data.summary);
  assert.match(content(get('recovery-funnel')),/N\/D/);assert.match(content(get('recovery-business-metrics')),/falta timestamp/);
  const stage=get('recovery-funnel').children.find(e=>content(e).includes('Nueva entrega'));stage.events.click();assert.equal(context.ui.state.filters.recovery,'REDELIVERY');
  assert.match(content(get('recovery-method')),/pedidos únicos/);assert.match(content(get('recovery-by-template')),/dropea_ausente_v3/);
});
test('order lane remains seven columns and has no recovery or absent controls',()=>{
  const {context,get}=fixture();context.ui.state.view='orders';context.ui.renderHead();assert.equal(get('table-head').children[0].children.length,7);
  context.ui.renderFilters();assert.equal(content(get('filters')).includes('Recuperable'),false);
  context.ui.renderRecoveryCenter({});assert.equal(get('recovery-center').hidden,true);
});
