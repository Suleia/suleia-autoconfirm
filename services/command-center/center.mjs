import {adsCommand} from '../meta-ads/command-service.mjs';
import {parseMetaSummary,readMetaSummary} from './meta-summary.mjs';
import {parseIncidentPeriod,readIncidentSummary,formatIncidentSummary} from './incident-summary.mjs';
import {OrderAlerts,orderAlertIntent} from './order-alerts.mjs';
import {parseAutopilotQuery} from '../meta-ads/autopilot/queries.mjs';
import {orderSummaryIntent,OrderSummaryReader,readOrderSummary} from './order-summary.mjs';
import {parseOrderRequest,parsePeriodText,resolvePeriod} from './periods.mjs';

const clean=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[¿?¡!]/g,'').replace(/\s+/g,' ').trim();
const label=s=>String(s||'').replace(/[\r\n\u0000-\u001f]/g,' ').slice(0,100);
const number=n=>n!==null&&n!==undefined&&Number.isFinite(Number(n))?Number(n):null;
const iso=t=>Number.isFinite(Date.parse(t))?new Date(t).toISOString():null;
const money=n=>number(n)===null?'no disponible':new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(Number(n));
export const CONTEXT_TTL_MS=15*60_000;
const permissions={admin:['ads','orders','incidents','finance','health','commercial','history','propose','confirm'],analyst:['ads','finance','commercial','health','history','propose'],operator:['orders','incidents','health']};

