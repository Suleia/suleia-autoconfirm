import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
class E{
 constructor(tag,cls='',text){this.tagName=tag;this.className=cls;this.textContent=text??'';this.children=[];this.events={};this.namespaceURI='http://www.w3.org/2000/svg';this.classList={add(){}};}
 append(...items){for(const item of items){item.parent=this;this.children.push(item);}}
 replaceChildren(...items){this.children=[];this.append(...items);}
 replaceWith(next){const i=this.parent.children.indexOf(this);next.parent=this.parent;this.parent.children[i]=next;}
 get lastChild(){return this.children.at(-1);}
 setAttribute(k,v){this[k]=v;if(k==='class')this.className=v;}
 addEventListener(k,fn){this.events[k]=fn;}
 showModal(){this.open=true;}
 close(){this.open=false;}
 set innerHTML(_){throw Error('HTML_INJECTION_FORBIDDEN');}
}
const tree=e=>[e,...e.children.flatMap(tree)],text=e=>[e.textContent,...e.children.map(text)].join(' ');
function fixture(){const c={URL,URLSearchParams,Intl,Number,console,date:v=>v||'N/D',location:{origin:'https://panel.example',hash:''},node:(...args)=>new E(...args),document:{body:new E('body'),createElementNS:(_ns,tag)=>new E(tag)}};vm.runInNewContext(fs.readFileSync(new URL('./ads-growth-v10.js',import.meta.url),'utf8')+'\nglobalThis.ui=GrowthIntelligencePanel;',c);vm.runInNewContext(fs.readFileSync(new URL('./ads-growth-drawer-v10.js',import.meta.url),'utf8')+'\nglobalThis.drawer=GrowthAnalysisDrawer;',c);return c;}
const report=()=>({range:{since:'2026-10-17',until:'2026-10-23'},observedAt:'2026-10-24T18:00:00Z',freshness:'FRESH',comparison:{comparable:true},totals:{spend:200,cpa:20,roas:4,purchases:10,purchaseType:'web'},previous:{spend:100,cpa:10,roas:3,purchases:10,purchaseType:'web'},rows:[]});
test('V10 KPI costs rising are adverse, spend neutral and absent values stay N/D',()=>{const c=fixture(),root=new E('div');c.ui.kpis(root,report());const cards=tree(root).filter(e=>e.tagName==='article');assert.equal(cards.length,18);assert.match(text(cards[3]),/20,00/);assert.ok(tree(cards[3]).some(e=>e.className==='gi-change adverse'));assert.ok(tree(cards[0]).some(e=>e.className==='gi-change neutral'));assert.match(text(cards[4]),/N\/D/);assert.doesNotMatch(text(cards[4]),/0 %/);});
test('V10 ambiguous purchase scopes cannot produce misleading conversion deltas',()=>{const c=fixture(),root=new E('div'),r=report();r.previous.purchaseType='omni';c.ui.kpis(root,r);const cards=tree(root).filter(e=>e.tagName==='article');assert.match(text(cards[1]),/Sin comparación válida/);assert.match(text(cards[3]),/Sin comparación válida/);});
test('V10 creator text remains inert and absent/unsafe images cannot trigger navigation or phantom URLs',()=>{const c=fixture(),card=c.ui.decisionCard({name:'<img src=x onerror=alert(1)>',why:'<script>bad</script>',status:'INVESTIGAR',level:'campaign',evidence:{week:{}},id:'1'},{});assert.match(text(card),/<img/);assert.equal(tree(card).some(e=>e.tagName==='img'||e.tagName==='script'),false);for(const creative of[null,{image_url:'javascript:alert(1)'},{image_url:'https://evil.example/image.jpg'},{image_url:'https://user:credential@fbcdn.net/a.jpg'}])assert.equal(tree(c.drawer.image(creative,'DEMO')).some(e=>e.tagName==='img'),false);assert.equal(tree(c.drawer.image({image_url:'https://scontent.fbcdn.net/a.jpg'},'DEMO')).some(e=>e.tagName==='img'),true);});
test('V10 fallback chart aggregates attributed value/spend rather than averaging entity ROAS',()=>{const c=fixture(),root=new E('div'),r=report();r.rows=[{source:'META_INSIGHTS',series:[{since:'2026-10-17',spend:100,purchaseValue:100,roas:1}]},{source:'META_INSIGHTS',series:[{since:'2026-10-17',spend:200,purchaseValue:800,roas:4}]}];c.ui.chart(root,r);assert.ok(tree(root).some(e=>e.tagName==='title'&&e.textContent.includes('Actual 2026-10-17: 3×')));assert.equal(tree(root).some(e=>e.tagName==='title'&&e.textContent.includes('2,5×')),false);});
test('a saved drawer never substitutes metrics or children from a different dated report',()=>{const c=fixture(),item={id:'101',campaignId:'101',level:'campaign',name:'Original DEMO',status:'MANTENER',evidence:{week:{spend:12,purchases:2},ranges:{week:{since:'2026-09-01',until:'2026-09-07'}}}},body={observedAt:'2026-09-08',evidence:{week:{range:{since:'2026-10-01',until:'2026-10-07'},rows:[{entityId:'101',spend:999}]},ads:{range:{since:'2026-10-01',until:'2026-10-07'},rows:[{entityId:'301',campaignId:'101',name:'WRONG_PERIOD_CHILD'}]}}};c.drawer.openSnapshot(item,body);const out=text(c.document.body);assert.match(out,/12,00/);assert.doesNotMatch(out,/999|WRONG_PERIOD_CHILD/);assert.ok(tree(c.document.body).filter(e=>e.tagName==='button'&&['Preparar propuesta','Registrar observación'].includes(e.textContent)).every(e=>e.disabled));});
