import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {OperationsRepository} from '../../../packages/suleia-operations-mcp/src/operations/repository.mjs';
test('V10 cohort SQL uses Madrid/DST, maturity, canonical duplicate/test exclusions and aggregate-only output',{skip:process.env.ADS_TEST_ISOLATED!=='true'},async()=>{
 const pg=createRequire('/app/packages/suleia-operations-mcp/package.json')('pg');
 const pool=new pg.Pool({host:'/var/run/postgresql',database:'growth_goals_test',user:'postgres'});
 try{
  assert.equal((await pool.query('select current_database() name')).rows[0].name,'growth_goals_test');
  await pool.query(`create schema read_models;create table read_models.operations_finance_order_inputs(store_id text,created_at_utc timestamptz,confirmed_at_utc timestamptz,updated_at timestamptz,test_order boolean,duplicate_status text)`);
  const insert=async(created,confirmed=null,duplicate='NOT_ASSESSED',test=false,store='16088')=>pool.query('insert into read_models.operations_finance_order_inputs values($1,$2,$3,$4,$5,$6)',[store,created,confirmed,'2026-10-25T12:00:00Z',test,duplicate]);
  await insert('2026-10-17T21:59:59Z','2026-10-20T10:00:00Z'); // Mature:17Oct23:59 Madrid.
  await insert('2026-10-17T22:00:00Z','2026-10-20T10:00:00Z'); //18Oct:too recent.
  await insert('2026-10-10T10:00:00Z','2026-10-25T01:30:00Z'); // Older cohort confirmed today.
  await insert('2026-10-10T10:00:00Z',null,'DUPLICATE_ACTIVE_ORDER');
  await insert('2026-10-10T10:00:00Z',null,'UNIQUE',true);
  await insert('2026-10-10T10:00:00Z',null,'UNIQUE',false,'other-store');
  await insert('2026-10-25T00:30:00Z','2026-10-25T01:30:00Z'); // Both repetitions of local02:30.
  await insert('2026-10-25T01:30:00Z',null);
  await insert('2026-10-24T21:59:59Z','2026-10-25T02:30:00Z'); // Yesterday Madrid.
  await insert('2026-10-25T15:00:00Z','2026-10-25T16:00:00Z'); // Future input must not inflate today.
  const r=await new OperationsRepository('unused',{pool}).adsGrowthGoals(new Date('2026-10-25T12:00:00Z'));
  assert.equal(r.matureRange.until,'2026-10-17');assert.equal(r.matureDays.reduce((n,d)=>n+d.orders,0),2);
  assert.equal(r.matureDays.reduce((n,d)=>n+d.confirmed,0),2);assert.equal(r.today.day,'2026-10-25');assert.equal(r.today.orders,2);
  assert.equal(r.today.confirmedFromTodayCohort,1);assert.equal(r.today.confirmationEventsToday,3);
  assert.equal(r.duplicateAssessment,'NOT_ASSESSED');assert.equal(r.externalWrites,0);
  assert.doesNotMatch(JSON.stringify(r),/phone|email|street|customer_name|canonical_order_id/);
 }finally{await pool.end();}
});
