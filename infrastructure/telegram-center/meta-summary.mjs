import {escapeHtml,rankFacts} from './compact-reports.mjs';
const safe=(s,n=100)=>escapeHtml(String(s||'').replace(/[\r\n\u0000-\u001f]/g,' ').slice(0,n));
const num=v=>Number.isFinite(v)?v.toLocaleString('es-ES',{maximumFractionDigits:2}):'N/D';
export function formatMetaSummary(s,{page=0}={}){
 const rows=rankFacts(s.rows),pages=Math.max(1,Math.ceil(rows.length/4));page=Math.max(0,Math.min(Number.isInteger(page)?page:0,pages-1));
 const period=s.range.since===s.range.until?s.range.since:`${s.range.since} → ${s.range.until}`;
 const lines=[`📊 <b>META · ${safe(period)}</b>`,`💰 Gasto total: <b>${num(s.totals?.spend)} €</b>`];
 for(const f of rows.slice(page*4,page*4+4))lines.push(`<b>${safe(f.name)}</b>${f.delivery==='ACTIVE'?'':' · Pausada/no activa'}\n<b>ROAS: ${['VALID','ZERO'].includes(f.roasStatus)?num(f.roas):'N/D'}</b> · Gasto: ${num(f.spend)} € · Compras: ${num(f.purchases)}`);
 if(!rows.length)lines.push('Sin campañas con actividad verificable en el periodo.');
 if(!s.winnerComplete)lines.push('🏆 Más ventas: no verificable; faltan datos de compras.');
 else if(s.winners.length)lines.push(`🏆 Más ventas${s.winners.length>1?' (empate)':''}: ${s.winners.slice(0,3).map(w=>safe(w.name,65)).join(' / ')}${s.winners.length>3?` y ${s.winners.length-3} más`:''} · ${num(s.winners[0].purchases)} compras atribuidas${s.winners.length>1?' cada una':''}.`);
 else lines.push('🏆 Sin compras atribuidas verificables para destacar una campaña.');
 const r=s.fresh?s.recommendation:{direction:'maintain',reason:'Esperar una lectura actualizada antes de recomendar cambios.'};
 lines.push(`💡 Recomendación: ${{increase:'valorar subir',decrease:'valorar bajar',maintain:'mantener'}[r.direction]||'mantener'}${r.campaign?' '+safe(r.campaign,85):' por ahora'}. ${safe(r.reason,220)}`);
 const at=Number.isFinite(Date.parse(s.observedAt))?new Intl.DateTimeFormat('es-ES',{timeZone:'Europe/Madrid',dateStyle:'short',timeStyle:'short'}).format(new Date(s.observedAt)):'sin fecha verificable';
 if(!s.fresh)lines.push(s.diagnostic?.state==='PREPARING'?'⏳ Actualización en curso; se muestra la última lectura disponible.':`⚠️ Última lectura disponible: ${at}. No se pudo actualizar.`);
 if(s.partial)lines.push('⚠️ Faltan métricas; los datos no disponibles aparecen como N/D.');
 lines.push(`🕒 Lectura de Meta: ${at} · Europe/Madrid\nLas conversiones pueden registrarse con retraso.`);
 const request={action:'meta-summary',query:s.periodSpec?{periodSpec:s.periodSpec}:{since:s.range.since,until:s.range.until}};
 const navigation=[{label:'🔄 Actualizar',request:{...request,query:{...request.query,force:true}},page}];
 if(page>0)navigation.push({label:'← Anterior',request,page:page-1});
 if(page+1<pages)navigation.push({label:'Ver más →',request,page:page+1});
 return {text:lines.join('\n\n'),parseMode:'HTML',navigation};
}
