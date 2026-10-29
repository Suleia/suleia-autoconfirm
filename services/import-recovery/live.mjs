import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {flags,safeCode,normalizeId} from './policy.mjs';
import {RecoveryStore} from './store.mjs';
import {AddressRecoveryAgent} from './engine.mjs';
import {persistedLegacyFailures,persistedNativeFailure,markedFailureEligible} from './intake.mjs';
import {recoveryShopify} from './shopify.mjs';
import {cartociudadResolver} from './cartociudad.mjs';

export const MARKED_QUERY=`query AddressRecoveryMarkedOrders($after: String) {
  orders(first: 50, after: $after, query: "(tag:error_dropea OR tag:dropea_error) status:open fulfillment_status:unfulfilled") {
    nodes { id name tags note customAttributes { key value } }
    pageInfo { hasNextPage endCursor }
  }
}`;

export async function nativeFailures({request,root,shop,storeId,store,now=Date.now}){
  const events=[];let after=null;
  for(let page=0;page<10;page++){
    const r=await request(root+'graphql.json',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:MARKED_QUERY,variables:{after}})});
    const j=await r.json();if(!r.ok||j.errors||!Array.isArray(j.data?.orders?.nodes))throw Error('NATIVE_FAILURE_QUERY_UNAVAILABLE');
    const connection=j.data.orders;
    for(const n of connection.nodes){
      const id=normalizeId(n.id),attrs=(n.customAttributes||[]).map(x=>({name:x.key,value:x.value}));
      if(!markedFailureEligible({tags:n.tags,note_attributes:attrs})||n.tags.some(t=>/^dropea_id:/.test(t)))continue;
      // Active/resolved cases are processed from the durable queue, not
      // rediscovered by fetching their source and timeline on every poll.
      const previous=store.db.prepare('SELECT id,detected_at FROM order_import_recovery_case WHERE shopify_order_id=? ORDER BY detected_at DESC LIMIT 1').get(id);
      if(previous&&store.get(previous.id).private.originalError?.note===n.note)continue;
      const response=await request(root+`orders/${id}.json`),body=await response.json();
      if(!response.ok||String(body.order?.id)!==id)throw Error('NATIVE_FAILURE_SOURCE_UNAVAILABLE');
      const timeline=await request(root+`orders/${id}/events.json?limit=250`),history=await timeline.json();
      if(!timeline.ok||!Array.isArray(history.events)||history.events.length>=250)throw Error('NATIVE_FAILURE_EVIDENCE_INCOMPLETE');
      const event=persistedNativeFailure(body.order,history.events,{shop,storeId,observedAt:new Date(now()).toISOString()});
      if(event&&(!previous||Date.parse(event.at)>Date.parse(previous.detected_at)))events.push(event);
    }
    if(connection.pageInfo?.hasNextPage===false)return events;
    const next=connection.pageInfo?.endCursor;if(!next||next===after)throw Error('NATIVE_FAILURE_PAGINATION_INVALID');after=next;
  }
  throw Error('NATIVE_FAILURE_PAGE_LIMIT');
}

async function jsonLines(file){const stat=await fs.stat(file);if(stat.size>16*1024*1024)throw Error('RECOVERY_AUDIT_ROTATION_REQUIRED');const t=await fs.readFile(file,'utf8');if(t&&!t.endsWith('\n'))throw Error('RECOVERY_AUDIT_INCOMPLETE');return t.split('\n').filter(Boolean).map(JSON.parse);}
export async function publishReport(report,stateDir,projectionDir){
  for(const [dir,mode]of [[stateDir,0o600],[projectionDir,0o644]]){
    if(!dir)continue;const tmp=path.join(dir,`overview.${process.pid}.tmp`);
    await fs.writeFile(tmp,JSON.stringify(report),{mode});await fs.chmod(tmp,mode);await fs.rename(tmp,path.join(dir,'overview.json'));
  }
}

