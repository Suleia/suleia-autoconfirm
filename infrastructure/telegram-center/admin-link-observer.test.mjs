import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from './store.mjs';import {Controller} from './controller.mjs';
import {createLinkRequest} from './admin-link.mjs';import {createAdminLinkObserver} from './admin-link-observer.mjs';
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'admin-observer-'));let store=new Store(dir);
 t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 let time=Date.now();const bot={id:99,is_bot:true,username:'example_bot'};
 const config={stateDir:dir,expectedBotUsername:'example_bot',allowedUserIds:['7'],writesEnabled:false,maxBudgetCents:10000,maxChangePercent:10,proposalTtlMs:300000};
 const req=createLinkRequest(config,bot,'Second_admin','7',time);store.atomic('admin-link-request.json',req);
 const sent=[],calls=[];const api={send:async(id,text)=>sent.push({id,text}),telegram:async(method)=>{calls.push(method);if(method==='getMe')return bot;if(method==='getChat')return{id:8,type:'private',username:'Second_admin'};throw Error('Forbidden API');}};
 const update=(id,text,username,n=id)=>({update_id:n,message:{message_id:n,text,date:Math.floor(time/1000),from:{id,is_bot:false,username},chat:{id,type:'private'}}});
 const owner=update(7,`/vincular_admin ${req.nonce} @Second_admin`,'owner',10),candidate=update(8,`/start link_${req.nonce}`,'Second_admin',11);
 const observer=()=>createAdminLinkObserver({config,api,store,now:()=>time});
 return {dir,config,req,api,sent,calls,owner,candidate,observer,store:()=>store,reopen(){store.close();store=new Store(dir);},expire(){time+=600001;}};
}
test('same sole consumer verifies either message order, persists across restart, never grants or polls',async t=>{
 const f=fixture(t);assert.equal((await f.observer().handle(f.candidate)).authorized,false);f.reopen();
 assert.equal((await f.observer().handle(f.owner)).authorized,true);
 const proof=JSON.parse(fs.readFileSync(path.join(f.dir,'admin-link-proof.json')));
 assert.equal(proof.proof.candidate.userId,'8');assert.deepEqual(f.config.allowedUserIds,['7']);assert.equal(proof.proof.productionChangeApplied,false);
 assert.deepEqual(f.calls,['getMe','getChat']);assert.equal(new Controller({config:f.config,store:f.store(),api:f.api}).authorized(f.candidate.message),false);
 const count=f.sent.length;await f.observer().handle(f.owner);await f.observer().handle(f.candidate);assert.equal(f.sent.length,count);
});
for(const condition of ['wrongNonce','wrongUsername','group','forward','edited','bot','wrongChat','old','wrongOwner','future'])test(`ignore ineligible verification: ${condition}`,async t=>{
 const f=fixture(t);const u=structuredClone(f.candidate);if(condition==='wrongNonce')u.message.text='/start link_'+('x'.repeat(32));
 if(condition==='wrongUsername')u.message.from.username='Different_user';if(condition==='group')u.message.chat.type='group';
 if(condition==='forward')u.message.forward_origin={type:'user'};if(condition==='edited')u.message.edit_date=u.message.date;
 if(condition==='bot')u.message.from.is_bot=true;if(condition==='wrongChat')u.message.chat.id=9;if(condition==='old')u.message.date-=3600;
 if(condition==='future')u.message.date+=3600;if(condition==='wrongOwner'){u.message.text=f.owner.message.text;u.message.from.username='owner';}
 assert.equal(await f.observer().handle(u),null);assert.equal(f.sent.length,0);assert.equal(f.calls.length,0);assert.equal(fs.existsSync(path.join(f.dir,'admin-link-proof.json')),false);
});
test('expiry gives one safe owner response, no candidate access or proof',async t=>{const f=fixture(t);f.expire();f.owner.message.date=Math.floor(Date.now()/1000)+600;await f.observer().handle(f.owner);await f.observer().handle(f.owner);assert.equal(f.sent.length,1);assert.match(f.sent[0].text,/caducado/);assert.deepEqual(f.config.allowedUserIds,['7']);});
test('invalid private request mode fails closed',async t=>{const f=fixture(t);fs.chmodSync(path.join(f.dir,'admin-link-request.json'),0o644);await assert.rejects(()=>f.observer().handle(f.owner),/FILE_INVALID/);assert.equal(f.sent.length,0);});
test('changed financial policy blocks verification and preserves allowlist',async t=>{const f=fixture(t);f.config.maxChangePercent=20;await assert.rejects(()=>f.observer().handle(f.owner),/CONFIG_CHANGED/);assert.deepEqual(f.config.allowedUserIds,['7']);});
test('ambiguous verification send is not resent after restart',async t=>{const f=fixture(t);f.api.send=async()=>{throw Error('uncertain')};await assert.rejects(()=>f.observer().handle(f.owner),/uncertain/);f.reopen();f.api.send=async()=>{throw Error('must not send')};await f.observer().handle(f.owner);assert.equal(f.calls.length,0);});
