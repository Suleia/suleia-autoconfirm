import test from 'node:test';
import assert from 'node:assert/strict';
import {readStoredReport} from './stored-report.mjs';
import {createReportCache} from './report-cache.mjs';
import {verifiedSubtotal} from './report.mjs';
import {analyzeReview} from './review/analyze.mjs';
import {growthFixtureDataset,GROWTH_FIXTURE_NOW} from './review/growth-fixtures.mjs';
import {CONTRACT} from './metrics.mjs';
import {createRequire} from 'node:module';
import {AdsLedger} from './ledger.mjs';
const range={since:'2026-10-17',until:'2026-10-23',partial:false};
const facts=()=>{const d=growthFixtureDataset(range);return [...d.current.campaign,...d.prior.campaign,...d.daily.campaign].map(f=>({...f,accountId:'999'}));};
test('restart reads exact account, range, level and contract; stored evidence cannot revalidate budget or delivery',async()=>{
 let sql,args;const r=await readStoredReport({accountId:'act_999',query:{...range,level:'campaign'},now:GROWTH_FIXTURE_NOW,pool:{query:async(s,a)=>{sql=s;args=a;return {rows:facts().map(body=>({body}))};}}});
 assert.match(sql,/SELECT body/);assert.doesNotMatch(sql,/INSERT|UPDATE|DELETE/);assert.deepEqual(args,['999',CONTRACT,['campaign'],range.since,range.until,'2026-10-10','2026-10-16']);
 const view=analyzeReview({dataset:r.dataset,query:{level:'campaign'},now:GROWTH_FIXTURE_NOW});assert.equal(view.freshness,'STALE');assert.equal(view.totals.dailyBudgetCents,null);assert.equal(view.rows[0].delivery,'UNKNOWN');assert.equal(view.recommendations.length,0);assert.equal(view.rows[0].spend,196);
});
test('persisted incompatible identity, contract, timestamps or excessive rows cannot be shown',async()=>{
 for(const patch of[{accountId:'other'},{contract:'wrong'},{entityId:'bad'},{observedAt:'invalid'}]){const rows=facts();Object.assign(rows[0],patch);assert.equal(await readStoredReport({accountId:'999',query:{...range,level:'campaign'},pool:{query:async()=>({rows:rows.map(body=>({body}))})}}),null);}
});
test('restored cut appears while ONE cold refresh is pending; refresh success replaces evidence without changing old timestamps',async()=>{
 let resolve,reads=0;const at=Date.now(),old=at-300000,stored={observedAt:new Date(old).toISOString(),dataset:{current:{campaign:[]},prior:{campaign:[]},daily:{campaign:[]}}};
 const cache=createReportCache({restore:async()=>stored,read:()=>{reads++;return new Promise(r=>resolve=r);},waitMs:1});
 const a=await cache.snapshot('exact',{},31),b=await cache.snapshot('exact',{},31);assert.equal(a.readFailed,true);assert.equal(b.observedAt,stored.observedAt);assert.equal(reads,1);assert.equal(a.diagnostic.state,'PREPARING');
 resolve({...stored,observedAt:new Date(at).toISOString()});await new Promise(r=>setImmediate(r));const c=await cache.snapshot('exact',{},31);assert.equal(c.readFailed,false);assert.equal(stored.observedAt,new Date(old).toISOString());
});
test('verified subtotal uses common population and weighted ratios, never mixed aliases or fabricated missing zeroes',()=>{
 const data=facts().slice(0,5);data[1].purchases=null;const s=verifiedSubtotal(data);assert.equal(s.state,'PARTIAL');assert.equal(s.included,4);assert.ok(!s.entityIds.includes(data[1].entityId));assert.equal(s.metrics.roas,s.metrics.purchaseValue/s.metrics.spend);assert.equal(data[1].purchases,null);
 data[2].roasStatus='AMBIGUOUS';assert.equal(verifiedSubtotal(data).included,3);data[2].roasStatus='VALID';data[2].purchaseType='other';assert.equal(verifiedSubtotal(data).metrics,null);
});
test('stored evidence executes against isolated PostgreSQL with read-only sessions and exact scope',{skip:process.env.ADS_TEST_ISOLATED!=='true'},async()=>{
 const {Pool}=createRequire('/app/packages/suleia-operations-mcp/package.json')('pg'),pool=new Pool({host:'/var/run/postgresql',database:'stored_reports_test',user:'postgres',max:1});
 try{
  assert.equal((await pool.query('select current_database() name')).rows[0].name,'stored_reports_test');
  await pool.query(`CREATE SCHEMA economics;CREATE TABLE economics.ads_insights(account_id text,level text,entity_id text,since date,until date,contract text,body jsonb,source_observed_at timestamptz,ingested_at timestamptz,PRIMARY KEY(account_id,level,entity_id,since,until,contract))`);
  await new AdsLedger(pool).persistFacts(facts());await pool.query('SET default_transaction_read_only=on');
  const r=await readStoredReport({pool,accountId:'999',query:{...range,level:'campaign'},now:GROWTH_FIXTURE_NOW});assert.equal(r.dataset.current.campaign.length,5);assert.equal(r.dataset.daily.campaign.length,35);assert.equal(r.dataset.prior.campaign.length,5);assert.equal(r.readFailed,true);
  assert.equal(await readStoredReport({pool,accountId:'888',query:{...range,level:'campaign'}}),null);
  assert.equal(await readStoredReport({pool,accountId:'999',query:{...range,level:'ad'}}),null);
  assert.equal((await pool.query('SHOW default_transaction_read_only')).rows[0].default_transaction_read_only,'on');
 }finally{await pool.end();}
});
