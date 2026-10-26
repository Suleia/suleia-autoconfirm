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

test('reference overview has twelve slots and derives attributed AOV without supplying missing reach',()=>{
 const c=fixture(),root=new E('div'),r=report();r.totals.purchaseValue=250;r.previous.purchaseValue=200;r.totals.addToCart=8;r.previous.addToCart=4;r.totals.linkClicks=100;
 c.ui.kpis(root,r,{compact:true});const cards=tree(root).filter(e=>e.tagName==='article');
 assert.equal(cards.length,12);assert.match(text(cards.find(x=>x['data-metric']==='averageOrderValue')),/25,00/);
 assert.match(text(cards.find(x=>x['data-metric']==='reach')),/N\/D/);
 assert.match(text(cards.find(x=>x['data-metric']==='addToCart')),/Añadidos al carrito/);assert.match(text(cards.find(x=>x['data-metric']==='addToCart')),/100 %/);assert.match(text(cards.find(x=>x['data-metric']==='linkClicks')),/100/);
});
test('mini-series use weighted ratios and retain missing entity/day gaps and non-additive reach',()=>{
 const c=fixture(),r=report();r.rows=[{source:'META_INSIGHTS',series:[{since:'2026-10-17',spend:10,purchases:2,purchaseValue:50,reach:100}]},{source:'META_INSIGHTS',series:[{since:'2026-10-17',spend:90,purchases:3,purchaseValue:150,reach:200},{since:'2026-10-18',spend:10,purchases:1,purchaseValue:20}]}];
 const points=c.ui.dailyPoints(r);assert.equal(points[0].metrics.roas,2);assert.equal(points[0].metrics.cpa,20);
 assert.equal(points[0].metrics.averageOrderValue,40);assert.equal(points[0].metrics.reach,null);
 assert.equal(points[1].metrics.spend,null);assert.equal(points[1].metrics.roas,null);
});

test('verified native account totals outrank a partial campaign subtotal without inventing filtered reach',()=>{
 const c=fixture(),r=report();r.totals={...r.totals,scope:'PROVIDER_ACCOUNT',reach:51497,impressions:121530,addToCart:498};r.previous.reach=30618;
 r.subtotal={state:'PARTIAL',included:9,total:10,metrics:{...r.totals,scope:undefined,reach:null,impressions:121531}};
 const root=new E('div');c.ui.kpis(root,r,{compact:true});let cards=tree(root).filter(e=>e.tagName==='article');
 assert.match(text(cards.find(x=>x['data-metric']==='reach')),/51\.497/);assert.match(text(cards.find(x=>x['data-metric']==='impressions')),/121\.530/);assert.doesNotMatch(text(root),/Subtotal verificado/);
 delete r.totals.scope;const filtered=new E('div');c.ui.kpis(filtered,r,{compact:true});cards=tree(filtered).filter(e=>e.tagName==='article');
 assert.match(text(cards.find(x=>x['data-metric']==='reach')),/N\/D/);assert.match(text(filtered),/Subtotal verificado/);
});
test('combined plot keeps three independently labelled units and does not bridge missing observations',()=>{
 const c=fixture(),root=new E('div'),r=report();r.growth={trend:{current:[{day:'2026-10-17',metrics:{spend:10,purchases:2,roas:3}},{day:'2026-10-18',metrics:{}},{day:'2026-10-19',metrics:{spend:20,purchases:3,roas:4}}],previous:[]}};
 c.ui.chart(root,r);const lines=tree(root).filter(e=>e.tagName==='path'&&e['data-metric']);
 assert.equal(lines.length,3);for(const line of lines){assert.equal((line.d.match(/M/g)||[]).length,2);assert.equal(line.d.includes('L'),false);}
 assert.match(text(root),/Gasto \(€\)/);assert.match(text(root),/Compras/);assert.match(text(root),/ROAS \(×\)/);
});

test('overview sparklines use the completed shared trend even when initial report rows have no daily series',()=>{
 const c=fixture(),r=report(),root=new E('div');r.growth={trend:{current:[{day:'2026-10-17',metrics:{spend:20,purchases:2,purchaseValue:40}},{day:'2026-10-18',metrics:{spend:30,purchases:3,purchaseValue:90}}]}};
 c.ui.kpis(root,r,{compact:true});const cards=tree(root).filter(e=>e.tagName==='article');
 for(const key of ['spend','purchases','averageOrderValue']){const card=cards.find(x=>x['data-metric']===key);assert.ok(tree(card).some(x=>x.tagName==='path'&&x.d?.includes('L')));}
 assert.equal(tree(cards.find(x=>x['data-metric']==='reach')).some(x=>x.tagName==='path'&&x.d?.includes('L')),false);
});
