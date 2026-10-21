import test from 'node:test';import assert from 'node:assert/strict';
import {parseOrderRequest,parsePeriodText,resolvePeriod} from './periods.mjs';
import {summarizeOrders} from './order-summary.mjs';
const now=Date.parse('2026-10-22T10:00:00Z');
test('all requested natural summaries and explicit periods',()=>{
 for(const text of ['como van los pedidos ahora','como van los pedidos hoy','dame información de los pedidos','pedidos de hoy'])assert.equal(parseOrderRequest(text,now).period.preset,'today');
 assert.equal(parsePeriodText('pedidos de ayer',now).preset,'yesterday');
 assert.equal(parsePeriodText('últimas dos semanas',now).preset,'14d');
 assert.equal(parsePeriodText('últimas 48 horas',now).preset,'48h');
 assert.ok(parsePeriodText('48 horas antes',now).question);
 assert.deepEqual(parsePeriodText('del 15 de octubre',now),{preset:'custom',from:'2026-10-15',to:'2026-10-15'});
 assert.deepEqual(parsePeriodText('entre el 1 y el 15 de octubre',now),{preset:'custom',from:'2026-10-01',to:'2026-10-15'});
 assert.ok(parsePeriodText('del 31 de febrero de 2026',now).question);
 assert.ok(parsePeriodText('2026-10-23',now).question);
 assert.ok(parseOrderRequest('como estaban los pedidos al cierre de ayer',now).question);
});
test('calendar windows, rolling time, month/year boundary and daylight saving',()=>{
 for(const [date,hours] of [['2026-03-29',23],['2026-10-25',25]]){const p=resolvePeriod({preset:'custom',from:date},Date.parse('2026-11-01'));assert.equal((Date.parse(p.end)-Date.parse(p.start))/3600000,hours);}
 assert.equal(resolvePeriod({preset:'30d'},now).from,'2026-09-23');
 assert.equal(resolvePeriod({preset:'14d'},now).from,'2026-10-09');
 assert.equal(resolvePeriod({preset:'yesterday'},Date.parse('2027-01-01T10:00Z')).from,'2026-12-31');
 assert.equal(Date.parse(resolvePeriod({preset:'48h'},now).start),now-48*3600000);
 assert.throws(()=>resolvePeriod({preset:'custom',from:'2026-02-30'},now));
});
test('multi-product and repeated lines count orders once, preserve units and identity',()=>{
 const row={market:'ES',store_id:'1',dropea_order_id:'1',created_at_utc:'2026-10-21T12:00Z',confirmed_at_utc:'2026-10-22T08:00Z',status:'SHIPPING',observed_at:new Date(now).toISOString(),source_updated_at:'2026-05-01',product_summary:{products:[{product_id:1,name:'Same',quantity:2},{product_id:1,name:'Same',quantity:3},{product_id:2,name:'Same',quantity:1}]}};
 const r=summarizeOrders([row,row],now,resolvePeriod({preset:'yesterday'},now));
 assert.equal(r.received,1);assert.equal(r.confirmed,1);assert.equal(r.confirmations,0);assert.equal(r.products.length,2);assert.equal(r.products[0].confirmed,1);assert.equal(r.products[0].units,5);
 assert.equal(summarizeOrders([row],now).confirmations,1);
});
