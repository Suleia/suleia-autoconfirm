import test from 'node:test';import assert from 'node:assert/strict';import {reportReader} from './report-reader.mjs';
test('report-only inventory is coalesced across periods; financial reader and Insights are never cached',async()=>{
 let now=1000,inventory=0,insights=0,fail=false;
 const original={async readEntities(){inventory++;if(fail)throw Error('META_RATE_LIMITED');return [{id:'1'}];},async readInsights(){insights++;return [];}};
 const view=reportReader(original,{now:()=>now});await Promise.all([view.readEntities('ad'),view.readEntities('ad')]);assert.equal(inventory,1);
 await view.readEntities('ad');assert.equal(inventory,1);await original.readEntities('ad');assert.equal(inventory,2);
 await view.readInsights({period:'hoy'});await view.readInsights({period:'hoy'});assert.equal(insights,2);
 now+=61000;fail=true;await assert.rejects(view.readEntities('ad'));await assert.rejects(view.readEntities('ad'));assert.equal(inventory,4);
 fail=false;await view.readEntities('ad');assert.equal(inventory,5);
});
