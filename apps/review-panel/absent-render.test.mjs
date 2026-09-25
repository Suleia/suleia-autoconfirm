import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {simulateRecipientAbsent} from '../../packages/platform-core/src/incident/recipient-absent-policy.mjs';
class Element {
  constructor(tag='div'){this.tagName=tag;this.children=[];this.textContent='';this.events={};this.style={};this.classList={add(){},remove(){},toggle(){}};}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=children;}
  setAttribute(k,v){this[k]=String(v);}
  addEventListener(k,fn){this.events[k]=fn;}
}
const content=e=>`${e.textContent||''} ${e.children.map(c=>typeof c==='string'?c:content(c)).join(' ')}`;
const descendants=e=>[e,...e.children.filter(c=>typeof c!=='string').flatMap(descendants)];
async function fixture(){
  const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  const context={URL,URLSearchParams,Intl,console,AbortController,setInterval(){},location:{origin:'https://mcp.suleia.com',pathname:'/operations/',search:''},history:{replaceState(){}},sessionStorage:{getItem(){return null;},setItem(){},removeItem(){}},Option:class extends Element{constructor(label,value){super('option');this.textContent=label;this.value=value;}},
    document:{getElementById:get,createElement:tag=>new Element(tag),createTextNode:text=>text,querySelectorAll:()=>[],addEventListener(){}},
    fetch:async()=>({ok:true,json:async()=>({oauth:{issuer:'https://mcp.suleia.com/auth/realms/suleia',client_id:'suleia-operations-center',audience:'suleia-operations-center',scope:'openid operations:read'}})})};
  const source=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8')+'\nglobalThis.ui={state,renderFilters,absentShadowCard};';
  await vm.runInNewContext(source,context);return {context,get};
}
test('actual incident frontend renders the canonical shadow card without execution controls or HTML parsing',async()=>{
  const {context}=await fixture();const at='2026-09-16T12:00:00Z';
  const {shadow}=simulateRecipientAbsent({issue:{canonical_issue_id:'i',type:'RECIPIENT_ABSENT',status:'PENDING',is_active:true,created_at:at,updated_at:at},order:{canonical_order_id:'o'},chatby:{},events:[]},{now:at});
  const card=context.ui.absentShadowCard({absent_shadow:shadow},true);
  assert.match(content(card),/SIGUIENTE ACCIÓN · SIMULACIÓN/);assert.match(content(card),/Intento no verificable/);
  for(const label of ['Viabilidad','Confianza','Timer existente','Policy','Dropea / Chatby / GLS','Historial relevante'])assert.ok(content(card).includes(label));
  assert.equal(descendants(card).filter(e=>e.tagName==='button').length,0);
  const injected=context.ui.absentShadowCard({absent_shadow:{...shadow,reason_text:'<img src=x onerror=alert(1)>'}});
  assert.ok(content(injected).includes('<img src=x onerror=alert(1)>'));assert.equal(descendants(injected).some(e=>e.tagName==='img'),false);
});
test('twelve absent filters are clickable and are absent from the order lane',async()=>{
  const {context,get}=await fixture();context.ui.state.view='incidents';context.ui.renderFilters();
  const chips=get('filters').children.filter(e=>e.tagName==='button' && e.className.includes('absent-filter'));assert.equal(chips.length,12);
  assert.equal(chips.every(e=>typeof e.events.click==='function'),true);chips[0].events.click();assert.equal(context.ui.state.filters.absent,'AUSENTE');
  context.ui.state.view='orders';context.ui.renderFilters();assert.equal(content(get('filters')).includes('Primera ausencia'),false);
});
test('resolution result and ambiguity are visible without logs; phone remains masked',async()=>{
 const {context}=await fixture();
 const ready={title:'Solución aportada',next_action:'Nueva entrega por la tarde',detail:'Se solicitó entrega por la tarde con llamada previa.',interpretation:'Nueva entrega',requested_date:'2026-09-23',window:'Tarde',phone:'••••0001',evidence:'Botón Chatby verificado'};
 const card=context.ui.absentShadowCard({absent_resolution:ready,latest_customer_message:'Mañana por la tarde'});
 for(const phrase of ['Solución aportada','Nueva entrega por la tarde','23/09/2026','Botón Chatby verificado','••••0001'])assert.ok(content(card).includes(phrase));
 assert.ok(!content(card).includes('SIMULACIÓN'));
 const ambiguous=context.ui.absentShadowCard({absent_resolution:{...ready,title:'Revisión humana',detail:'Fecha de entrega no inequívoca.',next_action:'Revisar preferencia del cliente',interpretation:'Ambigua'}});
 assert.match(content(ambiguous),/Fecha de entrega no inequívoca/);
});

test('verified native notification renders actual sending and timer without a shadow claim',async()=>{
 const {context}=await fixture();const card=context.ui.absentShadowCard({absent_native_notice:{status:'VERIFIED',template_name:'dropea_ausente_v3',notification_at:'2026-09-25T12:00:00Z',timer_due_at:'2099-01-01T12:00:00Z',message_id:'internal-debug-only'}});
 assert.match(content(card),/NOTIFICACIÓN AUSENTE · ENVIADA/);assert.match(content(card),/dropea_ausente_v3/);assert.match(content(card),/Activo/);assert.match(content(card),/Esperando cliente/);
 assert.doesNotMatch(content(card),/SIMULACIÓN|SHADOW|internal-debug-only/);
});
