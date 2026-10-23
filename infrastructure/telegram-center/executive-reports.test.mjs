import test from 'node:test';import assert from 'node:assert/strict';
import {ExecutiveReports} from './executive-reports.mjs';
function fixture(outcome='ok'){
 let sent=0,claimed=false,ackLost=false,at=100000;const calls=[],state={};
 const gateway={async executive(q,actor){calls.push({q,actor});if(q.operation==='finish'){if(outcome==='ackLost'&&!ackLost){ackLost=true;throw Error('ACK_LOST');}return {state:'RECORDED'};}if(claimed)return {state:'DELIVERED'};claimed=true;return {state:'SEND',id:'a'.repeat(64),part:0,claim:'claim',message:{text:'<b>Prueba &amp; seguridad</b>',markup:{inline_keyboard:[[{text:'VER PANEL',url:'https://panel.example/#ads'}]]}}};}};
 const api={async telegram(method,body){assert.equal(method,'sendMessage');assert.equal(body.parse_mode,'HTML');assert.equal(body.chat_id,'1');assert.ok(state.executiveReceipts);sent++;if(outcome==='unknown')throw Object.assign(Error('network'),{service:'TELEGRAM',status:0});if(outcome==='429')throw Object.assign(Error('limited'),{service:'TELEGRAM',status:429,retryAfter:30});if(outcome==='403')throw Object.assign(Error('forbidden'),{service:'TELEGRAM',status:403});return {message_id:42};}};
 const options={config:{executiveReportsEnabled:true,allowedUserIds:['1'],executiveRecipientIds:['1']},gateway,api,store:{state,save(){}},now:()=>at};
 return {options,calls,state,get sent(){return sent;},advance(){at+=16000;}};
}
for(const [outcome,status]of [['ok','SENT'],['unknown','UNKNOWN'],['429','RETRY'],['403','REJECTED']])test('Telegram '+outcome+' has persisted delivery outcome '+status,async()=>{
 const f=fixture(outcome);await new ExecutiveReports(f.options).tick();assert.equal(f.sent,1);assert.ok(f.calls.some(c=>c.q.operation==='finish'&&c.q.state===status));
 if(outcome==='unknown'){f.advance();await new ExecutiveReports(f.options).tick();assert.equal(f.sent,1);}
});
test('ACK loss is reconciled from durable receipt after restart, without another send',async()=>{
 const f=fixture('ackLost');await new ExecutiveReports(f.options).tick();assert.equal(f.sent,1);assert.equal(Object.values(f.state.executiveReceipts)[0].acknowledged,undefined);
 f.advance();await new ExecutiveReports(f.options).tick();assert.equal(f.sent,1);assert.equal(Object.values(f.state.executiveReceipts)[0].acknowledged,true);
});
test('double tick is coalesced and scheduler has no budget transport',async()=>{
 const f=fixture(),worker=new ExecutiveReports(f.options);await Promise.all([worker.tick(),worker.tick()]);assert.equal(f.sent,1);assert.ok(f.calls.every(c=>['due','finish'].includes(c.q.operation)));
});
test('disabled or unapproved financial recipients receive nothing',async()=>{
 const f=fixture();f.options.config.executiveRecipientIds=['2'];await new ExecutiveReports(f.options).tick();assert.equal(f.sent,0);assert.equal(f.calls.length,0);
 f.options.config.executiveRecipientIds=['1'];f.options.config.executiveReportsEnabled=false;await new ExecutiveReports(f.options).tick();assert.equal(f.sent,0);
});
test('crash before receipt leaves SENDING and is never replayed after restart',async()=>{
 const f=fixture();f.state.executiveReceipts={[`${'a'.repeat(64)}:1:0`]:{user:'1',state:'SENDING'}};await new ExecutiveReports(f.options).tick();assert.equal(f.sent,0);
});
