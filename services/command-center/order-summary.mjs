import {businessDayBounds} from '../../packages/platform-core/src/business-day.mjs';

export function orderSummaryIntent(text) {
  const t=String(text).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if(/cuantos han entrado.*ultima hora/.test(t))return 'hour';
  if (/\b(?:pedido|pedidos|confirmados|confirmaciones|pendientes|ventas)\b/.test(t) && !/\b(?:ES)?\d{3,12}\b/i.test(t)) {
    if (/confirmaciones realizadas|hemos confirmado|confirmado hoy/.test(t)) return 'confirmations';
    if (/ultima hora/.test(t)) return 'hour';
    if (/cuantos|como vamos|actualizame las ventas|pedidos de hoy/.test(t)) return 'today';
  }
  return null;
}

export function summarizeOrders(rows,now) {
  const b=businessDayBounds({now:new Date(now)}),start=Date.parse(b.utc_start),end=Date.parse(b.utc_end_exclusive);
  const inside=value=>{const t=Date.parse(value);return t>=start&&t<end;};
  const map=new Map();let identityComplete=true;
  for(const r of rows) {
    if(!r.market||!r.store_id||!r.dropea_order_id){identityComplete=false;continue;}
    const key=JSON.stringify([r.market,r.store_id,r.dropea_order_id]),old=map.get(key);
    if(!old||Date.parse(r.observed_at)>Date.parse(old.observed_at))map.set(key,r);
  }
  const out={received:0,confirmed:0,cancelled:0,pending:0,confirmations:0,last_hour:0,identityComplete};
  const observed=[],source=[];
  for(const r of map.values()) {
    const cohort=inside(r.created_at_utc),confirmed=Number.isFinite(Date.parse(r.confirmed_at_utc));
    if(cohort) {
      out.received++;
      if(r.cancelled_at_utc||r.lifecycle_status==='CANCELLED'||r.status==='CANCELLED')out.cancelled++;
      else if(confirmed)out.confirmed++;
      else if((r.lifecycle_status||r.status)==='PENDING')out.pending++;
    }
    if(inside(r.confirmed_at_utc))out.confirmations++;
    if(Date.parse(r.created_at_utc)>=now-3600000&&Date.parse(r.created_at_utc)<=now)out.last_hour++;
    if(cohort||inside(r.confirmed_at_utc)||Date.parse(r.created_at_utc)>=now-3600000) {
      if(!r.observed_at||!r.source_updated_at)identityComplete=false;
      if(r.observed_at)observed.push(new Date(r.observed_at).toISOString());
      if(r.source_updated_at)source.push(new Date(r.source_updated_at).toISOString());
    }
  }
  return {...out,identityComplete,observed_at:observed.sort()[0]||null,source_updated_at:source.sort()[0]||null};
}

// A single bounded query over the canonical mirror; no pending-queue filter,
// personal fields, provider writes or new ingestion owner.
export async function readOrderSummary(pool, now=Date.now()) {
  const b=businessDayBounds({now:new Date(now)});
  const result=await pool.query({text:`WITH scoped AS (
    SELECT market,store_id,dropea_order_id,created_at_utc,confirmed_at_utc,
      cancelled_at_utc,lifecycle_status,status,source_updated_at,observed_at
    FROM read_models.operations_order_context
    WHERE source_system='DROPEA_PUBLIC_API_V2' AND
      ((created_at_utc >= $1 AND created_at_utc < $2) OR (confirmed_at_utc >= $1 AND confirmed_at_utc < $2) OR created_at_utc BETWEEN $3 AND $4)
    ORDER BY observed_at DESC LIMIT 20001
  ) SELECT (SELECT json_agg(scoped) FROM scoped) AS orders,
    (SELECT json_agg(h) FROM (SELECT last_success_at,last_failure_at,pagination_complete
      FROM read_models.operations_connector_health WHERE lower(connector) LIKE '%dropea%') h) AS health`,
    values:[b.utc_start,b.utc_end_exclusive,new Date(now-3600000).toISOString(),new Date(now).toISOString()],query_timeout:2000});
  const data=result.rows[0],r=summarizeOrders(data.orders||[],now),health=data.health||[];
  const complete=r.identityComplete&&(data.orders||[]).length<=20000&&health.length>0&&health.every(h=>h.pagination_complete===true&&h.last_success_at&&(!h.last_failure_at||Date.parse(h.last_failure_at)<Date.parse(h.last_success_at)));
  const clocks=[r.observed_at,r.source_updated_at,...health.map(h=>h.last_success_at)].filter(Boolean).map(x=>new Date(x).toISOString());
  const observedAt=clocks.sort()[0]||null;
  const age=observedAt?now-Date.parse(observedAt):Infinity;
  return {...Object.fromEntries(['received','confirmed','cancelled','pending','confirmations','last_hour'].map(k=>[k,r[k]])),
    unclassified:r.received-r.confirmed-r.cancelled-r.pending,day:b.business_date,
    source:'DROPEA_PUBLIC_API_V2',observedAt,sourceUpdatedAt:r.source_updated_at,
    coverage:complete?'COMPLETE':'UNVERIFIED',freshness:complete&&age>=0&&age<60000?'FRESH':'STALE',
    refreshSupported:false,actionsExecuted:0};
}

export class OrderSummaryReader {
  constructor({read,refresh=null,now=()=>Date.now(),timeoutMs=2500}) {Object.assign(this,{read,refresh,now,timeoutMs});this.inflight=null;this.last=null;}
  async get() {
    if (!this.inflight) {
      this.inflight=Promise.resolve().then(async()=>{
        let r=await this.read(this.now());
        if (r.freshness!=='FRESH'&&this.refresh) {await this.refresh();r=await this.read(this.now());}
        if(r.coverage==='COMPLETE')this.last=r;
        return r;
      }).finally(()=>{this.inflight=null;});
    }
    let timer;
    try {return await Promise.race([this.inflight,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('ORDER_READ_TIMEOUT')),this.timeoutMs);})]);}
    catch {return this.last&&this.last.day===businessDayBounds({now:new Date(this.now())}).business_date?{...this.last,freshness:'STALE',warning:'No se pudo actualizar; última instantánea fiable.'}:{source:'DROPEA_PUBLIC_API_V2',freshness:'UNAVAILABLE',coverage:'UNVERIFIED',observedAt:null};}
    finally {clearTimeout(timer);}
  }
}
