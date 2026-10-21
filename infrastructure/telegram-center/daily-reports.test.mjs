import test from 'node:test';import assert from 'node:assert/strict';
import {DailyReports,dailySettingsCommand} from './daily-reports.mjs';
import {createApis} from './api.mjs';
import {compactOrders,compactMeta} from './compact-reports.mjs';
test('daily delivery survives restart, uncertain send is never retried and settings are per actor',async()=>{
 const state={},store={state,save(){}},config={dailyReportsEnabled:true,allowedUserIds:['1','2']};
 dailySettingsCommand('Desactiva el informe diario','2',config,store);
 let reads=0,sends=0;
 const options={store,config,now:()=>Date.parse('2026-10-22T21:55:00Z'),gateway:{read:async()=>{reads++;return {media:{}};}},api:{media:async()=>{sends++;throw Error('network unknown');}}};
 await new DailyReports(options).tick();await new DailyReports(options).tick();assert.equal(sends,1);assert.equal(reads,1);assert.equal(state.dailyReportDeliveries['2026-10-22:1'].state,'UNKNOWN');
 assert.equal(dailySettingsCommand('Informe diario a las 25:99','1',config,store).text.includes('válida'),true);
 assert.match(dailySettingsCommand('Informe diario a las 22:30 en imagen','1',config,store).text,/22:30.*imagen/);
});
test('media upload is multipart and refresh edits original media without duplicate sends',async()=>{
 const requests=[];const api=createApis({botToken:'fixture'},async(url,opts)=>{requests.push({url,opts});return new Response(JSON.stringify({ok:true,result:{message_id:7}}),{status:200});});
 const media={data:Buffer.from('fixture'),filename:'chart.png',mime:'image/png',caption:'safe'};
 await api.media(1,media,{inline_keyboard:[]});await api.media(1,media,{},7);
 assert.ok(requests[0].url.endsWith('/sendPhoto'));assert.ok(requests[1].url.endsWith('/editMessageMedia'));
 assert.equal(requests[1].opts.body.get('message_id'),'7');assert.equal(JSON.parse(requests[1].opts.body.get('media')).media,'attach://upload');assert.equal(requests[1].opts.redirect,'error');
});
test('historical headings and product buttons preserve exact requested period and metric',()=>{
 const o={period:{spec:{preset:'custom',from:'2026-10-15',to:'2026-10-15'},label:'2026-10-15',partial:false},received:4,confirmed:3,pending:1,cancelled:0,freshness:'FRESH',coverage:'COMPLETE',observedAt:'2026-10-22T10:00Z'};
 const r=compactOrders(o);assert.match(r.text,/2026-10-15/);assert.doesNotMatch(r.text,/PEDIDOS DE HOY/);
 const p=compactOrders(o,'products','units');assert.equal(p.artifact.metric,'units');assert.deepEqual(p.navigation[0].request.period,o.period.spec);
});
test('worst campaign means lowest evaluable campaign ROAS, never missing metrics or ad substitutions',()=>{
 const r=compactMeta({focus:'worst',analysis:{range:{since:'2026-10-22',until:'2026-10-22'},facts:[{entityId:'1',name:'Higher',roas:5,roasStatus:'VALID',delivery:'ACTIVE'},{entityId:'2',name:'Lower',roas:1,roasStatus:'VALID',delivery:'ACTIVE'},{entityId:'3',name:'Unknown',roas:null,roasStatus:'MISSING',delivery:'ACTIVE'}],improveAds:[{name:'Unrelated ad'}]}});
 assert.ok(r.text.indexOf('Lower')<r.text.indexOf('Higher'));assert.doesNotMatch(r.text,/Unknown|Unrelated/);
});
