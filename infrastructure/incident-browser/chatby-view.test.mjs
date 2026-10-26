import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureChatbyView} from './chatby-view.mjs';

function fixture({url='https://app.chatby.io/settings/accounts/298087#/chat/f295175',ready=false,recovers=true,redirect}={}){
 const calls={reloads:0,waits:0};
 const locator={filter(options){assert.deepEqual(options,{visible:true});return this;},async waitFor(){calls.waits++;if(!ready)throw Error('TimeoutError');}};
 return {calls,page:{url:()=>url,getByPlaceholder(label,options){assert.equal(label,'Buscar');assert.deepEqual(options,{exact:true});return locator;},async reload(options){assert.equal(options.waitUntil,'domcontentloaded');calls.reloads++;ready=recovers;if(redirect)url=redirect;}}};
}
test('ready dedicated view is left alone',async()=>{
 const f=fixture({ready:true});assert.deepEqual(await ensureChatbyView(f.page),{ready:true,reloaded:false});assert.equal(f.calls.reloads,0);
});
test('blank dedicated view gets one bounded reload and visible readiness check',async()=>{
 const f=fixture();assert.deepEqual(await ensureChatbyView(f.page),{ready:true,reloaded:true});assert.deepEqual(f.calls,{reloads:1,waits:2});
});
test('persistent blank view fails closed without repeated reloads',async()=>{
 const f=fixture({recovers:false});await assert.rejects(ensureChatbyView(f.page),/CHATBY_SESSION_OR_VIEW_REQUIRED/);assert.equal(f.calls.reloads,1);
});
test('login, another account and another origin are never reloaded',async()=>{
 for(const url of ['https://app.chatby.io/login','https://app.chatby.io/settings/accounts/1','https://example.com/settings/accounts/298087']){
  const f=fixture({url});await assert.rejects(ensureChatbyView(f.page),/CHATBY_ACCOUNT_VIEW_REQUIRED/);assert.equal(f.calls.reloads,0);
 }
});
test('redirect after reload cannot become a successful identity proof',async()=>{
 const f=fixture({redirect:'https://app.chatby.io/login'});await assert.rejects(ensureChatbyView(f.page),/CHATBY_ACCOUNT_VIEW_REQUIRED/);assert.equal(f.calls.reloads,1);
});
