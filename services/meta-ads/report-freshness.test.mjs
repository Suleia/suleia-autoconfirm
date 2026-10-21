import test from 'node:test';import assert from 'node:assert/strict';import {createAdsRuntime} from './runtime.mjs';
test('forced refresh is coalesced, failure preserves actual old snapshot without provider writes',async()=>{
 let failed=false,reads=0;const fetchImpl=async(url,options)=>{assert.equal(options.method,'GET');reads++;if(failed)return new Response('{}',{status:403});const u=new URL(url);return new Response(JSON.stringify(u.pathname.endsWith('/act_9')?{id:'act_9',account_status:1,currency:'EUR',timezone_name:'Europe/Madrid'}:{data:[]}));};
 const r=createAdsRuntime({pool:{query:async q=>{assert.match(q,/^SELECT/);return {rows:[]};}},fetchImpl,env:{ADS_INTELLIGENCE_READ_ENABLED:'true',ADS_REPORT_READ_ONLY:'true',META_ACCESS_TOKEN:'fixture',META_AD_ACCOUNT_ID:'9',TELEGRAM_ALLOWED_USER_IDS:'1'}});
 const first=await r.overview({period:'hoy'}),before=reads;await r.overview({period:'hoy'});assert.equal(reads,before);
 failed=true;const [a,b]=await Promise.all([r.overview({period:'hoy',force:true}),r.overview({period:'hoy',force:true})]);assert.equal(reads,before+1);assert.equal(a.cache.status,'STALE');assert.equal(a.observedAt,first.observedAt);assert.equal(b.observedAt,a.observedAt);assert.equal(a.totals.spend,null);
});
