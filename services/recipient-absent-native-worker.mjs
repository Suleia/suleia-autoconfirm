import {pathToFileURL} from 'node:url';
import {createAbsentNativeHttpServer} from './recipient-absent-native-http.mjs';
import {createNativeAbsentFreshReader} from './recipient-absent-native-runtime.mjs';
import {createNativeAbsentLedger,nativeAbsentControlReady} from './recipient-absent-native-gate.mjs';
import {createNativeAbsentObserver} from './recipient-absent-native-observer.mjs';
import {createRecipientAbsentResolutionRuntime} from './recipient-absent-resolution-runtime.mjs';
import {loadDropeaStoreConfigs} from './integrations/dropea/store-config.mjs';
import {createDropeaPublicApiClient} from './integrations/dropea/public-api-client.mjs';
import {createAbsentEvidenceProjector} from './recipient-absent-projector.mjs';
import {createAbsentObserverHealth,readAbsentControllerHealth} from './recipient-absent-health.mjs';
import {createAbsentTemplateDelivery} from './recipient-absent-template-delivery.mjs';

// Dedicated notification owner; native and API transport share one durable
// claim gate. It still has no Dropea write credential or logistics authority.
export async function startNativeAbsentGate(env=process.env){
  if(!env.ABSENT_NATIVE_DATABASE_URL || !env.CHATBY_TOKEN || (env.MIGRATION_HASH_KEY || '').length<32)
    throw new Error('NATIVE_GATE_CONFIGURATION_REQUIRED');
  const stores=loadDropeaStoreConfigs(env);
  if(stores.length!==1 || stores[0].market!=='ES')throw new Error('ABSENT_SINGLE_STORE_REQUIRED');
  const {ShadowRepository}=await import('../packages/suleia-operations-mcp/src/shadow/repository.mjs');
  const db=new ShadowRepository(env.ABSENT_NATIVE_DATABASE_URL);
  // Fresh reads return ephemeral evidence through onAbsentConversation. The
  // dedicated role must not mutate shared ingestion or other workflow tables.
  const projector=createAbsentEvidenceProjector();
  const observerHealth=createAbsentObserverHealth();
  const runtime=createRecipientAbsentResolutionRuntime({pool:db.pool,projector,
    clients:stores.map(store=>({store,client:createDropeaPublicApiClient({token:store.token,market:store.market})})),
    writer:null,chatbyToken:env.CHATBY_TOKEN,privacyKey:env.MIGRATION_HASH_KEY,flags:{}});
  const server=createAbsentNativeHttpServer({token:env.ABSENT_NATIVE_GATE_TOKEN,
    health:async()=>readAbsentControllerHealth(db.pool,observerHealth),
    enabled:async()=>nativeAbsentControlReady((await db.pool.query("SELECT * FROM operations.recipient_absent_native_control WHERE workflow='RECIPIENT_ABSENT'")).rows[0]),
    audit:event=>console.log(JSON.stringify({...event,at:new Date().toISOString()})),
    readFresh:createNativeAbsentFreshReader({pool:db.pool,resolutionRuntime:runtime}),ledger:createNativeAbsentLedger(db.pool)});
  server.requestTimeout=60000;server.headersTimeout=10000;
  await new Promise(resolve=>server.listen(Number(env.PORT || 3310),'0.0.0.0',resolve));
  const observer=createNativeAbsentObserver({pool:db.pool,token:env.CHATBY_TOKEN});
  const delivery=createAbsentTemplateDelivery({pool:db.pool,readFresh:runtime.readFresh,
    ledger:createNativeAbsentLedger(db.pool),token:env.CHATBY_TOKEN});
  let cycling=false;
  const observe=async()=>{if(cycling)return;cycling=true;observerHealth.start();try{
    observerHealth.finish(await observer.run());
    try{const result=await delivery.run();console.log(JSON.stringify({event:'absent_template_delivery',...result,at:new Date().toISOString()}));}
    catch(error){console.log(JSON.stringify({event:'absent_template_delivery',status:'READ_OR_CONTRACT_BLOCKED',
      reason:/^[A-Z_]+$/.test(error.message)?error.message:'PROVIDER_READ_FAILED',at:new Date().toISOString()}));}
  }catch{observerHealth.fail();}finally{cycling=false;}};
  const timer=setInterval(observe,120000);await observe();
  const stop=async()=>{clearInterval(timer);await new Promise(resolve=>server.close(resolve));await db.close();};
  process.once('SIGTERM',stop);
  return {server,stop};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)
  startNativeAbsentGate().catch(()=>{console.error('NATIVE_GATE_STARTUP_BLOCKED');process.exitCode=1;});
