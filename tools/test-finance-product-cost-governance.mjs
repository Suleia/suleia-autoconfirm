import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
if(process.env.FINANCE_COGS_TEST_ISOLATED!=='true')throw Error('ISOLATED_DATABASE_REQUIRED');
const {Client}=createRequire(new URL('../packages/suleia-operations-mcp/package.json',import.meta.url))('pg');
const client=new Client({host:'/var/run/postgresql',user:'postgres',database:'finance_cogs_test'});await client.connect();
const root=new URL('../',import.meta.url),up=await fs.readFile(new URL('migrations/060_finance_product_cost_governance.sql',root),'utf8'),down=await fs.readFile(new URL('migrations/rollback/060_finance_product_cost_governance.down.sql',root),'utf8');
const base=await fs.readFile(new URL('migrations/024_financial_control.sql',root),'utf8');
let checks=0;const check=(actual,expected)=>{assert.deepEqual(actual,expected);checks++;};
try{
 await client.query(`CREATE SCHEMA economics; CREATE SCHEMA integration; CREATE SCHEMA read_models;
 CREATE ROLE suleia_operations_readonly; CREATE ROLE suleia_backup; CREATE ROLE suleia_mcp_readonly;
 GRANT USAGE ON SCHEMA economics,read_models TO suleia_operations_readonly;
 CREATE TABLE integration.dropea_store_config(store_id text,enabled boolean);INSERT INTO integration.dropea_store_config VALUES('16088',true);
 CREATE TABLE read_models.operations_finance_order_inputs(store_id text,dropea_order_id text,created_at_utc timestamptz,updated_at timestamptz,
 confirmed_at_utc timestamptz,delivered_at_utc timestamptz,returned_at_utc timestamptz,lifecycle_status text,status text,product_summary jsonb,order_costs jsonb);
 INSERT INTO read_models.operations_finance_order_inputs VALUES
 ('16088','fixture-1','2026-10-19T10:33:27.481Z',now(),now(),now(),null,'DELIVERED','FINISH','{"products":[{"product_id":33560,"variant_id":33788,"quantity":2,"wholesale_price":0,"name":"Fixture"}]}','{"product_price":0}'),
 ('16088','fixture-2','2026-10-20T12:00:00Z',now(),now(),now(),null,'DELIVERED','FINISH','{"products":[{"product_id":33560,"variant_id":33788,"quantity":2,"wholesale_price":0,"name":"Fixture"}]}','{"product_price":0}');`);
 await client.query(base.slice(base.indexOf('CREATE TABLE IF NOT EXISTS economics.finance_cost_rates'),base.indexOf('CREATE INDEX IF NOT EXISTS finance_cost_rates_lookup_idx')));
 await client.query('GRANT SELECT ON economics.finance_cost_rates TO suleia_operations_readonly');
 await client.query(up);
 const tariff=(await client.query("SELECT amount::text,effective_from::text,source FROM economics.finance_cost_rates WHERE product_id='33560'")).rows;
 check(tariff,[{amount:'0.8700',effective_from:'2026-10-19',source:'OWNER_VERIFIED_PRODUCT_COST'}]);
 check((await client.query('SELECT count(*)::int AS n FROM read_models.finance_product_cogs_missing')).rows[0].n,0);
 await client.query(up);check((await client.query('SELECT count(*)::int AS n FROM economics.finance_product_cost_audit')).rows[0].n,1);
 await client.query(`INSERT INTO read_models.operations_finance_order_inputs VALUES
 ('16088','fixture-3','2026-10-24T11:00:00Z',now(),now(),now(),null,'DELIVERED','FINISH','{"products":[{"product_id":888,"variant_id":999,"quantity":2,"wholesale_price":0,"name":"New fixture"}]}','{"product_price":0}'),
 ('16088','fixture-4','2026-10-24T11:00:00Z',now(),now(),now(),null,'DELIVERED','FINISH','{"products":[{"product_id":444,"variant_id":555,"quantity":1,"wholesale_price":0}]}','{"product_price":2}');`);
 const finding=(await client.query('SELECT code,units::int,orders,delivered_units::int FROM read_models.finance_product_cogs_missing')).rows;
 check(finding,[{code:'PRODUCT_COGS_MISSING',units:2,orders:1,delivered_units:2}]);
 check((await client.query("SELECT has_table_privilege('suleia_operations_readonly','economics.finance_cost_rates','INSERT') AS allowed")).rows[0].allowed,false);
 check((await client.query("SELECT has_function_privilege('suleia_mcp_readonly','economics.save_product_cogs_rate(uuid,text,text,text,numeric,date,date,text,timestamptz)','EXECUTE') AS allowed")).rows[0].allowed,false);
 await client.query('SET ROLE suleia_operations_readonly');
 const saved=(await client.query("SELECT economics.save_product_cogs_rate(null,'16088','888','999',1.23,'2026-10-24',null,'fixture-principal-hash',null) AS row")).rows[0].row;
 check(saved.amount,1.23);check((await client.query('SELECT count(*)::int AS n FROM read_models.finance_product_cogs_missing')).rows[0].n,0);
 await assert.rejects(client.query("INSERT INTO economics.finance_cost_rates(store_id,cost_type,amount,effective_from) VALUES('16088','COD',1,'2026-10-24')"),e=>e.code==='42501');checks++;
 await assert.rejects(client.query("SELECT economics.save_product_cogs_rate($1,'16088','888','999',1.50,'2026-10-24',null,'fixture-principal-hash','2026-01-01')",[saved.rate_id]),/CHANGED/);checks++;
 await assert.rejects(client.query("SELECT economics.save_product_cogs_rate(null,'16088','888','999',1.50,'2026-10-25',null,'fixture-principal-hash',null)"),/OVERLAP/);checks++;
 await assert.rejects(client.query("SELECT economics.save_product_cogs_rate(null,'OTHER','888','999',1.50,'2026-10-24',null,'fixture-principal-hash',null)"),/INVALID/);checks++;
 const updated=(await client.query("SELECT economics.save_product_cogs_rate($1,'16088','888','999',1.50,'2026-10-24',null,'fixture-principal-hash',$2) AS row",[saved.rate_id,saved.version])).rows[0].row;
 check(updated.amount,1.50);await client.query('RESET ROLE');
 await client.query(down);check((await client.query("SELECT count(*)::int AS n FROM economics.finance_cost_rates WHERE product_id='33560'")).rows[0].n,0);
 check((await client.query("SELECT amount::text FROM economics.finance_cost_rates WHERE product_id='888'")).rows[0].amount,'1.5000');
 await client.query(up);await client.query(down);check((await client.query("SELECT count(*)::int AS n FROM economics.finance_cost_rates WHERE product_id='33560'")).rows[0].n,0);
 console.log(JSON.stringify({isolatedDatabase:true,checks,failed:0,governanceAndRollbackVerified:true,externalActions:0}));
}finally{await client.end();}
