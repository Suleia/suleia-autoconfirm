import test from 'node:test';
import assert from 'node:assert/strict';
import {CommandCenter,CONTEXT_TTL_MS,parseBusiness,freshness,consolidateAlerts} from './center.mjs';

const clock=Date.parse('2026-10-21T10:00:00Z'),at=new Date(clock).toISOString();
test('2.1 requested reports route to the shared reader; callback authorization stays server-side',async()=>{
 let reads=0;const f=fixture({orderReader:{get:async()=>{reads++;return {received:22};}},roles:{'1':'operator','2':'analyst'}});
 assert.equal((await f.request('¿Cuántos pedidos llevamos hoy?')).orders.received,22);
 await assert.rejects(f.c.command({action:'orders-summary',actor:{user:'2',chat:'2'}}),/ACTOR_UNAUTHORIZED/);assert.equal(reads,1);
 for(const text of ['¿Cuál está funcionando mejor?','¿Dónde estamos perdiendo dinero?','¿Qué anuncios están vendiendo más?'])assert.equal(parseBusiness(text).tool,'ads');
 const ads=fixture();const compared=await ads.request('Compara las campañas de hoy con ayer');assert.equal(compared.analysis.query.period,'hoy');assert.equal(compared.previousDay.query.period,'ayer');
});
function fixture(options={}) {
 let now=clock,reads=0,proposals=0,confirmations=0;const context=new Map(),history=[];
 const report={version:3,observedAt:at,contract:'fixture-contract',totals:{spend:50,purchases:4,roas:null},actions:[{id:'a',code:'CTR_DROP',priority:3,evidenceText:'CTR inferior al periodo anterior con muestra suficiente.',action:'Revisar anuncio',entityId:'3'}]};
 const ledger={context:async(id,n)=>context.get(id)?.expiresAt>n?context.get(id).body:null,saveContext:async(id,body,expiresAt)=>context.set(id,{body,expiresAt}),remember:async x=>{const id=(history.length+1).toString(16).padStart(64,'0');if(!history.some(h=>h.key===x.key&&h.actor===x.actor&&h.kind===x.kind))history.push({...x,id,body:{evidence:x.evidence,observedAt:at}});return id;},history:async id=>history.filter(h=>h.actor===id),latest:async()=>history.findLast(h=>h.kind==='EXECUTIVE_BRIEF')};
 const ads={engine:{mode:'SHADOW',policy:{maxBudgetCents:10000,maxChangePercent:10},authorize(a){if(!['1','2'].includes(a.user)||a.chat!==a.user)throw Error('ACTOR_UNAUTHORIZED');},propose:async p=>{proposals++;return {state:'PENDING',request:p.text};},confirm:async()=>{confirmations++;return {state:'SIMULATED'};}},ledger:{history:async()=>[],pendingForActor:async()=>[{id:'1234567890abcdef'}]},overview:async q=>{reads++;return {...report,query:q};}};
 const repository={summary:async()=>({orders:{pending:2,last_sync_at:at},incidents:{pending:5,responded:3,blocked:2,last_sync_at:at},connectors:[{connector:'DROPEA',last_success_at:at,checked_at:at,freshness_status:'FRESH'}]}),orderDetail:async id=>({order:{dropea_order_id:id,status:'PENDING',source_updated_at:at,phone:'DO_NOT_LEAK',address:'DO_NOT_LEAK',customer_text:'DO_NOT_LEAK'}})};
 const finance=async()=>({period:{month:'2026-10'},generatedAt:at,totals:{realRevenue:500,exactNetProfit:null,metaSpend:50},quality:{status:'REVIEW'},customer_text:'DO_NOT_LEAK'});
 const c=new CommandCenter({ads,repository,readFinance:finance,ledger,now:()=>now,...options});
 const request=(text,user='1',key=String(history.length+1))=>c.command({action:'request',text,actor:{user,chat:user},requestKey:key});
 return {c,request,ads,repository,ledger,history,context,report,setNow:n=>now=n,get reads(){return reads;},get proposals(){return proposals;},get confirmations(){return confirmations;}};
}

test('report snapshot excludes private proposals, scopes audit by actor and includes prior period without claiming equal elapsed time',async()=>{
 const f=fixture({orderReader:{get:async spec=>({received:3,period:spec})}});
 let auditArgs;f.ads.ledger.reportHistory=async(...args)=>{auditArgs=args;return [];};
 const original=f.ads.overview;f.ads.overview=async q=>({...await original(q),proposals:[{request:'DO_NOT_LEAK'}]});
 const r=await f.request('Dame el informe de hoy en PDF');
 assert.equal(r.format,'pdf');assert.equal(r.report.orders.received,3);assert.equal(r.report.previousOrders.period.from,'2026-10-20');
 assert.equal(auditArgs[0],'1');assert.match(r.report.comparisonNote,/completo/);assert.ok(!JSON.stringify(r).includes('DO_NOT_LEAK'));
 await assert.rejects(f.c.command({action:'daily-report',actor:{user:'2',chat:'1'}}),/ACTOR_UNAUTHORIZED/);
});

