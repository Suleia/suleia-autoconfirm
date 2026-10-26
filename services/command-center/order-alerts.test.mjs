import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {createRequire} from 'node:module';import {OrderAlerts,orderAlertIntent,orderAlertText} from './order-alerts.mjs';
test('explicit per-user notification settings and safe compact order fields',()=>{
 assert.equal(orderAlertIntent('Activa las alertas de pedidos'),'enable');assert.equal(orderAlertIntent('Desactiva las alertas de pedidos'),'disable');assert.equal(orderAlertIntent('Estado de alertas de pedidos'),'settings');assert.equal(orderAlertIntent('Cuántos pedidos hay hoy'),null);
 const t=orderAlertText({dropea_order_id:'123',market:'ES',product_display_names:['<b>Test</b>'],total_amount:'49.9',currency:'EUR',created_at_utc:'2026-10-26T10:00Z',phone:'PRIVATE',address:'PRIVATE'});assert.match(t,/&lt;b&gt;/);assert.doesNotMatch(t,/PRIVATE/);assert.match(t,/49,90/);
});
test('PostgreSQL durable subscriptions, claim races, late arrivals, retries and uncertain results',{skip:!process.env.ORDER_ALERT_TEST_DATABASE_URL},async()=>{
 const pg=createRequire(new URL('../../packages/suleia-operations-mcp/package.json',import.meta.url))('pg');const admin=new pg.Client({connectionString:process.env.ORDER_ALERT_TEST_DATABASE_URL});await admin.connect();let readPool,writePool;
 try{
  await admin.query(`CREATE SCHEMA economics;CREATE SCHEMA read_models;CREATE ROLE suleia_ads_executor LOGIN;CREATE ROLE suleia_operations_readonly LOGIN;CREATE ROLE suleia_backup;GRANT USAGE ON SCHEMA economics TO suleia_ads_executor,suleia_operations_readonly,suleia_backup;GRANT USAGE ON SCHEMA read_models TO suleia_operations_readonly;
   CREATE TABLE read_models.integration_dropea_orders(market text,store_id text,dropea_order_id text,source_system text,created_at_utc timestamptz,first_seen_at timestamptz,product_display_names jsonb,total_amount numeric,currency text,PRIMARY KEY(market,store_id,dropea_order_id));GRANT SELECT ON read_models.integration_dropea_orders TO suleia_operations_readonly;ALTER ROLE suleia_operations_readonly SET default_transaction_read_only=on;`);
  await admin.query(fs.readFileSync(new URL('../../migrations/062_telegram_order_alerts.sql',import.meta.url),'utf8'));
  const url=role=>{const u=new URL(process.env.ORDER_ALERT_TEST_DATABASE_URL);u.username=role;return u.toString();};readPool=new pg.Pool({connectionString:url('suleia_operations_readonly')});writePool=new pg.Pool({connectionString:url('suleia_ads_executor')});let now=Date.parse('2026-10-26T10:00Z');const service=new OrderAlerts({readPool,writePool,now:()=>now});
  assert.equal((await service.command('1',{operation:'due'})).state,'DISABLED');
  await service.command('1',{operation:'enable'});const started=(await service.settings('1')).enabled_at;
  await admin.query(`INSERT INTO read_models.integration_dropea_orders VALUES('ES','shop','old','DROPEA_PUBLIC_API_V2','2026-10-26T09:59Z','2026-10-26T10:02Z','["Test"]',10,'EUR'),('ES','shop','new','DROPEA_PUBLIC_API_V2','2026-10-26T10:01Z','2026-10-26T10:02Z','["Test"]',10,'EUR')`);
  assert.equal((await service.command('1',{operation:'due'})).state,'IDLE');now+=180000;
  await service.command('1',{operation:'enable'});assert.equal(+(await service.settings('1')).enabled_at,+started);
  const race=await Promise.all([service.command('1',{operation:'due'}),service.command('1',{operation:'due'})]);assert.equal(race.filter(x=>x.state==='SEND').length,1);const sent=race.find(x=>x.state==='SEND');
  await assert.rejects(service.command('2',{operation:'finish',...sent,state:'SENT',messageId:5}),/QUERY_INVALID/);
  await service.command('1',{operation:'finish',...sent,state:'SENT',messageId:5});assert.equal((await service.command('1',{operation:'due'})).state,'IDLE');
  // Late insertion behind an earlier observation is still found: no lossy cursor.
  await admin.query(`INSERT INTO read_models.integration_dropea_orders VALUES('PT','shop2','new','DROPEA_PUBLIC_API_V2','2026-10-26T10:00:30Z','2026-10-26T10:01Z','["Other"]',20,'EUR')`);
  const late=await service.command('1',{operation:'due'});assert.equal(late.state,'SEND');assert.notEqual(late.id,sent.id);await service.command('1',{operation:'finish',...late,state:'RETRY',retrySeconds:10});assert.equal((await service.command('1',{operation:'due'})).state,'IDLE');now+=11000;
  const retry=await service.command('1',{operation:'due'});assert.equal(retry.id,late.id);assert.notEqual(retry.claim,late.claim);await assert.rejects(service.command('1',{operation:'finish',...late,state:'SENT',messageId:6}),/QUERY_INVALID/);await service.command('1',{operation:'finish',...retry,state:'UNKNOWN'});
  now+=300000;assert.equal((await service.command('1',{operation:'due'})).state,'IDLE');assert.equal((await service.settings('1')).needs_review,1);
  await service.command('1',{operation:'disable'});assert.equal((await service.command('1',{operation:'due'})).state,'DISABLED');await service.command('1',{operation:'enable'});assert.ok(+(await service.settings('1')).enabled_at>+started);assert.equal((await service.command('1',{operation:'due'})).state,'IDLE');
  await assert.rejects(readPool.query("DELETE FROM read_models.integration_dropea_orders"));
 }finally{await readPool?.end();await writePool?.end();await admin.end();}
});
