import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
class Element{
 constructor(){this.children=[];this.textContent='';}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.children=nodes;}
 setAttribute(){} addEventListener(){}
 set innerHTML(_){throw Error('UNSAFE_HTML');}
}
const content=e=>[e.textContent,...e.children.map(content)].join(' ').replace(/\s+/g,' ').trim();
test('Ads panel preserves missing metrics, displays review state and renders untrusted names as text',async()=>{
 const root=new Element(),calls=[],name='<img src=x onerror=alert(1)>';
 const data={range:{since:'2026-10-14',until:'2026-10-20'},mode:'SHADOW',observedAt:'2026-10-21T08:00:00Z',contract:'fixture-contract',limits:{maxBudgetCents:10000,maxChangePercent:10,minSpend:null,minPurchases:null,minImpressions:null},inventory:{rules:[],campaigns:[{id:'1',name,daily_budget:'5000'}]},facts:[{campaignId:'1',entityId:'1',name,spend:null,purchases:null,purchaseValue:null,roas:null,roasStatus:'MISSING',source:'META_NO_INSIGHT_ROW',diagnoses:[]}],proposals:[{id:'test',state:'REVIEW_REQUIRED',mode:'SHADOW',request:'Fixture request',expiresAt:Date.now(),items:[{campaignId:'1',name,before:5000,after:5500,reasons:[],result:{state:'UNKNOWN',reasons:['PROVIDER_RESULT_UNKNOWN']}}]}]};
 const node=(_,__,text)=>{const el=new Element();el.textContent=text===undefined?'':String(text);return el;};
 const ctx={node,$:()=>root,money:v=>v===null||v===undefined?'No disponible':'EUR '+v,date:v=>String(v),Date,api:async url=>{calls.push(url);return data;}};
 vm.runInNewContext(fs.readFileSync(new URL('./ads-intelligence.js',import.meta.url),'utf8')+';globalThis.panel=AdsIntelligencePanel;',ctx);
 await ctx.panel.load();const rendered=content(root);
 assert.match(rendered,/Gasto: No disponible/);assert.match(rendered,/Revisión necesaria/);assert.match(rendered,/Resultado de Meta incierto/);assert.match(rendered,/LIVE desactivado/);assert.ok(rendered.includes(name));assert.equal(calls.length,1);assert.match(calls[0],/period=7d&level=campaign/);
});
