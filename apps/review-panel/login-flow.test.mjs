import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

function element() {
  return {
    hidden: true,
    textContent: '',
    href: '',
    disabled: false,
    setAttribute(name, value) { this[name] = value; },
    addEventListener() {},
    classList: { add() {}, remove() {}, toggle() {} },
  };
}

test('login is prepared before it is shown and uses native link navigation', async () => {
  const script = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  const elements = new Map([
    'login-button', 'login-notice', 'login', 'app', 'logout-button',
    'refresh-button', 'prev-page', 'next-page', 'close-drawer', 'drawer-backdrop',
  ].map((id) => [id, element()]));
  const storage = new Map();
  const location = {
    origin: 'https://mcp.suleia.com',
    pathname: '/operations/',
    search: '',
  };
  const context = {
    URL,
    URLSearchParams,
    TextEncoder,
    btoa,
    crypto: webcrypto,
    location,
    history: { replaceState() {} },
    sessionStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    document: {
      title: 'Operations Center',
      getElementById: (id) => elements.get(id) || element(),
      querySelectorAll: () => [],
      addEventListener() {},
      visibilityState: 'visible',
    },
    fetch: async () => ({
      ok: true,
      json: async () => ({
        oauth: {
          issuer: 'https://mcp.suleia.com/auth/realms/suleia',
          client_id: 'suleia-operations-center',
          audience: 'suleia-operations-center',
          scope: 'openid operations:read',
        },
        refresh_interval_seconds: 45,
      }),
    }),
    setInterval() {},
    Intl,
    console,
  };

  await vm.runInNewContext('globalThis.SuleiaShell={mount(){},select(){}};\n'+script, context);

  const button = elements.get('login-button');
  const authorize = new URL(button.href);
  assert.equal(authorize.origin, 'https://mcp.suleia.com');
  assert.equal(authorize.pathname, '/auth/realms/suleia/protocol/openid-connect/auth');
  assert.equal(authorize.searchParams.get('client_id'), 'suleia-operations-center');
  assert.equal(authorize.searchParams.get('scope'), 'openid operations:read');
  assert.equal(authorize.searchParams.get('redirect_uri'), 'https://mcp.suleia.com/operations/');
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(authorize.searchParams.get('code_challenge'));
  assert.equal(button['aria-disabled'], 'false');
  assert.equal(button.textContent, 'Iniciar sesión');
  assert.equal(elements.get('login').hidden, false);
  assert.equal(elements.get('app').hidden, true);
  assert.ok(storage.get('suleia_pkce_verifier'));
  assert.ok(storage.get('suleia_oauth_state'));
});

test('full authenticated startup preserves Ads report and campaign links before dispatch, including OAuth return',async()=>{
 const script=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
 const hashes=['#ads?tab=reports&reportId='+'a'.repeat(64)+'&section=creatives','#ads?tab=comparator&campaignId=123&period=30d'];
 for(const hash of hashes)for(const callback of [false,true]){
  const elements=new Map(),storage=new Map(callback?[['suleia_oauth_state','synthetic-state'],['suleia_pkce_verifier','synthetic-verifier'],['suleia_ads_return',hash]]:[['suleia_access_token','synthetic-token'],['suleia_token_expires_at',String(Date.now()+600000)]]),loaded=[];
  const location={origin:'https://panel.example',pathname:'/operations/',search:callback?'?code=synthetic-code&state=synthetic-state':'',hash:callback?'':hash};
  const context={URL,URLSearchParams,TextEncoder,btoa,crypto:webcrypto,location,Intl,console,setInterval(){},
   history:{replaceState(_a,_b,url){const next=new URL(url,location.origin);location.hash=next.hash;location.search=next.search;}},
   sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},
   document:{title:'Suleia',getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},querySelectorAll:()=>[],addEventListener(){},visibilityState:'visible'},
   SuleiaShell:{mount(){},select(){}},AdsIntelligencePanel:{load(){loaded.push(location.hash);}},
   fetch:async url=>({ok:true,json:async()=>String(url).endsWith('/token')?{access_token:'synthetic-token',expires_in:600}:{oauth:{issuer:'https://panel.example/auth',client_id:'synthetic-client',scope:'openid operations:read'},refresh_interval_seconds:45}})
  };
  await vm.runInNewContext(script,context);
  assert.deepEqual(loaded,[hash]);assert.equal(location.hash,hash);assert.equal(elements.get('app').hidden,false);
 }
});

test('scheduled Ads refresh preserves an open audit and resumes after close without suppressing explicit refresh',async()=>{
 const script=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
 const elements=new Map(),storage=new Map([['suleia_access_token','synthetic-token'],['suleia_token_expires_at',String(Date.now()+600000)]]);
 const location={origin:'https://panel.example',pathname:'/operations/',search:'',hash:'#ads?tab=diagnosis'};
 const audit={tagName:'DIALOG',open:true},ads=element();ads.children=[];
 ads.querySelector=selector=>selector==='dialog[open]'?ads.children.find(child=>child.tagName==='DIALOG'&&child.open)||null:null;
 elements.set('ads-view',ads);let scheduled,loads=0;
 const context={URL,URLSearchParams,TextEncoder,btoa,crypto:webcrypto,location,Intl,console,
  setInterval(fn){scheduled=fn;},history:{replaceState(){}},
  sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},
  document:{title:'Suleia',getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},querySelectorAll:()=>[],addEventListener(){},visibilityState:'visible'},
  SuleiaShell:{mount(){},select(){}},AdsIntelligencePanel:{load(){loads++;ads.children=[];}},
  fetch:async()=>({ok:true,json:async()=>({refresh_interval_seconds:45})})
 };
 await vm.runInNewContext(script,context);assert.equal(loads,1);assert.equal(typeof scheduled,'function');
 ads.children.push(audit);
 for(let i=0;i<2;i++){scheduled();await new Promise(setImmediate);}
 assert.equal(loads,1,'ordinary timer ticks must not reload the view under a modal');
 assert.equal(ads.children[0],audit,'the same open audit remains attached');
 assert.equal(elements.get('refresh-button').disabled,false);
 audit.open=false;scheduled();await new Promise(setImmediate);
 assert.equal(loads,2,'the next ordinary tick resumes refresh after close');
 audit.open=true;ads.children.push(audit);
 await vm.runInNewContext('refresh({force:true})',context);
 assert.equal(loads,3,'an explicit refresh remains available');
 assert.equal(elements.get('refresh-button').disabled,false);
});
