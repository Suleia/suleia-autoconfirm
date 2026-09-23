import {pathToFileURL} from 'node:url';
import {createAbsentNativeHttpServer} from './recipient-absent-native-http.mjs';
import {createNativeAbsentFreshReader} from './recipient-absent-native-runtime.mjs';
import {createNativeAbsentLedger} from './recipient-absent-native-gate.mjs';
import {createRecipientAbsentResolutionRuntime} from './recipient-absent-resolution-runtime.mjs';
import {loadDropeaStoreConfigs} from './integrations/dropea/store-config.mjs';
import {createDropeaPublicApiClient} from './integrations/dropea/public-api-client.mjs';

// Dedicated native authorization process. It owns no template-send API and no
// Dropea write credential. DISABLED database controls are the startup default.
export async function startNativeAbsentGate(env=process.env){
  if(!env.ABSENT_NATIVE_DATABASE_URL || !env.CHATBY_TOKEN || (env.MIGRATION_HASH_KEY || '').length<32)
    throw new Error('NATIVE_GATE_CONFIGURATION_REQUIRED');
  const stores=loadDropeaStoreConfigs(env);
  if(stores.length!==1 || stores[0].market!=='ES')throw new Error('ABSENT_SINGLE_STORE_REQUIRED');
  const {ShadowRepository}=await import('../packages/suleia-operations-mcp/src/shadow/repository.mjs');
  const {OperationsProjector}=await import('../packages/suleia-operations-mcp/src/operations/projector.mjs');
  const db=new ShadowRepository(env.ABSENT_NATIVE_DATABASE_URL);
  const runtime=createRecipientAbsentResolutionRuntime({pool:db.pool,projector:new OperationsProjector(db.pool),
    clients:stores.map(store=>({store,client:createDropeaPublicApiClient({token:store.token,market:store.market})})),
    writer:null,chatbyToken:env.CHATBY_TOKEN,privacyKey:env.MIGRATION_HASH_KEY,flags:{}});
  const server=createAbsentNativeHttpServer({token:env.ABSENT_NATIVE_GATE_TOKEN,
    readFresh:createNativeAbsentFreshReader({pool:db.pool,resolutionRuntime:runtime}),ledger:createNativeAbsentLedger(db.pool)});
  server.requestTimeout=60000;server.headersTimeout=10000;
  await new Promise(resolve=>server.listen(Number(env.PORT || 3310),'0.0.0.0',resolve));
  const stop=async()=>{await new Promise(resolve=>server.close(resolve));await db.close();};
  process.once('SIGTERM',stop);
  return {server,stop};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)
  startNativeAbsentGate().catch(()=>{console.error('NATIVE_GATE_STARTUP_BLOCKED');process.exitCode=1;});