export async function liveCycle({env=process.env,fetchImpl=fetch,now=Date.now}={}){
  const config=flags(env);if(!config.enabled)return {mode:'DISABLED',externalActions:0};
  // This rollout corrects source addresses only. The unchanged, already LIVE
  // native/existing importer owns all creations; no parallel POST writer.
  if(config.chatbySend||config.dropeaImport)throw Error('LIVE_SOURCE_ONLY_ROLLOUT_REQUIRED');
  const shop=env.ADDRESS_RECOVERY_SHOP,storeId=Number(env.ADDRESS_RECOVERY_STORE_ID);
  if(shop!=='vcnby0-h1.myshopify.com'||storeId!==16088)throw Error('RECOVERY_STORE_SCOPE_INVALID');
  const stateDir=env.ADDRESS_RECOVERY_STATE_DIR,projectionDir=env.ADDRESS_RECOVERY_PROJECTION_DIR,auditDir=env.ADDRESS_RECOVERY_AUDIT_DIR;
  if(!stateDir||!auditDir||path.resolve(stateDir)===path.resolve(auditDir))throw Error('RECOVERY_STATE_MUST_BE_ISOLATED');
  const normalRoot=env.ADDRESS_RECOVERY_EXISTING_ROOT||'/opt/suleia-shopify-dropea/current';
  const {getAppConfig}=await import(pathToFileURL(path.join(normalRoot,'autoconfirm/src/config.mjs')));
  const {collectDropeaPages,planShopifyDropeaRecovery,verifyRecoveredOrder}=await import(pathToFileURL(path.join(normalRoot,'autoconfirm/src/workflows/shopify-dropea-recovery.mjs')));
  const cfg=getAppConfig();if(cfg.shopifyDomain!==shop||cfg.shopifyApiVersion!=='2026-04')throw Error('RECOVERY_SHOPIFY_CONFIG_INVALID');
  let requests=0,shopifyWrites=0,nextAt=0;
  const request=async(url,options={})=>{
    if(nextAt>now())await new Promise(r=>setTimeout(r,nextAt-now()));nextAt=now()+800;requests++;
    return fetchImpl(url,{...options,redirect:'error',signal:AbortSignal.timeout(25000)});
  };
  let token=cfg.shopifyAdminAccessToken;
  if(!token){
    const r=await request(`https://${shop}/admin/oauth/access_token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:cfg.shopifyClientId,client_secret:cfg.shopifyClientSecret})});
    const j=await r.json();if(!r.ok||!j.access_token)throw Error('RECOVERY_SHOPIFY_AUTH_UNAVAILABLE');token=j.access_token;
  }
  const root=`https://${shop}/admin/api/2026-04/`;
  const sourceRequest=async(url,options={})=>{
    if(!url.startsWith(root))throw Error('RECOVERY_SHOP_MISMATCH');
    if(options.method==='POST'&&JSON.parse(options.body).query?.startsWith('mutation'))shopifyWrites++;
    return request(url,{...options,headers:{...options.headers,'X-Shopify-Access-Token':token}});
  };
  const client=recoveryShopify({shop,requestOnce:sourceRequest});
  const read=async id=>{
    const o=await client.readOrder(id,shop),age=now()-Date.parse(o.created_at);
    if(!Number.isFinite(age)||age<30*60_000||age>7*86400_000)throw Error('FAILED_ORDER_AGE_REQUIRES_REVIEW');return o;
  };
  const providerGet=async endpoint=>{
    const r=await request('https://es.public-api.dropea.com/dropshipper/'+endpoint,{headers:{Accept:'application/json',Authorization:'Bearer '+env.DROPEA_READ_JWT_ES}});
    const j=await r.json();if(!r.ok||j.success!==true||!j.data)throw Error('RECOVERY_DROPEA_READ_UNAVAILABLE');return j.data;
  };
  let products=null,carriers=null;
  const exact=async({externalReference,storeId:caseStoreId})=>{
    const items=await collectDropeaPages(async page=>providerGet(`orders?store_id=${storeId}&external_order_id=${encodeURIComponent(externalReference)}&limit=100&page=${page}`));
    if(items.some(o=>o.store_id!==storeId||o.external_order_id!==externalReference))throw Error('EXACT_REFERENCE_UNVERIFIABLE');
    const normalized=[];
    for(const item of items){
      let verified=false;
      // Full GET postconditions only for an actual existing reference. No source
      // validation or catalog requests for healthy orders outside failed cases.
      if(items.length===1){
        const actual=await providerGet('orders/'+item.id);
        const c=store.db.prepare('SELECT shopify_order_id FROM order_import_recovery_case WHERE external_reference_hash=? ORDER BY detected_at DESC LIMIT 1').get((await import('./policy.mjs')).digest([shop,caseStoreId,externalReference]));
        if(c){try{
          const o=await client.readOrder(c.shopify_order_id,shop);
          products??=await collectDropeaPages(async page=>providerGet(`shops/${storeId}/products?limit=100&page=${page}`));
          carriers??=(await providerGet('catalogs/carriers')).items;
          const plan=planShopifyDropeaRecovery(o,products,carriers,{storeId,now:now()});verified=plan.eligible&&verifyRecoveredOrder(actual,plan);
        }catch{verified=false;}}
      }
      normalized.push({id:item.id,storeId,externalReference,sourcePostconditionsVerified:verified,addressProblem:verified?false:undefined});
    }
    return {items:normalized,storeId,externalReference,complete:true,observedAt:new Date(now()).toISOString()};
  };
  await fs.mkdir(stateDir,{recursive:true,mode:0o700});
  const store=new RecoveryStore(path.join(stateDir,'recovery.sqlite'),{privateKey:env.ADDRESS_RECOVERY_PRIVATE_KEY,now});
  try{
    const agent=new AddressRecoveryAgent({store,config:{...config,validateCoverage:true},now,ports:{
      shopify:{readOrder:read,updateShippingAddress:client.updateShippingAddress.bind(client)},
      address:cartociudadResolver({request,now}),dropea:{findExact:exact}
    }});
    const [actions,rejections]=await Promise.all([jsonLines(path.join(auditDir,'actions.jsonl')),jsonLines(path.join(auditDir,'provider-rejections.jsonl'))]);
    const events=persistedLegacyFailures(actions,rejections,{shop,storeId});
    let intakeError=null;
    try{events.push(...await nativeFailures({request:sourceRequest,root,shop,storeId,store,now}));}catch(e){intakeError=safeCode(e.message);}
    for(const e of events)agent.ingest(e);
    let processed=0;const pending=store.pending(101);
    for(const id of pending.slice(0,100)){await agent.process(id);processed++;}
    const report={...store.overview(),mode:config.shadow?'SHADOW':'LIVE',source:'PERSISTED_ADDRESS_FAILURES_ONLY',processed,
      completedAt:new Date(now()).toISOString(),coverageComplete:!intakeError&&pending.length<=100,intakeError:intakeError||(pending.length>100?'FAILED_CASE_BATCH_LIMIT':null),
      writes:{shopify:config.shopifyWrite,chatby:false,dropea:false},providerRequests:requests,shopifyWrites,dropeaWrites:0,
      importOwner:'EXISTING_UNCHANGED_IMPORTER'};
    await publishReport(report,stateDir,projectionDir);return report;
  }finally{store.close();}
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===await fs.realpath(process.argv[1]).catch(()=>null)){
  process.umask(0o077);
  try{const r=await liveCycle();console.log(JSON.stringify({mode:r.mode,completedAt:r.completedAt,coverageComplete:r.coverageComplete,intakeError:r.intakeError,processed:r.processed,metrics:r.metrics,shopifyWrites:r.shopifyWrites,dropeaWrites:0}));if(r.coverageComplete===false)process.exitCode=1;}
  catch(e){console.error(JSON.stringify({error:safeCode(e.message)}));process.exitCode=1;}
}
