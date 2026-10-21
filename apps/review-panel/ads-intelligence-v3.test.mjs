import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {assembleReport} from '../../services/meta-ads/report.mjs';
class Element{
 constructor(tag='div'){this.tag=tag;this.children=[];this.textContent='';this.classList={add:()=>{}};this.namespaceURI='http://www.w3.org/2000/svg';}
 append(...nodes){this.children.push(...nodes);} replaceChildren(...nodes){this.children=nodes;}
 setAttribute(){} addEventListener(){} querySelector(tag){return this.children.find(c=>c.tag===tag)||this.children.map(c=>c.querySelector(tag)).find(Boolean);}
 set innerHTML(_){throw Error('UNSAFE_HTML');}
}
const content=e=>[e.textContent,...e.children.map(content)].join(' ').replace(/\s+/g,' ').trim();
test('V3 renders unknown data and untrusted inventory names safely using the canonical report',async()=>{
 const root=new Element(),name='<img src=x onerror=alert(1)>',calls=[];
 const data=assembleReport({account:{id:'act_9',currency:'EUR',timezone_name:'Europe/Madrid'},range:{since:'2026-10-14',until:'2026-10-20',partial:false},comparison:{},observedAt:'2026-10-21T10:00:00Z',current:{campaign:[],adset:[],ad:[]},prior:{campaign:[],adset:[],ad:[]},daily:{campaign:[],adset:[],ad:[]},entities:{campaign:[{id:'1',name}],adset:[],ad:[]}});data.proposals=[];data.recommendationProposals=[];
 const node=(tag,cls,text)=>{const e=new Element(tag);e.textContent=text===undefined?'':String(text);return e;};
 const ctx={node,$:()=>root,document:{createElementNS:(_,tag)=>new Element(tag)},Date,URLSearchParams,Number,Intl,api:async url=>{calls.push(url);return data;}};
 vm.runInNewContext(fs.readFileSync(new URL('./ads-intelligence-v3.js',import.meta.url),'utf8')+';globalThis.panel=AdsIntelligencePanel;',ctx);await ctx.panel.load();
 const text=content(root);assert.match(text,/No disponible/);assert.match(text,/Sin atribución/);assert.match(text,/LIVE desactivado/);assert.ok(text.includes(name));assert.match(text,/no usuarios únicos/);assert.equal(calls.length,1);assert.match(calls[0],/period=7d&level=campaign/);
});
test('production HTML loads the tested V3 assets',()=>{const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');assert.match(html,/ads-intelligence-v3.js/);assert.match(html,/ads-intelligence-v3.css/);assert.ok(!html.includes('src="ads-intelligence.js'));});
test('stale API fallback is visibly marked before recommendations and clears after a fresh read',async()=>{
 const root=new Element(),observedAt='2026-10-21T10:00:00Z';
 const report=assembleReport({account:{id:'act_9',currency:'EUR',timezone_name:'Europe/Madrid'},range:{since:'2026-10-14',until:'2026-10-20',partial:false},comparison:{},observedAt,current:{campaign:[],adset:[],ad:[]},prior:{campaign:[],adset:[],ad:[]},daily:{campaign:[],adset:[],ad:[]},entities:{campaign:[],adset:[],ad:[]}});
 report.proposals=[];report.recommendationProposals=[];report.actions.push({title:'Revisar conversión',name:'Fixture',reason:'Comparar la lectura previa',priority:1,confidence:'MEDIUM',category:'web',action:'Revisar ficha',entityId:'1'});
 const totals=structuredClone(report.totals),quality=structuredClone(report.quality);let stale=true;
 const node=(tag,cls,text)=>{const e=new Element(tag);e.textContent=text===undefined?'':String(text);return e;};
 const ctx={node,$:()=>root,document:{createElementNS:(_,tag)=>new Element(tag)},Date,URLSearchParams,Number,Intl,api:async()=>({...report,cache:{status:stale?'STALE':'FRESH',observedAt}})};
 vm.runInNewContext(fs.readFileSync(new URL('./ads-intelligence-v3.js',import.meta.url),'utf8')+';globalThis.panel=AdsIntelligencePanel;',ctx);
 await ctx.panel.load();let text=content(root);
 assert.match(text,/Datos de Meta desactualizados/);assert.match(text,/No se ha verificado una lectura actual de Meta/);
 assert.match(text,/Última observación:/);assert.match(text,/Revisar conversión/);
 assert.ok(text.indexOf('Datos de Meta desactualizados')<text.indexOf('Diagnóstico rápido'));
 assert.ok(text.indexOf('Datos de Meta desactualizados')<text.indexOf('Soluciones propuestas'));
 assert.equal(root.children[1].tag,'aside');assert.deepEqual(report.totals,totals);assert.deepEqual(report.quality,quality);assert.equal(report.observedAt,observedAt);
 stale=false;await ctx.panel.load();text=content(root);assert.ok(!text.includes('Datos de Meta desactualizados'));assert.match(text,/Revisar conversión/);
});
