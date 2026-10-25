import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {flags} from './policy.mjs';
import {RecoveryStore} from './store.mjs';
import {AddressRecoveryAgent} from './engine.mjs';
import {persistedLegacyFailures} from './intake.mjs';

async function jsonLines(file){
  const stat=await fs.stat(file);
  if(stat.size>16*1024*1024)throw Error('RECOVERY_AUDIT_ROTATION_REQUIRED');
  const text=await fs.readFile(file,'utf8');
  // Fail closed on incomplete records. Never consume an in-flight partial write.
  if(text && !text.endsWith('\n'))throw Error('RECOVERY_AUDIT_INCOMPLETE');
  return text.split('\n').filter(Boolean).map(line=>JSON.parse(line));
}
export async function observeFailures({auditDir,stateDir,projectionDir=null,shop,storeId,privateKey,env=process.env,now=Date.now}){
  const config=flags(env);
  if(!config.enabled)return {mode:'DISABLED',externalActions:0};
  if(!config.shadow)throw Error('SHADOW_ENTRYPOINT_REJECTS_WRITES');
  if(path.resolve(auditDir)===path.resolve(stateDir))throw Error('RECOVERY_STATE_MUST_BE_ISOLATED');
  const [actions,rejections]=await Promise.all([jsonLines(path.join(auditDir,'actions.jsonl')),jsonLines(path.join(auditDir,'provider-rejections.jsonl'))]);
  const events=persistedLegacyFailures(actions,rejections,{shop,storeId});
  if(!events.length)return {available:false,mode:'SHADOW',reason:'NO_PERSISTED_IMPORT_FAILURE',createdThisRun:0,providerRequests:0,externalActions:0};
  await fs.mkdir(stateDir,{recursive:true,mode:0o700});
  const store=new RecoveryStore(path.join(stateDir,'recovery.sqlite'),{privateKey,now});
  try{
    const agent=new AddressRecoveryAgent({store,config,now});
    let created=0;
    for(const e of events){const r=agent.ingest(e);if(r.created)created++;}
    const report={...store.overview(),mode:'SHADOW',source:'PERSISTED_IMPORT_FAILURE_AUDIT',createdThisRun:created,
      writes:{shopify:false,chatby:false,dropea:false},providerRequests:0,externalActions:0};
    const tmp=path.join(stateDir,'overview.'+process.pid+'.tmp');
    await fs.writeFile(tmp,JSON.stringify(report),{mode:0o600});await fs.rename(tmp,path.join(stateDir,'overview.json'));
    if(projectionDir){
      if(path.resolve(projectionDir)===path.resolve(stateDir)||path.resolve(projectionDir)===path.resolve(auditDir))throw Error('RECOVERY_PROJECTION_MUST_BE_ISOLATED');
      await fs.mkdir(projectionDir,{recursive:true,mode:0o755});
      const publicTmp=path.join(projectionDir,'overview.'+process.pid+'.tmp');
      await fs.writeFile(publicTmp,JSON.stringify(report),{mode:0o644});await fs.chmod(publicTmp,0o644);
      await fs.rename(publicTmp,path.join(projectionDir,'overview.json'));
    }
    return report;
  }finally{store.close();}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===await fs.realpath(process.argv[1]).catch(()=>null)){
  process.umask(0o077);
  // Deliberately no network adapters, credentials, global config or importer import.
  globalThis.fetch=()=>{throw Error('SHADOW_NETWORK_FORBIDDEN');};
  try{
    const report=await observeFailures({auditDir:process.env.ADDRESS_RECOVERY_AUDIT_DIR||'/var/lib/suleia-shopify-dropea',stateDir:process.env.ADDRESS_RECOVERY_STATE_DIR||'/var/lib/suleia-address-import-recovery',projectionDir:process.env.ADDRESS_RECOVERY_PROJECTION_DIR,shop:process.env.ADDRESS_RECOVERY_SHOP,storeId:process.env.ADDRESS_RECOVERY_STORE_ID,privateKey:process.env.ADDRESS_RECOVERY_PRIVATE_KEY});
    console.log(JSON.stringify({mode:report.mode,createdThisRun:report.createdThisRun,metrics:report.metrics,providerRequests:0,externalActions:0}));
  }catch{console.error(JSON.stringify({error:'ADDRESS_RECOVERY_SHADOW_FAILED',externalActions:0}));process.exitCode=1;}
}