export function freshness(observedAt,now=Date.now(),maxAge=15*60_000) {
 const at=Date.parse(observedAt),age=now-at;
 return !Number.isFinite(at)||age< -60_000?'UNKNOWN':age>maxAge?'STALE':'FRESH';
}
export function consolidateAlerts(alerts) {
 const merged=new Map();
 for(const a of alerts){const key=`${a.source}:${a.entity||'ACCOUNT'}:${a.code}`;if(!merged.has(key))merged.set(key,{...a,key});}
 return [...merged.values()].sort((a,b)=>a.priority-b.priority).slice(0,10);
}
export function parseBusiness(input,context=null,now=Date.now()) {
 const text=clean(input),period=/\bayer\b/.test(text)?'ayer':/\bhoy\b/.test(text)?'hoy':/ultimos (?:7|siete) dias/.test(text)?'7d':/ultimos (?:30|treinta) dias/.test(text)?'30d':null;
 if(/^(?:y )?(?:ayer|hoy|respecto a ayer|que solucion propones)$/.test(text))return context?.tool==='ads'?{tool:'ads',selector:context.selector,period:period||context.period,level:context.level,followup:true}:{tool:'clarify',question:'Indica qué campaña quieres revisar; no hay un contexto publicitario vigente.'};
 if(/semana pasada/.test(text))return {tool:'clarify',question:'¿Quieres los últimos 7 días completos o la semana natural anterior?'};
 const proposal=/^prepara un (aumento|descenso) de (.+)$/.exec(text);
 if(proposal)return {tool:'proposal',text:`${proposal[1]==='aumento'?'Sube':'Baja'} ${proposal[2].replace(/ en (?:las|todas las) campanas/,' a todas las campanas')}`};
 // No implicit mutations: existing executor parses every complete new proposal.
 if(/\b(sube|aumenta|baja|reduce|pon|fija|establece|pausa|apaga|confirma|confirmo|cancela|hazlo)\b/.test(text)||/^\//.test(text))return {tool:'delegate'};
 if(/historial de decisiones|mis decisiones/.test(text))return {tool:'history'};
 if(/^registra (?:la )?decision (aceptar|rechazar|observar) ([a-f0-9]{64})$/.test(text)){const m=text.match(/(aceptar|rechazar|observar) ([a-f0-9]{64})$/);return {tool:'decision',verdict:m[1],reference:m[2]};}
 if(/trendtrack|competencia|competidor/.test(text))return {tool:'commercial'};
 if(/incidencias?/.test(text)){const request=parseIncidentPeriod(input,now);return request?.question?{tool:'clarify',question:request.question}:{tool:'incidents',...(request||{})};}
 const orderRequest=parseOrderRequest(input,now);if(orderRequest)return orderRequest.question?{tool:'clarify',question:orderRequest.question}:{tool:'orders',summary:orderRequest.view,period:orderRequest.period};
 if(/pedido/.test(text)){const ids=[...text.matchAll(/#?\b(?:ES)?\d{3,12}\b/gi)];return ids.length===1?{tool:'orders',id:ids[0][0].replace(/^#/,'').toUpperCase()}:{tool:'clarify',question:'Indica un único ID exacto de Dropea (por ejemplo ES1234567). La cola no contiene todos los pedidos de Shopify.'};}
 if(/beneficio|rentabilidad|finanzas|resultado financiero/.test(text))return {tool:'finance',product:/producto|nida|collagum|seoul/.test(text),month:/\b(20\d{2}-\d{2})\b/.exec(text)?.[1]||null};
 if(/salud|servicios|conexiones|fuentes/.test(text))return {tool:'health'};
 if(/como va suleia|que esta fallando|pocas ventas|informe ejecutivo|resumen diario|tres prioridades|que ha cambiado desde ayer/.test(text))return {tool:'executive',period:period||'hoy'};
 if(/analiza|campana|anuncio|como va |ctr|cpc|cpm|roas|carrito|checkout|publicidad|conversion|clic|funcionando mejor|perdiendo dinero/.test(text)){
   const selector=/^(?:analiza|como va) (?:la campana )?(.+?)(?: hoy| ayer| de los ultimos|$)/.exec(text)?.[1];
   return {tool:'ads',period:period||'hoy',level:/anuncio/.test(text)?'ad':'campaign',selector:selector&&!/^(?:todas|todas las campanas|las campanas|suleia)$/.test(selector)?selector:null,focus:/campana.*peor.*roas|peor.*roas.*campana/.test(text)?'worst':/campana.*funcionando mejor|cual esta funcionando mejor/.test(text)?'best':/anuncios.*vendiendo/.test(text)?'sales':/peor|mal|mejorar/.test(text)?'improve':/mejor|conviert/.test(text)?'top':/donde|carrito|checkout/.test(text)?'funnel':'diagnosis',original:input,compare:/compara.*hoy.*ayer/.test(text),includeInactive:/inactivas|pausadas/.test(text)};
 }
 return {tool:'clarify',question:'Puedo consultar campañas, pedidos por ID, incidencias, finanzas y salud. Indica qué necesitas; los cambios requieren una propuesta concreta.'};
}

// All tools are bounded reads over the already-authorized application services.
// Source payloads, customer text, secrets, phone/address fields never enter responses or memory.
export class CommandCenter {
 constructor({ads,repository,readFinance,ledger,roles={},now=()=>Date.now(),orderReader=null}) {
   Object.assign(this,{ads,repository,readFinance,ledger,roles,now});this.inflight=new Map();
   this.orderAlerts=new OrderAlerts({readPool:repository.pool,writePool:ledger.pool,now});
   this.orderReader=orderReader||new OrderSummaryReader({read:(n,spec)=>readOrderSummary(repository.pool,n,spec),now});
 }
 authorize(actor,capability) {
   this.ads.engine.authorize(actor); // Existing numeric allowlist + private actor binding remains authoritative.
   const role=this.roles[actor.user]||'admin';
   if(!permissions[role]?.includes(capability))throw Error('ACTOR_UNAUTHORIZED');
   return role;
 }
 async read(key,fn) {
   if(!this.inflight.has(key)){const p=Promise.resolve().then(fn).finally(()=>this.inflight.delete(key));this.inflight.set(key,p);}
   return this.inflight.get(key);
 }
 async health() {
   const s=await this.read('summary',()=>this.repository.summary(new URLSearchParams()));
   return {orders:{pending:number(s.orders?.pending),responded:number(s.orders?.with_customer_response),observedAt:iso(s.orders?.last_sync_at)},incidents:{pending:number(s.incidents?.pending),responded:number(s.incidents?.responded),blocked:number(s.incidents?.blocked),observedAt:iso(s.incidents?.last_sync_at)},sources:(s.connectors||[]).map(c=>({source:label(c.connector),observedAt:iso(c.last_success_at),status:c.freshness_status&&c.freshness_status!=='FRESH'?label(c.freshness_status):freshness(c.last_success_at,this.now()),reportedStatus:label(c.data_health)}))};
 }
 async finance(month) {
   if(month&&(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)||month>new Date(this.now()).toISOString().slice(0,7)))throw Error('QUERY_INVALID');
   const f=await this.read('finance:'+(month||'current'),()=>this.readFinance(new URLSearchParams(month?{month}:{})));
   return {month:f.period?.month||f.month||month,observedAt:iso(f.generated_at||f.generatedAt),freshness:freshness(f.freshness?.sources?.report?.lastSyncAt||f.generatedAt,this.now()),totals:f.totals?{revenue:number(f.totals.realRevenue),netProfit:number(f.totals.exactNetProfit),advertising:number(f.totals.metaSpend)}:null,coverage:label(f.quality?.status||f.coverage?.status||f.status||'UNKNOWN'),cashSettlementVerified:false,productAttribution:'UNVERIFIED',limitations:['Beneficio contable del informe existente; entrega no acredita liquidación bancaria.','No se asigna el beneficio global a productos o campañas sin costes y atribución completos.']};
 }
 async command(body) {
   const actor={user:String(body.actor?.user||''),chat:String(body.actor?.chat||'')};
   this.ads.engine.authorize(actor);
   const alertIntent=body.action==='request'?orderAlertIntent(body.text):null;
   if(body.action==='order-alerts'||alertIntent){
     this.authorize(actor,'orders');
     if(body.action==='request'&&(typeof body.text!=='string'||body.text.length>1000||typeof body.requestKey!=='string'||body.requestKey.length>180))throw Error('QUERY_INVALID');
     return {orderAlert:await this.orderAlerts.command(actor.user,alertIntent?{operation:alertIntent}:body)};
   }
   const summaryIntent=body.action==='request'?parseMetaSummary(body.text,this.now()):null;
   if(body.action==='meta-summary'||summaryIntent){
     this.authorize(actor,'ads');
     if(body.action==='request'&&(typeof body.text!=='string'||body.text.length>1000||typeof body.requestKey!=='string'||body.requestKey.length>180))throw Error('QUERY_INVALID');
     if(summaryIntent?.question)return {text:summaryIntent.question};
     const metaSummary=await readMetaSummary(this.ads,summaryIntent||body.query||{},this.now());
     if(body.requestKey)await this.remember(actor,body,'QUERY',{tool:'ads',version:'compact-summary',range:metaSummary.range,observedAt:metaSummary.observedAt});
     return {metaSummary};
   }
   if(body.action==='review'||(body.action==='request'&&this.ads.review?.parse(body.text))){
     this.authorize(actor,'ads');
     if(body.action==='request'&&(typeof body.text!=='string'||body.text.length>1000||typeof body.requestKey!=='string'||body.requestKey.length>180))throw Error('QUERY_INVALID');
     const result=await adsCommand(this.ads,body),intent=this.ads.review?.parse(body.text||'Auditoría de campañas');
     if(result.review&&intent){
       await this.ledger.saveContext(actor.user,{tool:'ads',review:'v6',period:intent.period,selector:intent.selector,level:intent.level},this.now()+CONTEXT_TTL_MS);
       if(body.requestKey)await this.remember(actor,body,'QUERY',{tool:'ads',version:'v6',period:intent.period,observedAt:result.review.observedAt,evidenceDigest:result.review.evidenceDigest});
     }
     return result;
   }
   if(body.action==='autopilot'||(body.action==='request'&&parseAutopilotQuery(body.text))){this.authorize(actor,'ads');return adsCommand(this.ads,body);}
   if(body.action==='prepare-budget'){
     this.authorize(actor,'propose');
     if(this.ads.autopilot?.config.enabled)return {text:'La política vigente es V5.1, con importes absolutos. Solicita «Sube 10 € a la campaña ID» o «Baja 10 € a la campaña ID». Se preparará una propuesta nueva con los límites actuales.'};
     if(!/^\d+$/.test(body.campaignId||'')||!['increase','decrease'].includes(body.direction)||!Number.isFinite(body.percent)||body.percent<=0||body.percent>this.ads.engine.policy.maxChangePercent||!/^telegram:prepare:[a-f0-9]{16}$/.test(body.requestKey||''))throw Error('QUERY_INVALID');
     return adsCommand(this.ads,{action:'request',actor,requestKey:body.requestKey,text:`${body.direction==='increase'?'Sube':'Baja'} ${body.percent} % el presupuesto de ${body.campaignId} con ROAS ${body.direction==='increase'?'superior a 10':'inferior a 3'} hoy`});
   }
   if(body.action==='daily-report'||(body.action==='request'&&/\b(?:informe|pdf|imagen del resumen)\b/.test(clean(body.text))&&!/informe ejecutivo|informe matinal/.test(clean(body.text)))) {
     this.authorize(actor,'orders');this.authorize(actor,'ads');
     const spec=body.period||parsePeriodText(body.text,this.now());if(spec.question)return {text:spec.question};
     const period=resolvePeriod(spec,this.now());
     const days=Math.round((Date.parse(period.to)-Date.parse(period.from))/86400000)+1;
     const shift=(day,n)=>new Date(Date.parse(day+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
     const previous={preset:'custom',from:shift(period.from,-days),to:shift(period.from,-1)};
     const results=await Promise.allSettled([this.orderReader.get(spec),this.ads.overview({since:period.from,until:period.to,level:'campaign'}),this.ads.ledger.reportHistory(actor.user,period.start,period.end),this.orderReader.get(previous)]);
     const value=i=>results[i].status==='fulfilled'?results[i].value:null;
     const proposals=(value(2)||[]).filter(p=>p.actor?.user===actor.user);
     const changes=proposals.flatMap(p=>p.items.filter(i=>i.result&&['VERIFIED','RECONCILED'].includes(i.result.state)&&i.result.verifiedAt>=Date.parse(period.start)&&i.result.verifiedAt<Date.parse(period.end)).map(i=>({campaign:i.name,before:i.before,after:i.after,at:i.result.verifiedAt,state:i.result.state})));
     const meta=value(1);const safeMeta=meta?{totals:meta.totals,facts:meta.facts,actions:meta.actions,observedAt:meta.observedAt,cache:meta.cache}:null;
     return {report:{period,generatedAt:new Date(this.now()).toISOString(),orders:value(0),previousOrders:value(3),comparisonNote:'Periodo anterior completo; el periodo actual puede estar en curso. No equivale a comparar el mismo tramo horario.',meta:safeMeta,changes,pending:proposals.filter(p=>p.state==='PENDING'&&p.expiresAt>this.now()).map(p=>({id:p.id,expiresAt:p.expiresAt,count:p.items.length})),errors:results.map((r,i)=>r.status==='rejected'?['DROPEA','META','HISTORY','PREVIOUS_DROPEA'][i]:null).filter(Boolean)},format:body.format==='image'||/imagen/.test(clean(body.text))?'image':'pdf'};
   }
   if(body.action==='orders-summary') {this.authorize(actor,'orders');return {orders:await this.orderReader.get(body.period),view:['today','confirmations','hour','products','periods'].includes(body.view)?body.view:'today',metric:['received','confirmed','units'].includes(body.metric)?body.metric:'confirmed'};}
   if(body.action==='analyze') {this.authorize(actor,'ads');return {analysis:await this.ads.overview(body.query),view:body.view,focus:body.focus,includeInactive:body.includeInactive===true};}
   if(body.action!=='request'){
     this.authorize(actor,['confirm','cancel','reconcile'].includes(body.action)?'confirm':body.action==='history'?'history':'ads');
     return adsCommand(this.ads,body);
   }
   if(typeof body.text!=='string'||body.text.length>1000||typeof body.requestKey!=='string'||body.requestKey.length>180)throw Error('QUERY_INVALID');
   const context=await this.ledger.context(actor.user,this.now()),intent=parseBusiness(body.text,context,this.now());
   if(/muestrame la propuesta|ver propuesta/.test(clean(body.text))){this.authorize(actor,'propose');const pending=await this.ads.ledger.pendingForActor(actor.user);return pending.length===1?{proposal:pending[0]}:{text:'No hay una única propuesta pendiente. Indica la campaña y el cambio.'};}
   if(/propon aumentar|que campanas escalarias|cuales reducirias/.test(clean(body.text))){this.authorize(actor,'ads');return {analysis:await this.ads.overview({period:'hoy',level:'campaign'}),focus:'budget'};}
   if(intent.tool==='clarify')return {text:intent.question};
   if(intent.tool==='proposal'){
     this.authorize(actor,'propose');
     return adsCommand(this.ads,{...body,text:intent.text});
   }
   if(intent.tool==='delegate'){
     const mutation=/sube|aumenta|baja|reduce|pon|fija|establece|pausa|apaga|presupuesto/i.test(body.text);
     const confirmation=/confirm|cancel|reconcil|hazlo|^si[, ]/i.test(body.text);
     this.authorize(actor,confirmation?'confirm':mutation?'propose':'ads');
     if(/\b(?:esta|esa) campana\b/.test(clean(body.text))){if(context?.tool!=='ads'||!context.selector)return {text:'Indica la campaña exacta: no hay un contexto de campaña vigente.'};return adsCommand(this.ads,{...body,text:body.text.replace(/\b(?:esta|esa) campa[ñn]a\b/gi,context.selector)});}
     return adsCommand(this.ads,body); // No second executor, proposal store, or inferred amount/target.
   }
   this.authorize(actor,intent.tool==='executive'?'ads':intent.tool==='decision'?'history':intent.tool);
   if(intent.tool==='ads'){
     let result;
     if(intent.followup&&context?.review==='v6'&&this.ads.review){
       result=await this.ads.review.answer('Auditoría de campañas',{period:intent.period,level:intent.level,selector:intent.selector});
       await this.ledger.saveContext(actor.user,{...context,period:intent.period},this.now()+CONTEXT_TTL_MS);
       await this.remember(actor,body,'QUERY',{tool:'ads',version:'v6',observedAt:result.review?.observedAt||null,evidenceDigest:result.review?.evidenceDigest||null});
       return result;
     }
     if(/algoritmo|bloques|ultima subida/i.test(body.text)&&!intent.followup)result=await adsCommand(this.ads,body);
     else result={analysis:await this.ads.overview({period:intent.compare?'hoy':intent.period,level:intent.level,selector:intent.selector}),focus:intent.focus,selector:intent.selector};
     await this.ledger.saveContext(actor.user,{tool:'ads',period:intent.period,selector:intent.selector,level:intent.level},this.now()+CONTEXT_TTL_MS);
     await this.remember(actor,body,'QUERY',{tool:'ads',period:intent.period,selector:intent.selector,observedAt:result.analysis?.observedAt||null});
     if(intent.compare)result.previousDay=await this.ads.overview({period:'ayer',level:intent.level,selector:intent.selector});
     return {...result,includeInactive:intent.includeInactive};
   }
   if(intent.tool==='history')return {text:(await this.ledger.history(actor.user)).map(d=>`${d.id} · ${d.kind} · ${d.body.observedAt}`).join('\n')||'No hay decisiones registradas para tu cuenta.'};
   if(intent.tool==='decision'){
     const own=await this.ledger.history(actor.user);
     if(!own.some(d=>d.id===intent.reference))return {text:'La referencia no pertenece a tu historial reciente. No se ha registrado ninguna decisión.'};
     await this.remember(actor,body,'DECISION',{reference:intent.reference,verdict:intent.verdict});
     return {text:'Decisión registrada para revisión. Este registro no confirma ni ejecuta una operación.'};
   }
   if(intent.tool==='commercial')return {text:'Trendtrack no está conectado al entorno del servidor. No se consultaron datos ni se consumieron créditos. La conexión de ChatGPT no concede acceso a este bot.'};
   let evidence,text;
   if(intent.tool==='orders'){
     if(intent.summary)return {orders:await this.orderReader.get(intent.period),view:intent.summary};
     const found=await this.repository.orderDetail(intent.id),o=found?.order;
     evidence=o?{id:label(o.dropea_order_id||o.canonical_order_id),state:label(o.lifecycle_status||o.status),observedAt:iso(o.source_updated_at),freshness:freshness(o.source_updated_at,this.now())}:null;
     text=evidence?`Pedido ${evidence.id}: ${evidence.state}. Fuente: copia operativa Dropea · ${evidence.observedAt||'fecha no verificable'} · ${evidence.freshness}.`:'Pedido no encontrado por ID exacto en la copia operativa. No significa que no exista en Shopify.';
   }else if(intent.tool==='incidents'&&intent.period){
     evidence=await this.read('incidents:'+JSON.stringify(intent.period),()=>readIncidentSummary(this.repository.pool,intent.period,this.now()));
     text=formatIncidentSummary(evidence);
   }else if(intent.tool==='finance'){
     evidence=await this.finance(intent.month);
     text=`Finanzas · ${evidence.month||'mes actual'}\nBeneficio contable: ${money(evidence.totals?.netProfit)}\nCobertura: ${evidence.coverage}. Fuente: informe financiero del panel.\nActualización: ${evidence.observedAt||'sin fecha verificable'} · ${evidence.freshness}.\n${evidence.limitations.join('\n')}${intent.product?'\nNo hay atribución completa para ordenar productos por beneficio.':''}`;
   }else if(intent.tool==='executive'){
     for(const c of ['finance','health','incidents'])this.authorize(actor,c);
     const results=await Promise.allSettled([this.ads.overview({period:intent.period}),this.health(),this.finance(null)]);
     const [ads,ops,finance]=results.map(r=>r.status==='fulfilled'?r.value:null);
     const alerts=[];
     results.forEach((r,i)=>{if(r.status==='rejected')alerts.push({source:['META','OPERATIONS','FINANCE'][i],code:'SOURCE_UNAVAILABLE',priority:1,evidence:'Fuente no disponible en esta consulta.',action:'Restablecer la lectura antes de tomar decisiones.'});});
     for(const s of ops?.sources||[])if(s.status!=='FRESH')alerts.push({source:s.source,code:s.status,priority:1,evidence:`Última lectura: ${s.observedAt||'sin fecha'}`,action:'Revisar la sincronización; no actuar con esta copia.'});
     if(finance&&finance.freshness!=='FRESH')alerts.push({source:'FINANCE',code:finance.freshness,priority:1,evidence:`Informe financiero: ${finance.observedAt||'sin fecha'}`,action:'Actualizar la fuente antes de valorar beneficios.'});
     if(number(ops?.incidents?.blocked)>0)alerts.push({source:'OPERATIONS',code:'BLOCKED_INCIDENTS',priority:2,evidence:`${ops.incidents.blocked} incidencias bloqueadas en la copia.`,action:'Revisar los motivos visibles en Incidencias.'});
     for(const a of ads?.actions||[])alerts.push({source:'META',entity:a.entityId,code:a.code||a.id,priority:a.priority||3,evidence:label(a.evidenceText),action:label(a.action)});
     const consolidated=consolidateAlerts(alerts);
     evidence={period:intent.period,observedAt:new Date(this.now()).toISOString(),ads:ads?{totals:ads.totals,observedAt:ads.observedAt,contract:ads.contract}:null,operations:ops,finance,priorities:consolidated.slice(0,3),alerts:consolidated,notificationsEnabled:false};
     text=`Suleia · ${intent.period} · Europe/Madrid\nMeta: gasto ${money(ads?.totals?.spend)} · compras ${ads?.totals?.purchases??'N/D'} · ROAS ${ads?.totals?.roas??'N/D'}\n${evidence.priorities.map((a,i)=>`${i+1}. ${a.evidence}\n${a.action}`).join('\n')||'No hay tres prioridades respaldadas por evidencia suficiente.'}\nFinanzas: periodo mensual ${finance?.month||'no disponible'}, beneficio contable ${money(finance?.totals?.netProfit)}.\nROAS no equivale a beneficio. Las fuentes usan periodos y relojes distintos; no se suman como ventas. Modo presupuestos: ${this.ads.engine.mode}; cada cambio requiere confirmación.`;
   }else {
     evidence=await this.health();
     text=intent.tool==='incidents'?`Incidencias · copia operativa Dropea\nPendientes: ${evidence.incidents.pending??'N/D'} · con respuesta: ${evidence.incidents.responded??'N/D'} · bloqueadas: ${evidence.incidents.blocked??'N/D'}\nActualización: ${evidence.incidents.observedAt||'no verificable'} · ${freshness(evidence.incidents.observedAt,this.now())}.\nLas acciones corresponden al trabajador de incidencias existente; esta consulta no confirma soluciones ni entregas.`:evidence.sources.map(s=>`${s.source}: ${s.status} · ${s.observedAt||'sin fecha'}`).join('\n')||'No hay fuentes verificables.';
   }
   await this.remember(actor,body,intent.tool==='executive'?'EXECUTIVE_BRIEF':'QUERY',{tool:intent.tool,...evidence});
   return {text,executive:intent.tool==='executive'?evidence:undefined};
 }
 remember(actor,body,kind,evidence) {
   return this.ledger.remember({actor:actor.user,key:body.requestKey,kind,evidence,at:this.now()});
 }
 async status() {
   const [latest,proposals,health]=await Promise.all([this.ledger.latest(),this.ads.ledger.history(),this.health().catch(()=>null)]);
   return {version:2,mode:this.ads.engine.mode,metaWritesEnabled:false,languageModel:'NONE',notificationsEnabled:false,trendtrack:{connected:false,creditsConsumed:0},tools:['ads','orders','incidents','finance','health','history'],connections:health?.sources||[],sourceErrors:health?[]:['OPERATIONS_UNAVAILABLE'],latestBrief:latest?.body?.evidence||null,proposals:proposals.map(p=>({id:p.id,state:p.state,mode:p.mode,expiresAt:p.expiresAt})),limits:{maxBudgetCents:this.ads.engine.policy.maxBudgetCents,maxChangePercent:this.ads.engine.policy.maxChangePercent}};
 }
}
