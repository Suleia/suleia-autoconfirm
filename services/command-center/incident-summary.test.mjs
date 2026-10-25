import test from 'node:test';
import assert from 'node:assert/strict';
import {parseIncidentPeriod,readIncidentSummary,formatIncidentSummary} from './incident-summary.mjs';
const now=Date.parse('2026-10-26T00:10:00Z');
const healthy={created:4,period_pending:2,pending_now:15,unidentified:0,unchecked_stores:0,health:[{sync_completed_at:new Date(now-10000).toISOString(),pagination_complete:true,errors:0,pending_coverage:true}]};
test('Spanish daily questions, explicit periods, Madrid dates and unsupported ranges',()=>{
 for(const t of ['¿Cuántas incidencias hay en el día de hoy?','Incidencias de hoy','¿Cómo van las incidencias hoy?','Dame el número de incidencias'])assert.equal(parseIncidentPeriod(t,now).period.preset,'today');
 assert.equal(parseIncidentPeriod('Incidencias de ayer',now).period.preset,'yesterday');
 assert.equal(parseIncidentPeriod('Incidencias de los últimos 7 días',now).period.from,'2026-10-20');
 assert.ok(parseIncidentPeriod('Incidencias de la semana pasada',now).question);
 assert.ok(parseIncidentPeriod('Resuelve las incidencias hoy',now).question);
 assert.equal(parseIncidentPeriod('Cuántos pedidos hay hoy',now),null);
 assert.equal(parseIncidentPeriod('Consulta incidencias',now),null);
});
test('read uses creation dates, observation clock and discloses historical coverage',async()=>{
 let query;const pool={query:async q=>{query=q;return {rows:[structuredClone(healthy)]};}};
 const s=await readIncidentSummary(pool,{preset:'today'},now);assert.equal(query.values[0],'2026-10-25T23:00:00.000Z');assert.equal(s.created,4);assert.equal(s.pendingNow,15);assert.equal(s.fresh,true);assert.equal(s.historicalCoverage,'UNVERIFIED');
 const t=formatIncidentSummary(s);assert.match(t,/registradas: 4/);assert.match(t,/De ellas, pendientes ahora: 2/);assert.match(t,/todos los días: 15/);assert.match(t,/no acredita todas/);assert.doesNotMatch(t,/resueltas hoy/i);
});
test('incomplete sync, missing identities, failure and unknown clocks never become fresh zeros',async()=>{
 for(const mutate of [r=>r.health=[],r=>r.unidentified=1,r=>r.unchecked_stores=1,r=>r.health[0].pagination_complete=false,r=>r.health[0].errors=1,r=>r.health[0].pending_coverage=false,r=>r.health[0].sync_completed_at='2026-10-25T00:00:00Z',r=>r.health[0].sync_completed_at='invalid']){
  const row=structuredClone(healthy);mutate(row);assert.equal((await readIncidentSummary({query:async()=>({rows:[row]})},{preset:'today'},now)).fresh,false);
 }
 const s=await readIncidentSummary({query:async()=>{throw Error('private token');}},{preset:'today'},now);assert.equal(s.created,null);assert.match(formatIncidentSummary(s),/N\/D/);assert.doesNotMatch(formatIncidentSummary(s),/private token/);
});

test('real PostgreSQL: unique issue scope, creation cohort, midnight/DST and read-only transaction',{skip:!process.env.INCIDENT_TEST_DATABASE_URL},async()=>{
 const {createRequire}=await import('node:module');const pg=createRequire(new URL('../../packages/suleia-operations-mcp/package.json',import.meta.url))('pg');const c=new pg.Client({connectionString:process.env.INCIDENT_TEST_DATABASE_URL});await c.connect();
 try{
  await c.query(`CREATE SCHEMA read_models;
   CREATE TABLE read_models.operations_incident_records(canonical_issue_id text primary key,market text,store_id text,dropea_issue_id text,created_at timestamptz,updated_at timestamptz,observed_at timestamptz,status text,is_active boolean);
   CREATE TABLE read_models.integration_dropea_sync_checkpoints(market text,store_id text,resource_type text,phase text,sync_completed_at timestamptz,pagination_complete boolean,errors integer,records_read integer);
   INSERT INTO read_models.operations_incident_records VALUES
   ('a','ES','1','1','2026-10-25T23:00Z','2026-10-26T00:00Z','2026-10-26T00:09Z','PENDING',true),
   ('duplicate','ES','1','1','2026-10-25T23:00Z','2026-10-25T23:00Z','2026-10-25T23:00Z','PENDING',true),
   ('b','ES','1','2','2026-10-25T22:59:59Z','2026-10-26T00:00Z','2026-10-26T00:09Z','PENDING',true),
   ('c','ES','1','3','2026-10-25T23:01Z','2026-10-26T00:00Z','2026-10-26T00:09Z','RESOLVED',false),
   ('d','PT','2','1','2026-10-25T23:02Z','2026-10-26T00:00Z','2026-10-26T00:09Z','PENDING',true),
   ('e','ES','1','4','2026-10-25T21:00Z','2026-10-26T00:00Z','2026-10-26T00:09Z','PENDING',false);
   INSERT INTO read_models.integration_dropea_sync_checkpoints VALUES('ES','1','issues','INCREMENTAL','2026-10-26T00:09Z',true,0,2),('PT','2','issues','INCREMENTAL','2026-10-26T00:09Z',true,0,1);`);
  await c.query('BEGIN READ ONLY');const s=await readIncidentSummary(c,{preset:'today'},now);assert.deepEqual([s.created,s.periodPending,s.pendingNow],[3,2,3]);assert.equal(s.fresh,true);
  const yesterday=await readIncidentSummary(c,{preset:'yesterday'},now);assert.equal(yesterday.created,2);assert.equal(Date.parse(yesterday.period.end)-Date.parse(yesterday.period.start),25*3600000);assert.equal(yesterday.pendingNow,3);await c.query('ROLLBACK');
 }finally{await c.end();}
});


