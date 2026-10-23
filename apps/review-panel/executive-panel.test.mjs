import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
class Element {
 constructor(tag='div',className='',text=''){Object.assign(this,{tagName:tag,className,textContent:text,children:[],events:{},dataset:{},classList:{add(){}}});}
 append(...children){this.children.push(...children);}
 replaceChildren(...children){this.children=children;}
 addEventListener(k,fn){this.events[k]=fn;}
 setAttribute(k,v){this[k]=v;}
 contains(target){return this===target||this.children.some(c=>c instanceof Element&&c.contains(target));}
 querySelector(){return null;}
}
test('the report tab displays the latest report immediately and retains the opened report on refresh',async()=>{
 const root=new Element(),calls=[],id='a'.repeat(64),other='b'.repeat(64);
 const node=(tag,cls='',text='')=>new Element(tag,cls,text);
 const context={node,state:{view:'ads'},location:{hash:'#ads?tab=reports'},URLSearchParams,Intl,date:String,setTimeout,
  document:{createTextNode:String},CampaignReviewPanel:{navigate(){}},
  api:async path=>{calls.push(path);return path.includes('/history?')?{entries:[{id,kind:'MANUAL',state:'READY',created_at:'2026-10-23T10:00:00Z'}],enabled:true,time:'22:30',timezone:'Europe/Madrid',nextExecution:'2026-10-23T20:30:00Z',recipientsCount:1}:{id:path.endsWith(other)?other:id,state:'READY',kind:'MANUAL',body:{messages:[1,2,3,4].map(part=>({part,text:'Verified report '+part})),evidence:{}},deliveries:[]};}
 };
 vm.runInNewContext(fs.readFileSync(new URL('./ads-executive-v8.js',import.meta.url),'utf8')+'\nglobalThis.ui=ExecutiveReportPanel;',context);
 await context.ui.load(root);
 assert.ok(calls.includes('/api/operations/ads-intelligence/executive/'+id),'history alone must not leave the report body empty');
 const all=e=>[e,...e.children.flatMap(c=>c instanceof Element?all(c):[])];
 assert.equal(all(root).filter(e=>e.className.split(' ').includes('executive-message')).length,4);
 context.location.hash='#ads?tab=reports&reportId='+other;
 await context.ui.load(root);
 context.location.hash='#ads?tab=reports';calls.length=0;await context.ui.load(root);
 assert.ok(calls.includes('/api/operations/ads-intelligence/executive/'+other));
 assert.ok(calls.every(p=>!p.includes('generate')),'viewing reports must not create or send them');
});