test('prepare button never confirms and rejects oversized or unbound changes',async()=>{
 const f=fixture(),base={action:'prepare-budget',actor:{user:'1',chat:'1'},campaignId:'123',direction:'increase',percent:10,requestKey:'telegram:prepare:0123456789abcdef'};
 await f.c.command(base);assert.equal(f.proposals,1);assert.equal(f.confirmations,0);
 for(const changes of [{percent:11},{requestKey:'unsafe'},{campaignId:'ambiguous'}])await assert.rejects(f.c.command({...base,...changes}),/QUERY_INVALID/);
});

for(const [text,tool] of [['¿Cómo va Suleia hoy?','executive'],['¿Qué está fallando?','executive'],['¿Por qué tenemos pocas ventas?','executive'],['Analiza todas las campañas','ads'],['¿Qué producto deja más beneficio?','finance'],['¿Qué incidencias necesitan atención?','incidents'],['Consulta pedido ES1234567','orders'],['Consulta pedido #3136','orders'],['Salud de servicios','health'],['Consulta Trendtrack','commercial'],['¿Cuál es el peor anuncio?','ads'],['¿Cómo va NIDA?','ads']])test('Spanish tool routing: '+text,()=>assert.equal(parseBusiness(text).tool,tool));

test('context is per actor, expires and only supports read follow-ups',async()=>{
 const f=fixture();await f.request('Analiza NIDA');let r=await f.request('¿Y ayer?');assert.equal(r.analysis.query.selector,'nida');assert.equal(r.analysis.query.period,'ayer');
 assert.match((await f.request('¿Y ayer?','2')).text,/contexto/);assert.equal(f.context.size,1);
 f.setNow(clock+CONTEXT_TTL_MS+1);assert.match((await f.request('¿Y ayer?')).text,/contexto/);
 assert.equal(parseBusiness('Sube 10 €',f.context.get('1')?.body).tool,'delegate');
 assert.equal(f.proposals,0);
});
test('ambiguous weeks and multiple order IDs request clarification',()=>{
 assert.equal(parseBusiness('¿Y respecto a la semana pasada?').tool,'clarify');
 for(const t of ['Consulta el pedido','Pedidos 3136 y 3137'])assert.equal(parseBusiness(t).tool,'clarify');
});
test('all authorization runs before any business reads',async()=>{
 const f=fixture();for(const actor of [{user:'3',chat:'3'},{user:'1',chat:'2'}])await assert.rejects(f.c.command({action:'request',actor,text:'Analiza NIDA',requestKey:'x'}),/ACTOR_UNAUTHORIZED/);
 assert.equal(f.reads,0);assert.equal(f.history.length,0);
});
test('roles restrict the existing allowlist, never add principals',async()=>{
 const f=fixture({roles:{'1':'operator','2':'analyst','3':'admin'}});
 assert.match((await f.request('Consulta incidencias')).text,/Pendientes: 5/);
 await assert.rejects(f.request('Analiza NIDA'),/ACTOR_UNAUTHORIZED/);
 await assert.rejects(f.request('Consulta incidencias','2'),/ACTOR_UNAUTHORIZED/);
 await assert.rejects(f.request('Analiza NIDA','3'),/ACTOR_UNAUTHORIZED/);
 assert.equal((await f.request('Analiza NIDA','2')).analysis.version,3);
});
test('analyst may propose but cannot confirm or reconcile, including natural yes',async()=>{
 const f=fixture({roles:{'1':'analyst'}});
 await f.request('Sube 5 € a NIDA');assert.equal(f.proposals,1);
 for(const t of ['Sí, hazlo','Confirmo','No, cancela'])await assert.rejects(f.request(t),/ACTOR_UNAUTHORIZED/);
 await assert.rejects(f.c.command({action:'reconcile',id:'1234567890abcdef',actor:{user:'1',chat:'1'}}),/ACTOR_UNAUTHORIZED/);assert.equal(f.confirmations,0);
});
test('budget proposals reuse only the existing executor and never infer target or period',async()=>{
 const f=fixture();await f.request('Analiza NIDA');await f.request('Prepara un aumento de 10 € en las campañas con ROAS superior a 5 hoy');
 assert.equal(f.proposals,1);assert.equal(f.confirmations,0);
 const r=await f.request('Sí, hazlo');assert.equal(r.proposal.state,'SIMULATED');assert.equal(f.confirmations,1);
});
test('missing revenue or profit is not converted to zero or product profitability',async()=>{
 const f=fixture();const r=await f.request('¿Qué producto deja más beneficio?');assert.match(r.text,/no disponible/);assert.match(r.text,/No hay atribución completa/);
 const data=f.history.at(-1).evidence;assert.equal(data.totals.netProfit,null);assert.equal(data.totals.advertising,50);assert.equal(data.month,'2026-10');assert.equal(data.cashSettlementVerified,false);
});
test('order tools and memory whitelist fields instead of forwarding personal data',async()=>{
 const f=fixture();const r=await f.request('Consulta pedido ES1234567');assert.match(r.text,/ES1234567/);
 assert.ok(!JSON.stringify([r,f.history]).includes('DO_NOT_LEAK'));
});
test('not found order is not proof of absence in Shopify',async()=>{
 const f=fixture();f.repository.orderDetail=async()=>null;assert.match((await f.request('Consulta pedido ES1234567')).text,/No significa que no exista/);
});
test('stale and unknown source clocks are exposed; fresh checks cannot hide stale last success',async()=>{
 assert.equal(freshness(null,clock),'UNKNOWN');assert.equal(freshness(at,clock),'FRESH');assert.equal(freshness(at,clock+16*60_000),'STALE');assert.equal(freshness('invalid',clock),'UNKNOWN');
 const f=fixture();f.repository.summary=async()=>({connectors:[{connector:'CHATBY',checked_at:at,last_success_at:'2026-10-19T00:00:00Z',freshness_status:'STALE'}]});
 assert.match((await f.request('Salud de servicios')).text,/STALE/);
});
test('executive brief degrades partial sources without inventing figures or sending alerts',async()=>{
 const f=fixture();f.ads.overview=async()=>{throw Error('provider error with private payload');};
 const r=await f.request('¿Cómo va Suleia hoy?');assert.equal(r.executive.ads,null);assert.equal(r.executive.priorities[0].code,'SOURCE_UNAVAILABLE');assert.equal(r.executive.notificationsEnabled,false);assert.ok(!r.text.includes('private payload'));assert.ok(!r.text.includes('DO_NOT_LEAK'));
 assert.equal(f.proposals,0);assert.equal(f.confirmations,0);
});
test('repeated brief with same provider update records once; alerts consolidate by cause and entity',async()=>{
 const f=fixture();await f.request('Informe ejecutivo','1','update:1');await f.request('Informe ejecutivo','1','update:1');assert.equal(f.history.length,1);
 const a={source:'META',entity:'3',code:'LOW_CTR',priority:3};assert.equal(consolidateAlerts([a,a,{...a,entity:'4'}]).length,2);
});
test('Trendtrack remains unavailable and consumes no credits without a verified runtime connection',async()=>{
 const f=fixture();assert.match((await f.request('Consulta Trendtrack')).text,/No se consultaron datos ni se consumieron créditos/);assert.equal((await f.c.status()).trendtrack.creditsConsumed,0);
});
test('decision memory is actor-scoped, idempotent and cannot authorize execution',async()=>{
 const f=fixture();await f.request('Analiza NIDA');const id=f.history[0].id;
 assert.match((await f.request('Registra decisión observar '+id,'2')).text,/no pertenece/);
 assert.match((await f.request('Registra decisión observar '+id)).text,/no confirma ni ejecuta/);
 assert.equal(f.history.at(-1).kind,'DECISION');assert.equal(f.confirmations,0);
 assert.match((await f.request('Mis decisiones')).text,/DECISION/);assert.match((await f.request('Mis decisiones','2')).text,/No hay decisiones/);
});
test('same cached Ads report metrics flow to Telegram without aggregation at another hierarchy',async()=>{
 const f=fixture();const r=await f.request('Analiza todas las campañas');assert.deepEqual(r.analysis.totals,f.report.totals);assert.equal(r.analysis.observedAt,f.report.observedAt);
});
test('bounded inputs reject invalid dates and oversized messages',async()=>{
 const f=fixture();await assert.rejects(f.request('a'.repeat(1001)),/QUERY_INVALID/);
 await assert.rejects(f.c.finance('2026-13'),/QUERY_INVALID/);await assert.rejects(f.c.finance('2027-01'),/QUERY_INVALID/);
});

test('finance freshness is visible and stale reports become executive priorities',async()=>{
 const f=fixture({readFinance:async()=>({period:{month:'2026-10'},generatedAt:'2026-10-19T10:00:00Z',totals:{exactNetProfit:10}})});
 assert.match((await f.request('Consulta finanzas')).text,/STALE/);
 const r=await f.request('Informe ejecutivo');assert.ok(r.executive.priorities.some(a=>a.source==='FINANCE'&&a.code==='STALE'));
});
