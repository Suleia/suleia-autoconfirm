import {businessDayBounds} from '../../packages/platform-core/src/business-day.mjs';
import {resolvePeriod,parseOrderRequest} from './periods.mjs';

export function orderSummaryIntent(text) {
  const parsed=parseOrderRequest(text);if(parsed&&!parsed.question)return parsed.view;
  const t=String(text).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if(/cuantos han entrado.*ultima hora/.test(t))return 'hour';
  if (/\b(?:pedido|pedidos|confirmados|confirmaciones|pendientes|ventas)\b/.test(t) && !/\b(?:ES)?\d{3,12}\b/i.test(t)) {
    if (/confirmaciones realizadas|hemos confirmado|confirmado hoy/.test(t)) return 'confirmations';
    if (/ultima hora/.test(t)) return 'hour';
    if (/cuantos|como vamos|actualizame las ventas|pedidos de hoy/.test(t)) return 'today';
  }
  return null;
}

export function summarizeOrders(rows,now,period=resolvePeriod({preset:'today'},now)) {
  const start=Date.parse(period.start),end=Date.parse(period.end);
  const inside=value=>{const t=Date.parse(value);return t>=start&&t<end;};
  const map=new Map();let identityComplete=true;
  for(const r of rows) {
    if(!r.market||!r.store_id||!r.dropea_order_id){identityComplete=false;continue;}
    const key=JSON.stringify([r.market,r.store_id,r.dropea_order_id]),old=map.get(key);
    if(!old||Date.parse(r.observed_at)>Date.parse(old.observed_at))map.set(key,r);
  }
  const out={received:0,confirmed:0,cancelled:0,pending:0,confirmations:0,last_hour:0,identityComplete};
  const observed=[],source=[],products=new Map();let productCoverage=true;
  for(const r of map.values()) {
    const cohort=inside(r.created_at_utc),confirmed=Number.isFinite(Date.parse(r.confirmed_at_utc));
    if(cohort) {
      out.received++;
      if(r.cancelled_at_utc||r.lifecycle_status==='CANCELLED'||r.status==='CANCELLED')out.cancelled++;
      else if(confirmed)out.confirmed++;
      else if((r.lifecycle_status||r.status)==='PENDING')out.pending++;
      const lines=r.product_summary?.products||[];
      if(!lines.length)productCoverage=false;
      const seen=new Set();
      for(const line of lines.length?lines:[{name:'Producto sin identificar',quantity:null}]) {
        const identity=line.product_id?`product:${line.product_id}`:line.sku?`sku:${line.sku}`:line.variant_id?`variant:${line.variant_id}`:'unknown';
        const key=JSON.stringify([r.market,r.store_id,identity]);
        if(identity==='unknown')productCoverage=false;
        const p=products.get(key)||{key,name:identity==='unknown'?'Producto sin identificar':String(line.name||line.product_name||'Producto sin nombre').slice(0,120),received:0,confirmed:0,units:0,unitsComplete:true};
        if(!seen.has(key)){p.received++;if(confirmed&&!r.cancelled_at_utc&&r.lifecycle_status!=='CANCELLED'&&r.status!=='CANCELLED')p.confirmed++;seen.add(key);}
        if(Number.isSafeInteger(Number(line.quantity))&&Number(line.quantity)>0)p.units+=Number(line.quantity);else p.unitsComplete=false;
        products.set(key,p);
      }
    }
    if(inside(r.confirmed_at_utc))out.confirmations++;
    if(Date.parse(r.created_at_utc)>=now-3600000&&Date.parse(r.created_at_utc)<=now)out.last_hour++;
    if(cohort||inside(r.confirmed_at_utc)||Date.parse(r.created_at_utc)>=now-3600000) {
      if(!r.observed_at||!r.source_updated_at)identityComplete=false;
      if(r.observed_at)observed.push(new Date(r.observed_at).toISOString());
      if(r.source_updated_at)source.push(new Date(r.source_updated_at).toISOString());
    }
  }
  return {...out,identityComplete,products:[...products.values()],productCoverage,observed_at:observed.sort()[0]||null,source_updated_at:source.sort()[0]||null};
}

