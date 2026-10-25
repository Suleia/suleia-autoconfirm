import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
class Element{constructor(tag='div'){this.tag=tag;this.children=[];this.textContent='';this.style={};this.namespaceURI='http://www.w3.org/2000/svg';}append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;}setAttribute(){}addEventListener(){}set innerHTML(_){throw Error('UNSAFE_HTML');}}
const content=e=>[e.textContent,...e.children.map(content)].join(' ').replace(/\s+/g,' ').trim();
test('Autopilot UI renders source truth, guards and untrusted campaign names without HTML execution',async()=>{
 const root=new Element(),name='<img src=x onerror=alert(1)>',calls=[];
 const data={mode:'SHADOW',enabled:false,writesEnabled:false,observedAt:'2026-10-22T10:00Z',nextReviewAt:'2026-10-22T11:00Z',lastExecutionAt:null,campaigns:[{campaignId:'11',name,before:2500,after:3500,action:'INCREASE',metric:{metaRoas:null,purchases:null},nightTargetCents:2000,reasons:['OPERATING_MINIMUM_NOT_APPROVED'],lastChangeAt:null}],timeline:[],alerts:[],reviewTimes:['07:00','12:00','19:00','22:30','23:59'],policyConflicts:['OPERATING_MINIMUM_NOT_APPROVED'],legacyLimits:{maxChangePercent:10,maxAggregateIncreaseCents:3000,campaignCooldownMs:86400000}};
 const node=(tag,_class,text)=>{const e=new Element(tag);e.textContent=text===undefined?'':String(text);return e;};
 const ctx={node,$:()=>root,document:{createElementNS:(_,tag)=>new Element(tag)},Date,Intl,Number,api:async url=>{calls.push(url);return data;}};
 vm.runInNewContext(fs.readFileSync(new URL('./budget-autopilot-v5.js',import.meta.url),'utf8')+';globalThis.panel=BudgetAutopilotPanel;',ctx);await ctx.panel.load();
 const text=content(root);assert.ok(text.includes(name));assert.match(text,/SHADOW/);assert.match(text,/Escrituras Meta desactivadas/);assert.match(text,/Mínimo operativo sin aprobar/);assert.match(text,/N\/D/);assert.match(text,/No equivale a gasto consumido/);assert.match(text,/Sin historia se muestra un solo punto/);assert.deepEqual(calls,['/api/operations/ads-intelligence/autopilot']);
});
test('Autopilot UI refuses stale success on a failed read and assets are loaded once',async()=>{
 const root=new Element(),node=(tag,_class,text)=>{const e=new Element(tag);e.textContent=text||'';return e;};
 const ctx={node,$:()=>root,api:async()=>{throw Error('unavailable');}};vm.runInNewContext(fs.readFileSync(new URL('./budget-autopilot-v5.js',import.meta.url),'utf8')+';globalThis.panel=BudgetAutopilotPanel;',ctx);await ctx.panel.load();assert.match(content(root),/No se ha podido verificar/);
 const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');assert.equal((html.match(/budget-autopilot-v5\.js/g)||[]).length,1);assert.equal((html.match(/budget-autopilot-v5\.css/g)||[]).length,1);
});

test('V6 view states the real monetary policy, verification and coverage instead of legacy ceilings',async()=>{
 const root=new Element(),node=(tag,cls,text)=>{const e=new Element(tag);e.textContent=text??'';return e;};
 const data={version:'SULEIA_META_AUTOPILOT_V6',mode:'LIVE',enabled:true,writesEnabled:true,policy:{maxBudgetCents:10000},approved:{policyProfile:'V6_FIXED_EUR',minimumBudgetCents:1500,globalExposureCents:100000},legacyLimits:{maxAggregateIncreaseCents:36000},quota:{circuit:'CLOSED',requests:3},observedAt:'2026-10-25T14:00Z',nextReviewAt:'2026-10-25T15:00Z',campaigns:[],timeline:[],slots:[],alerts:[],policyConflicts:[],reviewTimes:['08:00','10:00','12:00','16:00','18:00','22:30'],limitations:['Compras nuevas: procedencia sin acreditar.'],liveActivation:{stage:'CANARY_PENDING'}};
 const ctx={node,$:()=>root,document:{createElementNS:(_,tag)=>new Element(tag)},Date,Intl,Number,api:async()=>data};vm.runInNewContext(fs.readFileSync(new URL('./budget-autopilot-v5.js',import.meta.url),'utf8')+';globalThis.panel=BudgetAutopilotPanel;',ctx);await ctx.panel.load();
 const text=content(root);assert.match(text,/CONTROL EN TIEMPO REAL/);assert.match(text,/Máximo 100/);assert.match(text,/360/);assert.match(text,/−30 % independiente del ROAS/);assert.match(text,/Sin restauración matinal/);assert.match(text,/primer cambio elegible debe verificarse/);assert.match(text,/procedencia sin acreditar/);assert.doesNotMatch(text,/Máximo 70|23:59|Techos.*20/);
});
