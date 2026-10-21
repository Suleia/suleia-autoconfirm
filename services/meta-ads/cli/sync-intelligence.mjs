import { createAdsRuntime } from '../runtime.mjs';
import { syncAds } from '../sync.mjs';
import { createRequire } from 'node:module';
const pg=createRequire(new URL('../../../packages/suleia-operations-mcp/package.json',import.meta.url))('pg');
const [since,until]=process.argv.slice(2);
if(!since||!until)throw Error('Usage: sync-intelligence.mjs YYYY-MM-DD YYYY-MM-DD');
if(!process.env.ADS_INTELLIGENCE_DATABASE_URL)throw Error('ADS_INTELLIGENCE_DATABASE_URL_REQUIRED');
const pool=new pg.Pool({connectionString:process.env.ADS_INTELLIGENCE_DATABASE_URL,max:4,application_name:'suleia-ads-sync',statement_timeout:10000});
try{
  const runtime=createAdsRuntime({pool});if(!runtime)throw Error('ADS_READ_DISABLED');
  const c=await pool.connect();let locked=false;
  try{
    locked=(await c.query("SELECT pg_try_advisory_lock(hashtextextended('ads-intelligence-sync',0)) AS locked")).rows[0].locked;
    if(!locked)throw Error('SYNC_ALREADY_RUNNING');
    console.log(JSON.stringify(await syncAds({reader:runtime.engine.reader,ledger:runtime.ledger,accountId:runtime.engine.accountId,since,until})));
  }finally{if(locked)await c.query("SELECT pg_advisory_unlock(hashtextextended('ads-intelligence-sync',0))");c.release();}
}catch{console.error('ADS_SYNC_FAILED: inspect sanitized service metrics and source health.');process.exitCode=1;}
finally{await pool.end();}
