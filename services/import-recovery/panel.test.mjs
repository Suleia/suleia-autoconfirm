import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {recoveryOverviewReader} from './panel-reader.mjs';import {observeFailures} from './shadow.mjs';
import {createOperationsServer,loadOperationsConfig} from '../../apps/api/server.mjs';
import {spawnSync} from 'node:child_process';

class Element{constructor(tag){this.tag=tag;this.children=[];this.events={};this.textContent='';this.value='';}append(...v){this.children.push(...v);}replaceChildren(...v){this.children=v;}addEventListener(k,v){this.events[k]=v;}}
const content=e=>e.textContent+' '+e.children.map(content).join(' ');
test('actual Import Recovery UI displays pending/failures in a separate read-only view, safely',()=>{
 const ctx={document:{createElement:t=>new Element(t)},Date};vm.runInNewContext(fs.readFileSync(new URL('../../apps/review-panel/import-recovery.js',import.meta.url),'utf8')+';globalThis.panel=ImportRecoveryPanel;',ctx);
 const root=new Element('section');ctx.panel.render(root,{available:true,mode:'SHADOW',observedAt:'2026-10-25T12:00:00Z',metrics:{pending:1,address_import_failures:1,auto_corrected:0,customer_required:0,recovered:0,manual_review:1,duplicates_prevented:0},items:[{shopify_order_id:'123',failure_code:'POSTAL_CODE_NOT_COVERED',address_status:'ADDRESS_RECOVERY_REQUIRED',next_action:'MANUAL_REVIEW'}]});
 const text=content(root);assert.match(text,/SHADOW.*solo observación/);assert.match(text,/Dropea rechaza la cobertura/);assert.match(text,/Necesita revisión/);assert.doesNotMatch(text,/Enviar plantilla|Importar ahora|Confirmar pedido/);
});
test('SHADOW consumes only correlated persisted failures, is idempotent and projection strips arbitrary fields',async t=>{
 const dir=fs.mkdtempSync(join(tmpdir(),'suleia-shadow-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const audit=join(dir,'audit'),state=join(dir,'state'),projection=join(dir,'projection');fs.mkdirSync(audit);
 const attempt={orderId:'123',reference:'#123',idempotencyKey:'k1',at:'2026-10-25T11:00:00Z',result:'attempted'},rejection={orderId:'123',reference:'#123',at:'2026-10-25T11:00:02Z',result:'provider_rejected',status:'provider_rejected',reason:'POSTAL_CODE_NOT_COVERED'};
 fs.writeFileSync(join(audit,'actions.jsonl'),[attempt,rejection,{orderId:'124',status:'blocked',reason:'ADDRESS_INCOMPLETE'}].map(JSON.stringify).join('\n')+'\n');fs.writeFileSync(join(audit,'provider-rejections.jsonl'),JSON.stringify({idempotencyKey:'k1',http:400,at:'2026-10-25T11:00:01Z',failure:{type:'ValidationFailure',code:'POSTAL_CODE_NOT_COVERED',message:'private error detail fixture'}})+'\n');
 const cfg={auditDir:audit,stateDir:state,projectionDir:projection,shop:'fixture.myshopify.com',storeId:10,privateKey:'fixture-key-no-production-use-1234567',env:{ADDRESS_IMPORT_RECOVERY_ENABLED:'true'}};
 const first=await observeFailures(cfg),second=await observeFailures(cfg);assert.equal(first.createdThisRun,1);assert.equal(second.createdThisRun,0);assert.equal(second.metrics.pending,1);assert.equal(second.providerRequests,0);assert.ok(!JSON.stringify(second).includes('private error detail fixture'));
 const file=join(projection,'overview.json'),body=JSON.parse(fs.readFileSync(file));body.secret='do-not-expose';body.items[0].phone='do-not-expose';fs.writeFileSync(file,JSON.stringify(body));
 const read=await recoveryOverviewReader(file)();assert.ok(!JSON.stringify(read).includes('do-not-expose'));assert.equal(read.metrics.pending,1);assert.equal(read.metrics.manual_review,1);
 fs.writeFileSync(join(audit,'actions.jsonl'),'partial');await assert.rejects(observeFailures(cfg),/RECOVERY_AUDIT_INCOMPLETE/);
});
test('SHADOW binary rejects all write flags even if the general engine would allow a phase',async()=>{
 await assert.rejects(observeFailures({env:{ADDRESS_IMPORT_RECOVERY_ENABLED:'true',ADDRESS_RECOVERY_SHOPIFY_WRITE:'true'}}),/SHADOW_ENTRYPOINT_REJECTS_WRITES/);
});
test('deployed SHADOW starts through its current directory symlink and writes its verified report',t=>{
 const dir=fs.mkdtempSync(join(tmpdir(),'suleia-shadow-entry-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const real=join(dir,'release'),alias=join(dir,'current'),audit=join(dir,'audit'),state=join(dir,'state');
 fs.mkdirSync(real);for(const name of ['shadow.mjs','store.mjs','policy.mjs','engine.mjs','intake.mjs'])fs.copyFileSync(new URL('./'+name,import.meta.url),join(real,name));
 fs.symlinkSync(real,alias,process.platform==='win32'?'junction':'dir');fs.mkdirSync(audit);
 fs.writeFileSync(join(audit,'actions.jsonl'),JSON.stringify({result:'attempted',orderId:'123',reference:'#123',idempotencyKey:'k1',at:'2026-10-25T11:00:00Z'})+'\n');
 fs.writeFileSync(join(audit,'provider-rejections.jsonl'),JSON.stringify({idempotencyKey:'k1',http:400,at:'2026-10-25T11:00:01Z',failure:{type:'ValidationFailure',code:'POSTAL_CODE_NOT_COVERED'}})+'\n');
 const p=spawnSync(process.execPath,[join(alias,'shadow.mjs')],{encoding:'utf8',env:{...process.env,ADDRESS_IMPORT_RECOVERY_ENABLED:'true',ADDRESS_RECOVERY_SHOPIFY_WRITE:'false',ADDRESS_RECOVERY_CHATBY_SEND:'false',ADDRESS_RECOVERY_DROPEA_IMPORT:'false',ADDRESS_RECOVERY_AUDIT_DIR:audit,ADDRESS_RECOVERY_STATE_DIR:state,ADDRESS_RECOVERY_SHOP:'fixture.myshopify.com',ADDRESS_RECOVERY_STORE_ID:'10',ADDRESS_RECOVERY_PRIVATE_KEY:'fixture-key-no-production-use-1234567'}});
 assert.equal(p.status,0,p.stderr);assert.equal(JSON.parse(p.stdout).mode,'SHADOW');assert.equal(JSON.parse(fs.readFileSync(join(state,'overview.json'))).externalActions,0);
});
test('healthy report without a persisted failure creates no database, case, projection or directory',async t=>{
 const dir=fs.mkdtempSync(join(tmpdir(),'suleia-healthy-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const audit=join(dir,'audit'),state=join(dir,'state');fs.mkdirSync(audit);fs.writeFileSync(join(audit,'actions.jsonl'),JSON.stringify({result:'verified',orderId:'123',at:'2026-10-25T12:00:00Z'})+'\n');fs.writeFileSync(join(audit,'provider-rejections.jsonl'),'');
 const r=await observeFailures({auditDir:audit,stateDir:state,shop:'fixture.myshopify.com',storeId:10,privateKey:'fixture-key-no-production-use-1234567',env:{ADDRESS_IMPORT_RECOVERY_ENABLED:'true'}});assert.equal(r.reason,'NO_PERSISTED_IMPORT_FAILURE');assert.equal(fs.existsSync(state),false);
 const unit=fs.readFileSync(new URL('../../infrastructure/vps/suleia-address-import-recovery-shadow.path',import.meta.url),'utf8');assert.match(unit,/PathChanged=.*provider-rejections\.jsonl/);assert.doesNotMatch(unit,/latest\.json|actions\.jsonl/);
});
test('new panel data shares OAuth and rejects anonymous reads or POSTs; existing queues remain unchanged',async t=>{
 const repository={summary:async()=>({orders:{pending:7}}),listOrders:async()=>({items:[],total:0})};
 const config=loadOperationsConfig({databaseUrl:'postgresql://fixture.invalid/test',privateDataKey:'fixture-test-key-longer-than-32-characters'});
 const server=createOperationsServer({config,repository,authenticate:async req=>{if(req.headers.authorization!=='Bearer fixture')throw Error('unauthorized');return {principal_hash:'fixture'};},importRecoveryReader:async()=>({available:true,metrics:{pending:3},items:[]})});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const url=`http://127.0.0.1:${server.address().port}`;
 const anonymous=await fetch(url+'/api/operations/import-recovery');assert.equal(anonymous.status,401);
 const authenticated=await fetch(url+'/api/operations/import-recovery',{headers:{Authorization:'Bearer fixture'}});assert.equal(authenticated.status,200);const body=await authenticated.json();assert.equal(body.data.metrics.pending,3);assert.equal(body.external_actions,0);
 const post=await fetch(url+'/api/operations/import-recovery',{method:'POST',headers:{Authorization:'Bearer fixture'}});assert.equal(post.status,405);
 const normal=await fetch(url+'/api/operations/summary',{headers:{Authorization:'Bearer fixture'}});assert.equal((await normal.json()).data.orders.pending,7);
});
