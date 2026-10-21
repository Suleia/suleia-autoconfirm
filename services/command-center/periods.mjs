import {businessDateAt,businessDayBounds} from '../../packages/platform-core/src/business-day.mjs';
export const cleanText=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[¿?¡!]/g,'').replace(/\s+/g,' ').trim();
const shift=(day,n)=>new Date(Date.parse(day+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
function validDate(value){return /^20\d{2}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;}
export function resolvePeriod(spec={preset:'today'},now=Date.now()) {
 const today=businessDateAt(new Date(now));let from=today,to=today;const preset=spec.preset||'custom';
 if(preset==='yesterday')from=to=shift(today,-1);
 else if(preset==='two-days-ago')from=to=shift(today,-2);
 else if(preset==='14d'||preset==='30d')from=shift(today,-(parseInt(preset)-1));
 else if(preset==='month')from=today.slice(0,7)+'-01';
 else if(preset==='custom'){from=spec.from;to=spec.to||from;}
 else if(!['today','hour','48h'].includes(preset))throw Error('PERIOD_INVALID');
 if(!validDate(from)||!validDate(to)||from>to||to>today||(Date.parse(to)-Date.parse(from))/86400000>365)throw Error('PERIOD_INVALID');
 let start=Date.parse(businessDayBounds({businessDate:from}).utc_start),end=Math.min(now+1,Date.parse(businessDayBounds({businessDate:to}).utc_end_exclusive));
 if(preset==='hour'||preset==='48h'){start=now-(preset==='hour'?1:48)*3600000;from=businessDateAt(new Date(start));}
 return {spec:{...spec},from,to,start:new Date(start).toISOString(),end:new Date(end).toISOString(),timezone:'Europe/Madrid',partial:to===today,rolling:['hour','48h'].includes(preset),label:preset==='hour'?'Última hora':preset==='48h'?'Últimas 48 horas':from===to?from:`${from} → ${to}`};
}
const months=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
export function parsePeriodText(input,now=Date.now()) {
 const t=cleanText(input),today=businessDateAt(new Date(now));
 if(/48 horas antes/.test(t))return {question:'¿Quieres el día de hace dos días o las últimas 48 horas?'};
 if(/ultimas? 48 horas/.test(t))return {preset:'48h'};
 if(/hace 48 horas|anteayer/.test(t))return {preset:'two-days-ago'};
 if(/ultima hora/.test(t))return {preset:'hour'};
 if(/ultim[oa]s (?:dos|2) semanas|ultimos 14 dias/.test(t))return {preset:'14d'};
 if(/ultimos (?:30|treinta) dias/.test(t))return {preset:'30d'};
 if(/este mes|llevamos el mes|del mes/.test(t))return {preset:'month'};
 const iso=[...t.matchAll(/\b20\d{2}-\d{2}-\d{2}\b/g)].map(m=>m[0]);
 const numeric=[...t.matchAll(/\b(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})\b/g)].map(m=>`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`);
 let dates=iso.length?iso:numeric;
 if(!dates.length){
  const m=new RegExp('(?:entre (?:el )?(\\d{1,2}) y (?:el )?)?(\\d{1,2}) de ('+months.join('|')+')(?: de (20\\d{2}))?').exec(t);
  if(m){let year=m[4]||today.slice(0,4);const build=(d,y=year)=>`${y}-${String(months.indexOf(m[3])+1).padStart(2,'0')}-${d.padStart(2,'0')}`;
   if(!m[4]){const choices=[Number(year),Number(year)-1].filter(y=>{const d=build(m[2],y);return validDate(d)&&d<=today&&d>=shift(today,-29);});if(choices.length!==1)return {question:'Indica la fecha completa con año (AAAA-MM-DD).'};year=String(choices[0]);}
   dates=m[1]?[build(m[1]),build(m[2])]:[build(m[2])];
  }
 }
 if(dates.length){if(dates.length>2)return {question:'Indica una fecha o un intervalo de dos fechas.'};const spec={preset:'custom',from:dates[0],to:dates.at(-1)};try{resolvePeriod(spec,now);return spec;}catch{return {question:'Indica fechas válidas, no futuras, en un intervalo máximo de un año.'};}}
 if(/\bayer\b/.test(t))return {preset:'yesterday'};
 if(/\b(?:del|dia|entre) \d|ultim[oa]s \d+/.test(t))return {question:'Indica el intervalo con fechas completas (AAAA-MM-DD).'};
 return {preset:'today'};
}
export function parseOrderRequest(input,now=Date.now()) {
 const t=cleanText(input);
 if(/\b\d{3,12}\b/.test(t)&&!/(?:20\d{2}-\d{2}-\d{2}|\d{1,2}[\/-]\d{1,2}[\/-]20\d{2}| de 20\d{2})/.test(t))return null;
 if(/\bES\d{3,12}\b/i.test(input)||/^(?:consulta |ver )?pedido (?:#)?\d{3,12}$/.test(t))return null;
 if(!/pedidos|confirmados|confirmaciones|pendientes|actualizame las ventas|cuantos han entrado|como llevamos el mes/.test(t))return null;
 if(/al cierre|como estaban/.test(t))return {question:'El histórico muestra el estado actual de esos pedidos. No puedo acreditar su estado al cierre sin una instantánea de aquel momento.'};
 const period=parsePeriodText(t,now);if(period.question)return period;
 return {period,view:/confirmaciones realizadas|hemos confirmado|confirmado hoy/.test(t)?'confirmations':period.preset==='hour'?'hour':'today'};
}
