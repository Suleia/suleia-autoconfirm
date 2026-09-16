import test from 'node:test';
import assert from 'node:assert/strict';
import { createAbsentLogisticsReader } from './absent-read-context.mjs';
test('absent logistics only reuses getOrder and official tracking read; never invents capability',async()=>{
  const calls=[];
  const read=createAbsentLogisticsReader([{store:{market:'ES',store_id:'1'},client:{request:async(name)=>{
    calls.push(name);return {data:{id:7,tracking_number:'123',shipping_address:{postal_code:'28000'}}};
  }}}],{glsRead:async()=>{calls.push('GLS_TRACKING_READ');return {source:'GLS tracking oficial'};}});
  const r=await read({type:'RECIPIENT_ABSENT',raw_type:'RECIPIENT_ABSENT',market:'ES',store_id:'1',dropea_order_id:'7'});
  assert.deepEqual(calls,['getOrder','GLS_TRACKING_READ']);assert.equal(r.gls.capability_status,'UNKNOWN');
  assert.equal(r.gls.package_operable,null);
});
test('NAM ambiguity and other types cannot call any connector',async()=>{
  const read=createAbsentLogisticsReader([],{glsRead:async()=>{throw new Error('must not read');}});
  assert.equal((await read({type:'RECIPIENT_ABSENT',raw_type:'GENERAL_INCIDENCE',initial_carrier_code:'NAM'})).reason,'ABSENT_MAPPING_NOT_VERIFIED');
  assert.equal((await read({type:'REFUSED_BY_RECIPIENT'})).reason,'ABSENT_MAPPING_NOT_VERIFIED');
});
