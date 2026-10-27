import test from 'node:test';import assert from 'node:assert/strict';
import {OperationsProjector} from '../../../packages/suleia-operations-mcp/src/operations/projector.mjs';
test('PostgreSQL resolver keeps the existing owner and rejects the colliding new identity',{skip:!process.env.IDENTITY_TEST_DATABASE_URL},async()=>{
 const {createRequire}=await import('node:module');const pg=createRequire(new URL('../../../packages/suleia-operations-mcp/package.json',import.meta.url))('pg');const pool=new pg.Pool({connectionString:process.env.IDENTITY_TEST_DATABASE_URL});
 try{
  await pool.query(`CREATE SCHEMA integration;CREATE SCHEMA read_models;
   CREATE TABLE integration.dropea_orders(canonical_order_id text UNIQUE,market text,store_id text,dropea_order_id text);
   CREATE TABLE read_models.operations_order_records(canonical_order_id text,market text,store_id text,dropea_order_id text,external_order_id_hash text,updated_at timestamptz);
   INSERT INTO integration.dropea_orders VALUES('canonical','ES','17','41');
   INSERT INTO read_models.operations_order_records VALUES('canonical','ES','17','41','same',now());`);
  const p=new OperationsProjector(pool),order={market:'ES',store_id:'17',dropea_order_id:'42',external_order_id_hash:'same'};
  assert.equal((await p.resolveCanonicalOrder(order)).status,'CONFLICT');
  assert.deepEqual(await p.resolveCanonicalOrder({...order,dropea_order_id:'41'}),{status:'FOUND',canonical_order_id:'canonical'});
  assert.equal((await pool.query('SELECT count(*) FROM integration.dropea_orders')).rows[0].count,'1');
 }finally{await pool.end();}
});
test('external reference cannot reuse a canonical identity already bound to another provider order',async()=>{
 let owner={owner_market:'ES',owner_store_id:'17',owner_dropea_order_id:'41',canonical_order_id:'existing'};
 const p=new OperationsProjector({query:async q=>{assert.match(q,/LEFT JOIN integration.dropea_orders/);assert.doesNotMatch(q,/INSERT|UPDATE|DELETE/);return {rows:[owner]};}});
 const order={market:'ES',store_id:'17',dropea_order_id:'42',external_order_id_hash:'same-reference'};
 assert.equal((await p.resolveCanonicalOrder(order)).status,'CONFLICT');
 assert.equal((await p.resolveCanonicalOrder({...order,dropea_order_id:'41'})).status,'FOUND');
 assert.equal((await p.resolveCanonicalOrder({...order,dropea_order_id:'41',market:'PT'})).status,'CONFLICT');
 owner={canonical_order_id:'legacy-unbound'};assert.equal((await p.resolveCanonicalOrder(order)).status,'FOUND');
});

