// Dedicated process; never embedded in the read-only worker or confirmation lane.
import {pathToFileURL} from 'node:url';
import {absentLiveFlags} from '../packages/platform-core/src/incident/absent-live-gates.mjs';
import {loadDropeaStoreConfigs} from './integrations/dropea/store-config.mjs';
import {createDropeaPublicApiClient} from './integrations/dropea/public-api-client.mjs';
import {createDropeaAbsentSolutionWriter} from './integrations/dropea/absent-solution.mjs';
import {createRecipientAbsentResolutionRuntime} from './recipient-absent-resolution-runtime.mjs';
import {createAbsentEvidenceProjector} from './recipient-absent-projector.mjs';

export async function startRecipientAbsentResolutionWorker(env=process.env){
  const flags=absentLiveFlags(env);
  if(!flags.AUSENTE_AUTOMATION_LIVE || !flags.AUSENTE_LOGISTICS_WRITES_ENABLED)throw new Error('ABSENT_RESOLUTION_LIVE_DISABLED');
  if(!env.AUSENTE_DROPEA_WRITE_TOKEN)throw new Error('WRITE_PERMISSION_NOT_AVAILABLE');
  if(!env.ABSENT_RESOLUTION_DATABASE_URL || !env.CHATBY_TOKEN || (env.MIGRATION_HASH_KEY || '').length<32)throw new Error('ABSENT_RUNTIME_CONFIGURATION_MISSING');
  const stores=loadDropeaStoreConfigs(env);
  if(stores.length!==1 || stores[0].market!=='ES')throw new Error('ABSENT_SINGLE_STORE_REQUIRED');
  const writer=createDropeaAbsentSolutionWriter({token:env.AUSENTE_DROPEA_WRITE_TOKEN,market:'ES'});
  const {ShadowRepository}=await import('../packages/suleia-operations-mcp/src/shadow/repository.mjs');
  const db=new ShadowRepository(env.ABSENT_RESOLUTION_DATABASE_URL);
  const runtime=createRecipientAbsentResolutionRuntime({pool:db.pool,projector:createAbsentEvidenceProjector(),
    clients:stores.map(store=>({store,client:createDropeaPublicApiClient({token:store.token,market:store.market})})),
    writer,chatbyToken:env.CHATBY_TOKEN,privacyKey:env.MIGRATION_HASH_KEY,flags});
  let running=false;
  const run=async()=>{if(running)return;running=true;try{console.log(JSON.stringify({event:'absent_resolution_cycle',at:new Date().toISOString(),...await runtime.run()}));}
    catch {console.error(JSON.stringify({event:'absent_resolution_cycle_failed',reason:'REVIEW_REQUIRED'}));}finally{running=false;}};
  await run();const timer=setInterval(run,120000);
  process.once('SIGTERM',()=>{clearInterval(timer);db.close();});
  return {stop:async()=>{clearInterval(timer);await db.close();}};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)startRecipientAbsentResolutionWorker().catch(()=>{console.error('ABSENT_RESOLUTION_STARTUP_BLOCKED');process.exitCode=1;});
