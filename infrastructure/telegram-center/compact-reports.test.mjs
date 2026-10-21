import test from 'node:test';import assert from 'node:assert/strict';
import {compactMeta,compactOrders,rankFacts} from './compact-reports.mjs';
import {Controller} from './controller.mjs';
import {createApis} from './api.mjs';
const now=Date.parse('2026-10-21T18:28:00Z');
const fact=(id,roas=3,extra={})=>({entityId:id,campaignId:id,name:'Campaña '+id,roas,roasStatus:'VALID',spend:30,purchases:6,impressions:2000,delivery:'ACTIVE',...extra});
const report=(facts)=>({analysis:{version:3,range:{since:'2026-10-21',until:'2026-10-21'},level:'campaign',facts,totals:{spend:133,purchases:17,roas:4.82},observedAt:new Date(now).toISOString(),actions:[]}});
test('ROAS descending, deterministic ties, missing/ambiguous/zero-spend last',()=>{
 const r=rankFacts([fact('5',null),fact('2',6),fact('1',6),fact('3',0,{roasStatus:'ZERO'}),fact('4',99,{roasStatus:'AMBIGUOUS'}),fact('6',null,{roasStatus:'ZERO_SPEND'})]);
 assert.deepEqual(r.map(x=>x.entityId),['1','2','3','4','5','6']);
});
test('safe HTML, highlighted ROAS, no zero for missing events, one purchase is no winner',()=>{
 const r=compactMeta(report([fact('1',8,{name:'<script>& "_*',purchases:1}),fact('2',null,{purchases:null,roasStatus:'MISSING'})]));
 assert.match(r.text,/<b>ROAS: 8<\/b> · Muestra insuficiente/);assert.match(r.text,/&lt;script&gt;&amp;/);assert.match(r.text,/Compras: N\/D/);assert.doesNotMatch(r.text,/🏆|rentable|<script>/);assert.equal(r.parseMode,'HTML');
});
test('every active campaign is reachable, inactive separated, identity preserved',()=>{
 const data=report(Array.from({length:10},(_,i)=>fact(String(i),i+1)));data.analysis.facts.push(fact('inactive',100,{delivery:'PAUSED'}));
 let r=compactMeta(data);assert.doesNotMatch(r.text,/inactive/);assert.equal(r.navigation.find(b=>b.label==='Ver más →').page,1);
 assert.match(compactMeta(data,{page:2}).text,/Campaña 0/);
 assert.match(compactMeta({...data,includeInactive:true},{page:2}).text,/Inactiva/);
});
test('three recommendations maximum, product detail and stale clock disclosure',()=>{
 const data=report([fact('1',4,{product:{name:'Varios productos',products:[{name:'A'},{name:'B'}]}})]);
 data.analysis.actions=Array.from({length:5},(_,i)=>({entityId:'1',name:'Campaña',action:'Consejo '+i}));data.analysis.cache={status:'STALE'};
 const r=compactMeta(data,{view:'diagnosis'});assert.equal((r.text.match(/Consejo/g)||[]).length,3);assert.match(r.text,/A · B/);assert.match(r.text,/Última instantánea/);assert.match(r.text,/20:28/);
});
test('historical order format and confirmation event view use supplied dynamic numbers',()=>{
 const data={received:22,confirmed:17,pending:4,cancelled:1,confirmations:19,coverage:'COMPLETE',freshness:'FRESH',observedAt:new Date(now).toISOString()};
 const r=compactOrders(data);assert.match(r.text,/77,3 %/);assert.match(r.text,/<b>22<\/b>/);assert.match(compactOrders(data,'confirmations').text,/<b>19<\/b>/);
 assert.match(compactOrders({...data,freshness:'STALE'}).text,/desactualizada/);assert.doesNotMatch(compactOrders({freshness:'UNAVAILABLE'}).text,/Recibidos/);
});
function fixture(){
 const sent=[],calls=[],store={state:{proposals:{}},save(){},record(){}};
 const api={send:async(...args)=>{sent.push(args);return {message_id:10};},telegram:async(method,body)=>{calls.push({method,body});return true;}};
 const c=new Controller({config:{allowedUserIds:['1','2']},api,store,now:()=>now});
 c.adsGateway={handle:async()=>compactMeta(report([fact('1')])),read:async()=>compactMeta(report([fact('1',5)]))};
 const message={message_id:10,chat:{id:1,type:'private'},from:{id:1,is_bot:false},text:'Cómo van las campañas hoy',date:now/1000};
 return {c,store,sent,calls,message,api};
}
test('refresh button is actor/message bound, edits once, never sends duplicate or polls',async()=>{
 const f=fixture();await f.c.handle({update_id:1,message:f.message});assert.equal(f.sent.length,1);
 const key=f.sent[0][2].inline_keyboard[0][0].callback_data;
 const update={callback_query:{id:'c',data:key,from:f.message.from,message:f.message}};
 await f.c.handle(update);assert.equal(f.sent.length,1);assert.equal(f.calls.filter(c=>c.method==='editMessageText').length,1);
 await f.c.handle(update);assert.equal(f.calls.filter(c=>c.method==='editMessageText').length,1);
 await f.c.handle({...update,callback_query:{...update.callback_query,message:{...f.message,message_id:11}}});assert.equal(f.calls.filter(c=>c.method==='editMessageText').length,1);
 await f.c.handle({...update,callback_query:{...update.callback_query,from:{id:2},message:{...f.message,chat:{id:2,type:'private'}}}});assert.equal(f.calls.filter(c=>c.method==='editMessageText').length,1);
 assert.ok(f.calls.every(c=>['answerCallbackQuery','editMessageText'].includes(c.method)));
});
test('concurrent clicks coalesce, errors preserve original report and recover',async()=>{
 const f=fixture();await f.c.handle({update_id:1,message:f.message});const key=f.sent[0][2].inline_keyboard[0][0].callback_data;
 let resolve,reads=0;f.c.adsGateway.read=()=>{reads++;return new Promise(r=>resolve=r);};
 const update={callback_query:{id:'c',data:key,from:f.message.from,message:f.message}};
 const first=f.c.handle(update);await new Promise(r=>setImmediate(r));await f.c.handle(update);assert.equal(reads,1);
 resolve(compactMeta(report([fact('1')])));await first;assert.equal(f.sent.length,1);
 f.api.telegram=async(method)=>{if(method==='editMessageText')throw Error('uneditable');};
 f.c.adsGateway.read=async()=>compactMeta(report([fact('1')]));
 delete f.store.state.reportClicks['1:10'];
 const next=Object.keys(f.store.state.reportButtons).at(-1);await f.c.handle({...update,callback_query:{...update.callback_query,data:'read:'+next}});assert.equal(f.c.reportBusy.size,0);assert.equal(f.sent.length,1);
});
test('long escaped diagnostic content remains a complete bounded Telegram message',()=>{
 const data=report(Array.from({length:4},(_,i)=>fact(String(i),2,{name:'&'.repeat(500),product:{name:'&'.repeat(200),products:Array.from({length:8},()=>({name:'&'.repeat(100)}))},diagnoses:Array.from({length:3},()=>({recommendedAction:'&'.repeat(300)}))})));
 data.analysis.actions=Array.from({length:3},()=>({entityId:'0',name:'&'.repeat(300),action:'&'.repeat(500)}));
 const r=compactMeta(data,{view:'diagnosis'});assert.ok(r.text.length<4096,r.text.length);assert.equal((r.text.match(/<b>/g)||[]).length,(r.text.match(/<\/b>/g)||[]).length);
});
test('HTML API sends one complete message with parse mode and markup',async()=>{
 const calls=[];const api=createApis({botToken:'fixture'},async(url,options)=>{calls.push(JSON.parse(options.body));return {ok:true,json:async()=>({ok:true,result:{message_id:4}})};});
 assert.equal((await api.send(1,'<b>ROAS</b>',{inline_keyboard:[]},'HTML')).message_id,4);assert.equal(calls[0].parse_mode,'HTML');
 await assert.rejects(api.send(1,'a'.repeat(4097),null,'HTML'),/TOO_LONG/);
});
