import {cleanText,parsePeriodText,resolvePeriod} from './periods.mjs';

export function parseIncidentPeriod(input,now=Date.now()){
 const t=cleanText(input);
 if(!/\bincidencias?\b/.test(t))return null;
 if(/resueltas|cerradas|solucionadas|al cierre|como estaban/.test(t))return {question:'Puedo contar las incidencias creadas en un periodo y sus pendientes actuales. No tengo un histórico verificado para contar resoluciones por día o reconstruir cómo estaban al cierre.'};
 if(/\b(resuelve|soluciona|cierra|envia|borra|elimina)\b/.test(t))return {question:'Esta consulta solo informa sobre incidencias. No ejecuta soluciones ni envía mensajes.'};
 if(!/cuantas|numero|hoy|ayer|ultim|semana|mes|\b20\d{2}-|\d{1,2}[/-]\d{1,2}|\d{1,2} de /.test(t))return null;
 let spec=parsePeriodText(t,now);const n=/ultimos (3|7|tres|siete) dias/.exec(t);
 if(n){const days=['3','tres'].includes(n[1])?3:7,to=resolvePeriod({preset:'today'},now).to;spec={preset:'custom',from:new Date(Date.parse(to)-(days-1)*86400000).toISOString().slice(0,10),to};}
 if(spec.question)return spec;
 if(spec.preset==='today'&&/semana|mes pasado|ultim/.test(t))return {question:'Indica las fechas de las incidencias que quieres consultar (AAAA-MM-DD).'};
 const p=resolvePeriod(spec,now);
 if(Date.parse(p.to)-Date.parse(p.from)>30*86400000)return {question:'Consulta las incidencias en un intervalo de hasta 31 días.'};
 return {period:spec};
}

// Canonical incident mirror only: one aggregate read, no joins to messages,
// provider actions or pending-only date filter. Provider identity deduplicates
// records without merging incidents belonging to different stores/markets.
export const INCIDENT_SUMMARY_SQL=`WITH known AS (
 SELECT DISTINCT ON (market,store_id,dropea_issue_id)
 market,store_id,dropea_issue_id,created_at,status,is_active,observed_at
 FROM read_models.operations_incident_records
 WHERE market IS NOT NULL AND store_id IS NOT NULL AND dropea_issue_id IS NOT NULL
 ORDER BY market,store_id,dropea_issue_id,observed_at DESC NULLS LAST,updated_at DESC,canonical_issue_id
), counts AS (
 SELECT count(*) FILTER (WHERE created_at >= $1 AND created_at < $2)::integer AS created,
 count(*) FILTER (WHERE created_at >= $1 AND created_at < $2 AND status='PENDING' AND is_active=true)::integer AS period_pending,
 count(*) FILTER (WHERE status='PENDING' AND is_active=true)::integer AS pending_now
 FROM known
), health AS (
 SELECT sync_completed_at,pagination_complete,errors,
 records_read=(SELECT count(*) FROM known k WHERE k.market=c.market AND k.store_id=c.store_id AND status='PENDING' AND is_active=true) AS pending_coverage
 FROM read_models.integration_dropea_sync_checkpoints c
 WHERE resource_type='issues' AND phase='INCREMENTAL'
)
SELECT counts.*,(SELECT json_agg(health) FROM health) AS health,
(SELECT count(*)::integer FROM known k WHERE status='PENDING' AND is_active=true AND NOT EXISTS
 (SELECT 1 FROM read_models.integration_dropea_sync_checkpoints c WHERE c.market=k.market AND c.store_id=k.store_id AND c.resource_type='issues' AND c.phase='INCREMENTAL')) AS unchecked_stores,
(SELECT count(*)::integer FROM read_models.operations_incident_records WHERE market IS NULL OR store_id IS NULL OR dropea_issue_id IS NULL) AS unidentified
FROM counts`;
const count=n=>Number.isSafeInteger(n)&&n>=0?n:null;
export async function readIncidentSummary(pool,spec,now=Date.now()){
 const period=resolvePeriod(spec,now);
 try{
  const {rows}=await pool.query({text:INCIDENT_SUMMARY_SQL,values:[period.start,period.end],query_timeout:2500});
  const r=rows[0];if(!r)throw Error('EMPTY_INCIDENT_AGGREGATE');
  const health=r.health||[],validClock=h=>Number.isFinite(Date.parse(h.sync_completed_at))&&Date.parse(h.sync_completed_at)<=now+60000;
  const complete=health.length>0&&r.unidentified===0&&r.unchecked_stores===0&&health.every(h=>h.pagination_complete===true&&h.errors===0&&h.pending_coverage===true&&validClock(h));
  const observedAt=health.length&&health.every(validClock)?new Date(Math.min(...health.map(h=>Date.parse(h.sync_completed_at)))).toISOString():null;
  return {period,created:count(r.created),periodPending:count(r.period_pending),pendingNow:count(r.pending_now),observedAt,fresh:complete&&now-Date.parse(observedAt)<600000,historicalCoverage:'UNVERIFIED',pendingCoverage:complete?'COMPLETE':'UNVERIFIED'};
 }catch{return {period,created:null,periodPending:null,pendingNow:null,observedAt:null,fresh:false,unavailable:true,historicalCoverage:'UNVERIFIED',pendingCoverage:'UNVERIFIED'};}
}
export function formatIncidentSummary(s){
 const n=v=>Number.isSafeInteger(v)&&v>=0?String(v):'N/D';
 const at=s.observedAt?new Intl.DateTimeFormat('es-ES',{timeZone:'Europe/Madrid',dateStyle:'short',timeStyle:'short'}).format(new Date(s.observedAt)):'no verificable';
 return `📦 Incidencias Dropea · ${s.period.label}\n\nCreadas en el periodo y registradas: ${n(s.created)}\nDe ellas, pendientes ahora: ${n(s.periodPending)}\nPendientes ahora de todos los días: ${n(s.pendingNow)}\n\n🕒 Última sincronización: ${at} · Europe/Madrid\n${s.unavailable?'⚠️ No se pudo consultar la copia de Dropea.\n':!s.fresh?'⚠️ Lectura desactualizada o cobertura de pendientes no verificada.\n':''}Histórico registrado en la copia operativa; no acredita todas las incidencias de Dropea. Los pendientes reflejan su estado actual.`;
}