// A single bounded query over the canonical mirror; no pending-queue filter,
// personal fields, provider writes or new ingestion owner.
export async function readOrderSummary(pool, now=Date.now(),spec={preset:'today'}) {
  const period=resolvePeriod(spec,now);
  const result=await pool.query({text:`WITH scoped AS (
    SELECT market,store_id,dropea_order_id,created_at_utc,confirmed_at_utc,
      cancelled_at_utc,lifecycle_status,status,source_updated_at,observed_at,product_summary
    FROM read_models.operations_order_context
    WHERE source_system='DROPEA_PUBLIC_API_V2' AND
      ((created_at_utc >= $1 AND created_at_utc < $2) OR (confirmed_at_utc >= $1 AND confirmed_at_utc < $2) OR created_at_utc BETWEEN $3 AND $4)
    ORDER BY observed_at DESC LIMIT 20001
  ) SELECT (SELECT json_agg(scoped) FROM scoped) AS orders,
    (SELECT json_agg(h) FROM (SELECT sync_completed_at AS last_success_at,
      CASE WHEN errors>0 THEN updated_at END AS last_failure_at,pagination_complete,
      records_read=(SELECT count(*) FROM read_models.integration_dropea_orders d WHERE d.market=c.market AND d.store_id=c.store_id)
      AND records_read=(SELECT count(DISTINCT dropea_order_id) FROM read_models.operations_order_context d WHERE d.market=c.market AND d.store_id=c.store_id AND d.source_system='DROPEA_PUBLIC_API_V2') AS coverage_certified
      FROM read_models.integration_dropea_sync_checkpoints c WHERE resource_type='orders' AND phase='INCREMENTAL') h) AS health`,
    values:[period.start,period.end,new Date(now-3600000).toISOString(),new Date(now).toISOString()],query_timeout:2000});
  const data=result.rows[0],r=summarizeOrders(data.orders||[],now,period),health=data.health||[];
  const complete=r.identityComplete&&(data.orders||[]).length<=20000&&health.length>0&&health.every(h=>h.coverage_certified!==false&&h.pagination_complete===true&&h.last_success_at&&(!h.last_failure_at||Date.parse(h.last_failure_at)<Date.parse(h.last_success_at)));
  // source_updated_at may be the provider's last modification, not observation.
  const clocks=[r.observed_at,...health.map(h=>h.last_success_at)].filter(Boolean).map(x=>new Date(x).toISOString());
  const observedAt=clocks.sort()[0]||null;
  const age=observedAt?now-Date.parse(observedAt):Infinity;
  return {...Object.fromEntries(['received','confirmed','cancelled','pending','confirmations','last_hour'].map(k=>[k,r[k]])),
    unclassified:r.received-r.confirmed-r.cancelled-r.pending,day:period.to,period,products:r.products,productCoverage:r.productCoverage,
    source:'DROPEA_PUBLIC_API_V2',observedAt,sourceUpdatedAt:r.source_updated_at,checkedAt:new Date(now).toISOString(),
    coverage:complete?'COMPLETE':'UNVERIFIED',freshness:complete&&age>=0&&age<60000?'FRESH':'STALE',
    refreshSupported:false,actionsExecuted:0};
}

export class OrderSummaryReader {
  constructor({read,refresh=null,now=()=>Date.now(),timeoutMs=2500}) {Object.assign(this,{read,refresh,now,timeoutMs});this.inflight=new Map();this.last=new Map();}
  async get(spec={preset:'today'}) {
    const requestedAt=this.now(),period=resolvePeriod(spec,requestedAt),key=JSON.stringify([spec,period.from,period.to]);
    if (!this.inflight.has(key)) {
      if(this.inflight.size>=4)throw Error('ORDER_READ_BUSY');
      const task=Promise.resolve().then(async()=>{
        let r=await this.read(requestedAt,spec);
        if (r.freshness!=='FRESH'&&this.refresh) {await this.refresh(spec);r=await this.read(requestedAt,spec);}
        if(r.coverage==='COMPLETE'){this.last.set(key,r);while(this.last.size>30)this.last.delete(this.last.keys().next().value);}
        return r;
      }).finally(()=>{this.inflight.delete(key);});this.inflight.set(key,task);
    }
    let timer;
    try {return await Promise.race([this.inflight.get(key),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('ORDER_READ_TIMEOUT')),this.timeoutMs);})]);}
    catch {const last=period.rolling?null:this.last.get(key);return last?{...last,checkedAt:new Date(requestedAt).toISOString(),freshness:'STALE',warning:'No se pudo actualizar; última instantánea fiable.'}:{source:'DROPEA_PUBLIC_API_V2',period,checkedAt:new Date(requestedAt).toISOString(),freshness:'UNAVAILABLE',coverage:'UNVERIFIED',observedAt:null};}
    finally {clearTimeout(timer);}
  }
}
