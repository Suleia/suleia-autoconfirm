import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeOrders,readOrderSummary,OrderSummaryReader,orderSummaryIntent} from './order-summary.mjs';
import {businessDayBounds} from '../../packages/platform-core/src/business-day.mjs';
const now=Date.parse('2026-10-21T18:28:00Z'),at=new Date(now).toISOString();
const fixture=()=>Array.from({length:22},(_,i)=>({market:'ES',store_id:'1',dropea_order_id:String(i+1),created_at_utc:'2026-10-21T08:00:00Z',confirmed_at_utc:i<17?'2026-10-21T09:00:00Z':null,status:i<17?'SHIPPING':i<21?'PENDING':'CANCELLED',sub_status:i<17?'PREPARED':null,observed_at:at,source_updated_at:at}));
test('historical 22/17/4/1, SHIPPING confirmation and deduplication',()=>{
 const rows=fixture(),r=summarizeOrders([...rows,rows[0]],now);
 assert.deepEqual([r.received,r.confirmed,r.pending,r.cancelled],[22,17,4,1]);assert.equal((r.confirmed/r.received*100).toFixed(1),'77.3');
});
test('old orders confirmed today are distinct from today cohort',()=>{
 const rows=fixture();rows.push({...rows[0],dropea_order_id:'old',created_at_utc:'2026-10-20T08:00:00Z'});
 const r=summarizeOrders(rows,now);assert.equal(r.confirmations,18);assert.equal(r.confirmed,17);assert.equal(r.received,22);
});
test('Madrid midnight and both daylight-saving transitions',()=>{
 for(const [day,hours] of [['2026-03-29',23],['2026-10-25',25]])assert.equal(businessDayBounds({businessDate:day}).duration_hours,hours);
 const r=summarizeOrders([{...fixture()[0],created_at_utc:'2026-10-20T22:00:00Z'},{...fixture()[1],created_at_utc:'2026-10-20T21:59:59Z'}],now);assert.equal(r.received,1);
});
test('rolling hour spans midnight, cancellation precedence and missing identity',()=>{
 const n=Date.parse('2026-10-21T22:10:00Z'),r=summarizeOrders([{...fixture()[0],created_at_utc:'2026-10-21T21:45:00Z'},{...fixture()[1],created_at_utc:'2026-10-21T22:00:00Z',status:'CANCELLED'},{status:'PENDING'}],n);
 assert.equal(r.last_hour,2);assert.equal(r.received,1);assert.equal(r.cancelled,1);assert.equal(r.confirmed,0);assert.equal(r.identityComplete,false);
});
test('canonical read uses conservative clocks, complete pagination and read-only query',async()=>{
 let health={last_success_at:at,pagination_complete:true},orders=fixture();
 const pool={query:async q=>{assert.match(q.text,/read_models.operations_order_context/);assert.doesNotMatch(q.text,/INSERT|UPDATE|DELETE/);assert.equal(q.query_timeout,2000);return {rows:[{orders,health:[health]}]};}};
 let r=await readOrderSummary(pool,now);assert.equal(r.freshness,'FRESH');assert.equal(r.received,22);
 orders[0].observed_at='2026-10-21T18:20:00Z';assert.equal((await readOrderSummary(pool,now)).freshness,'STALE');
 health.pagination_complete=false;assert.equal((await readOrderSummary(pool,now)).coverage,'UNVERIFIED');
});
test('concurrent read/refresh consolidated; outages preserve real observation',async()=>{
 let reads=0,refreshes=0,fail=false;
 const reader=new OrderSummaryReader({now:()=>now,read:async()=>{reads++;if(fail)throw Error('offline');return {day:'2026-10-21',coverage:'COMPLETE',freshness:refreshes?'FRESH':'STALE',observedAt:at,received:22};},refresh:async()=>{refreshes++;}});
 const results=await Promise.all(Array.from({length:10},()=>reader.get()));assert.equal(reads,2);assert.equal(refreshes,1);assert.equal(results[0].received,22);
 fail=true;const stale=await reader.get();assert.equal(stale.freshness,'STALE');assert.equal(stale.observedAt,at);
});
test('cold timeout is bounded without restarting the in-flight read',async()=>{
 let resolve,reads=0;const reader=new OrderSummaryReader({read:()=>{reads++;return new Promise(r=>resolve=r);},timeoutMs:10});
 assert.equal((await reader.get()).freshness,'UNAVAILABLE');assert.equal((await reader.get()).freshness,'UNAVAILABLE');assert.equal(reads,1);resolve({coverage:'UNVERIFIED'});
});
test('all requested order phrases route without an exact ID',()=>{
 for(const t of ['¿Cuántos pedidos llevamos hoy?','¿Cuántos están confirmados?','¿Cómo vamos de pedidos?','¿Cuántos pendientes hay?','Actualízame las ventas'])assert.equal(orderSummaryIntent(t),'today');
 assert.equal(orderSummaryIntent('¿Cuántos pedidos hemos confirmado hoy?'),'confirmations');assert.equal(orderSummaryIntent('¿Cuántos pedidos han entrado en la última hora?'),'hour');
});
