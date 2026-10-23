const clean=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[¿?¡!]/g,'').replace(/\s+/g,' ').trim();
export function parseReviewQuestion(input){
 const text=clean(input);if(!text||text.length>1000)return null;
 // Mutations and confirmations always belong to the established executor.
 if(/\b(sube|aumenta|baja|reduce|pon|fija|establece|pausa|apaga|confirma|confirmo|cancela|hazlo|presupuesto|autopilot)\b/.test(text)||/^\//.test(text))return null;
 if(!/auditoria|compara|campana|anuncio|acciones recomiendas|perdiendo clientes|vendiendo menos|vendiend[o]? poco|oportunidad|ctr|cpc|cpm|roas|fatiga|embudo|creativ|conversion|carrito|checkout|intervencion/.test(text))return null;
 const dates=[...text.matchAll(/\b20\d{2}-\d{2}-\d{2}\b/g)].map(m=>m[0]);
 const period=/\bhoy\b/.test(text)?'hoy':/\bayer\b/.test(text)?'ayer':`${/\b(3|7|14|30|60|90) dias\b/.exec(text)?.[1]||'7'}d`;
 const ids=[...text.matchAll(/\b(?:id |campana )([0-9]{5,30})\b/g)].map(m=>m[1]);
 const selector=/\b(nida|collagum|colla gum|seoul(?: 1988)?)\b/.exec(text)?.[1]||null;
 const focus=/oportunidad|potencial|acciones recomiendas|reducirias/.test(text)?'opportunities':/peor|sin vender|sin ventas/.test(text)?'worst':/mejor/.test(text)?'best':/compara/.test(text)?'comparison':/fatiga|creativ/.test(text)?'creative':/carrito|checkout|embudo|conversion/.test(text)?'funnel':'audit';
 return {period,level:/anuncio/.test(text)?'ad':'campaign',focus,selector,...(ids.length?{campaignIds:ids}:{}),...(dates.length===2?{since:dates[0],until:dates[1]}:{}),...(dates.length===4?{since:dates[0],until:dates[1],compareSince:dates[2],compareUntil:dates[3]}:{}),question:input};
}
export function formatReview(report,query={}){
 const lines=[`${report.agent} · V7`,`${report.range.since} → ${report.range.until} · Europe/Madrid`,...report.summary,`Fuente Meta · ${report.contract}`,`Lectura: ${report.observedAt} · ${report.freshness}`];
 if(report.hourly.status==='AVAILABLE_TRAFFIC_ONLY')lines.push(`Mismas horas completas ${report.hourly.hours}: gasto ${report.hourly.current.spend??'N/D'} / ${report.hourly.previous.spend??'N/D'} €. Conversiones horarias no comparables.`);
 if(report.campaignAudit){const a=report.campaignAudit;lines.push(`Campaña ${a.campaignId} · ${a.name} · ${a.classification} · Confianza ${a.confidence}`, ...a.facts.map(f=>`${f.question} ${f.answer}`),`Qué haría: ${a.executive.nextAction}`,`Riesgo: ${a.executive.risk}`);}
 if(query.level==='ad'&&['best','worst'].includes(query.focus)){const ads=report.rows.filter(r=>r.sample.volume&&Number.isFinite(r.cpa)).toSorted((a,b)=>query.focus==='best'?a.cpa-b.cpa:b.cpa-a.cpa);for(const r of ads.slice(0,3))lines.push(`${r.name} · ID ${r.entityId} · Gasto ${r.spend} EUR · Compras ${r.purchases} · CPA ${r.cpa?.toFixed(2)??'N/D'} EUR · ROAS ${r.roas??'N/D'}. Comparación observacional; revisar población y atribución.`);}
 if(query.focus==='worst'&&/sin vender|sin ventas/i.test(query.question||'')){const rows=report.rows.filter(r=>r.spend>=report.policy.minSpend&&r.impressions>=report.policy.minImpressions&&r.purchases===0&&r.purchaseValue===0).toSorted((a,b)=>b.spend-a.spend);for(const r of rows.slice(0,3))lines.push(`${r.name} · ID ${r.entityId}: ${r.spend} EUR gastados y cero compras atribuidas explícitamente verificadas. No equivale a un fallo de la web; revisar medición, madurez y contexto.`);if(!rows.length)lines.push('No hay un cero de compras suficientemente verificado para afirmar que un anuncio está gastando sin vender.');}
 const rs=query.focus==='opportunities'?report.recommendations.slice(0,3):report.recommendations.slice(0,4);
 for(const r of rs)lines.push(`${r.title} · ${r.name}\nEvidencia: ${Object.entries(r.evidence).filter(([,v])=>typeof v==='number').map(([k,v])=>`${k}=${v.toFixed(3)}`).join(', ')||r.code}\nHipótesis, confianza ${r.confidence}. ${r.action}\nAlternativas: ${r.alternatives.join('; ')}\nValidación: ${r.validation}`);
 if(!rs.length)lines.push('Sin una intervención respaldada por la muestra y comparación disponibles.');
 if(report.warnings.length)lines.push(`Límites: ${report.warnings.join(', ')}`);
 lines.push('Propuestas de revisión interna; los cambios presupuestarios conservan su ejecutor y confirmaciones.');
 return lines.join('\n\n').slice(0,3700);
}
