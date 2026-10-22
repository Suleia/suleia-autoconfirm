const clean=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[¿?¡!]/g,'').replace(/\s+/g,' ').trim();
export function parseReviewQuestion(input){
 const text=clean(input);if(!text||text.length>1000)return null;
 // Mutations and confirmations always belong to the established executor.
 if(/\b(sube|aumenta|baja|reduce|pon|fija|establece|pausa|apaga|confirma|confirmo|cancela|hazlo|presupuesto|autopilot)\b/.test(text)||/^\//.test(text))return null;
 if(!/auditoria|compara|campana|anuncio|vendiendo menos|vendiend[o]? poco|oportunidad|ctr|cpc|cpm|roas|fatiga|embudo|creativ|conversion|carrito|checkout|intervencion/.test(text))return null;
 const dates=[...text.matchAll(/\b20\d{2}-\d{2}-\d{2}\b/g)].map(m=>m[0]);
 const period=/\bhoy\b/.test(text)?'hoy':/\bayer\b/.test(text)?'ayer':`${/\b(3|7|14|30|60|90) dias\b/.exec(text)?.[1]||'7'}d`;
 const ids=[...text.matchAll(/\b(?:id |campana )([0-9]{5,30})\b/g)].map(m=>m[1]);
 const selector=/\b(nida|collagum|colla gum|seoul(?: 1988)?)\b/.exec(text)?.[1]||null;
 const focus=/oportunidad/.test(text)?'opportunities':/peor/.test(text)?'worst':/mejor/.test(text)?'best':/compara/.test(text)?'comparison':/fatiga|creativ/.test(text)?'creative':/carrito|checkout|embudo|conversion/.test(text)?'funnel':'audit';
 return {period,level:/anuncio/.test(text)?'ad':'campaign',focus,selector,...(ids.length?{campaignIds:ids}:{}),...(dates.length===2?{since:dates[0],until:dates[1]}:{}),...(dates.length===4?{since:dates[0],until:dates[1],compareSince:dates[2],compareUntil:dates[3]}:{}),question:input};
}
export function formatReview(report,query={}){
 const lines=[`${report.agent} · V6`,`${report.range.since} → ${report.range.until} · Europe/Madrid`,...report.summary,`Fuente Meta · ${report.contract}`,`Lectura: ${report.observedAt} · ${report.freshness}`];
 if(report.hourly.status==='AVAILABLE_TRAFFIC_ONLY')lines.push(`Mismas horas completas ${report.hourly.hours}: gasto ${report.hourly.current.spend??'N/D'} / ${report.hourly.previous.spend??'N/D'} €. Conversiones horarias no comparables.`);
 const rs=query.focus==='opportunities'?report.recommendations.slice(0,3):report.recommendations.slice(0,4);
 for(const r of rs)lines.push(`${r.title} · ${r.name}\nEvidencia: ${Object.entries(r.evidence).filter(([,v])=>typeof v==='number').map(([k,v])=>`${k}=${v.toFixed(3)}`).join(', ')||r.code}\nHipótesis, confianza ${r.confidence}. ${r.action}\nAlternativas: ${r.alternatives.join('; ')}\nValidación: ${r.validation}`);
 if(!rs.length)lines.push('Sin una intervención respaldada por la muestra y comparación disponibles.');
 if(report.warnings.length)lines.push(`Límites: ${report.warnings.join(', ')}`);
 lines.push('Propuestas de revisión interna; los cambios presupuestarios conservan su ejecutor y confirmaciones.');
 return lines.join('\n\n').slice(0,3700);
}
