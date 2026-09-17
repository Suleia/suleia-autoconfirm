import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createPlatformKnowledge} from '../src/platform/catalog.mjs';
test('assigned absence policy metadata comes from real registry and missing access is not persisted',async()=>{
 const policy={policy_id:'safe-registry-id',policy_name:'RECIPIENT_ABSENT_POLICY_V1',policy_version:'RECIPIENT_ABSENT_POLICY_V1',policy_snapshot_hash:'safe-hash',status:'SHADOW'};
 const make=repository=>createPlatformKnowledge({repository,config:{environment:'test',runtimeInventoryPath:'/nonexistent/safe-runtime.json'}});
 const verified=await make({getAssignedShadowPolicies:async()=>[policy]}).getOverview({section:'POLICIES'});
 assert.equal(verified.recipient_absent_registry_status,'PERSISTED_SHADOW');assert.equal(verified.policies.at(-1).policy_id,policy.policy_id);assert.equal(verified.policies.at(-1).execution_available,false);
 const unknown=await make({getAssignedShadowPolicies:async()=>{throw new Error('no access');}}).getOverview({section:'POLICIES'});assert.equal(unknown.recipient_absent_registry_status,'NOT_VERIFIABLE');
});
test('runtime catalogue cannot invent a container commit from checkout or an actual deploy time from a poll',async()=>{
 const platform=createPlatformKnowledge({repository:{},config:{environment:'test',runtimeInventoryPath:'/nonexistent/safe-runtime.json'}});
 const inventory=await platform.getRuntimeInventory({service:'timer-engine'});
 assert.equal(inventory.items[0].commit,null);assert.equal(inventory.items[0].container_commit,null);assert.equal(inventory.items[0].last_deploy,null);assert.equal(inventory.items[0].functional_health_is_current,false);
});
test('functional health expires at read time even when the inventory recorded a fresh successful observation',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'absent-health-'));
 const file=path.join(dir,'runtime.json');
 try{
  const platform=createPlatformKnowledge({repository:{},config:{environment:'test',runtimeInventoryPath:file}});
  for(const age of [1_000,301_000,-60_000]){
   const at=new Date(Date.now()-age).toISOString();
   await fs.writeFile(file,JSON.stringify({generated_at:at,containers:[{service:'ingestion-worker',health:'HEALTHY',functional_health_is_current:true,functional_health:{checked_at:at,health_status:'HEALTHY',reason:'Previous observation'}}]}));
   const item=(await platform.getRuntimeInventory({service:'ingestion-worker'})).items[0];
   assert.equal(item.functional_health_is_current,age===1_000);
   assert.equal(item.health,age===1_000?'HEALTHY':'UNKNOWN');
   assert.equal(item.health_checked_at,at);
  }
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
