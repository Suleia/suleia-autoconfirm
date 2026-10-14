import test from 'node:test';
import assert from 'node:assert/strict';
import {loadStartupAppState} from './startup-state.mjs';
test('startup restores all three caches even beyond hundreds of unrelated state records',async()=>{
 const expected=['runtime_state','operational_orders_cache','incidents_cache'];
 const database=[...Array.from({length:250},(_,i)=>({key:'unrelated_'+i})),...expected.map(key=>({key,value:{fixture:true}}))];
 const rows=await loadStartupAppState(async(table,{query,limit})=>{
  assert.equal(table,'app_state');
  const keys=query?.key?.match(/^in\.\((.*)\)$/)?.[1].split(',');
  return database.filter(row=>!keys||keys.includes(row.key)).slice(0,limit);
 });
 assert.deepEqual(rows.map(row=>row.key),expected);
});
