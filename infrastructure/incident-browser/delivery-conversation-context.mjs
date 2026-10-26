import {madridDate} from '../../autoconfirm/src/workflows/incident-intent-v2.mjs';
const fold=t=>String(t||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();

export function deliveryContactContext(value){
 const text=fold(value);
 const noCall=/\bno (?:me |nos )?(?:llam\w*|avis\w*)\b/.test(text);
 const conditional=/\b(?:solo si|solamente si|si me|si nos)\b/.test(text);
 // Remove only a recognized contact clause from schedule parsing. Its full
 // literal text remains in the evidence and note; conditions are not erased.
 const call='(?:(?:me|nos|le)\\s+)?(?:llam(?:a|as|an|en|e|ar|arme|ame|enme)|avis(?:a|as|an|en|e|ar|arme|ame|enme))';
 const tail='(?:\\s+(?:por\\s+(?:telefono|movil)))?\\s+antes(?:\\s+de)?\\s+(?:llegar|venir|la entrega|entregar|traerlo)';
 const expression=new RegExp('\\b(?:(?:pero|y|por favor)\\s+)?'+call+tail+'\\b','g');
 const matches=[...text.matchAll(expression)];
 const callBefore=!noCall&&matches.length===1;
 const scheduleText=callBefore&&!conditional?text.replace(expression,' ').replace(/[,.!]/g,' ').replace(/\s+/g,' ').trim():text;
 const withoutDates=text.replace(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{4}\b/g,'');
 const differentPhone=/\b(?:llam\w*|avis\w*|telefono|movil)\b/.test(text)
  &&[...withoutDates.matchAll(/\+?\b\d[\d\s-]{7,}\d\b/g)].some(m=>m[0].replace(/\D/g,'').length>=9);
 return {callBeforeArrival:callBefore,conditional,noCall,scheduleText,
  contactOnly:callBefore&&!conditional&&!scheduleText.replace(/\b(?:hola|por favor|gracias)\b/g,'').trim(),
  differentPhone};
}

export function deliveryScheduleText(value){
 const c=deliveryContactContext(value);
 let t=c.scheduleText;
 if(!c.conditional&&!c.noCall){
  t=t.replace(/^(?:puedes?|podrias?|podria[n]?|pueden)\s+(?:veni[r]?|venir|pasar)(?:\s+a\s+(?:entregar(?:lo)?|traer(?:lo)?))?\b/,'pueden entregarlo');
  t=t.replace(/\b(?:en horario de|en la) (manana|tarde)\b/g,'por la $1');
 }
 return t;
}

export function requestedDayOfMonth(value,at){
 const t=fold(value),days=[...t.matchAll(/\bdia\s+(\d{1,2})\b/g)].map(m=>Number(m[1]));
 const unique=[...new Set(days)];if(unique.length!==1||unique[0]<1||unique[0]>31)return null;
 const day=madridDate(at);if(!day)return null;
 const date=day.slice(0,8)+String(unique[0]).padStart(2,'0');
 if(!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||date<day)return null;
 return date;
}
export const paymentContext=value=>/\b(?:efectivo|dinero|importe|pagar|pago|precio|descuento|euros|tarjeta|cobro|cobrar|salario\w*|nomina)\b/.test(fold(value));
export function pickupContext(value){
 const t=fold(value);
 return /\b(?:recoger|recogida|recojo|retirar|retirarlo)\b/.test(t)
  ||/\b(?:oficina|sucursal|agencia)\b/.test(t)&&/\b(?:voy|ire|pasare|puedo ir|puedo pasar)\b/.test(t);
}
export function paymentClarification({date,window,order}){
 const amount=String(order?.orderAmount??'');
 const exact=/^\d+(?:[.,]\d{1,2})?$/.test(amount)&&Number(amount.replace(',','.'))>0&&order.currencyCode==='EUR';
 const total=exact?`${Number(amount.replace(',','.')).toFixed(2).replace('.',',')} €`:'el importe del pedido';
 const day=date?date.split('-').reverse().join('/'):null;
 const known=day?`Ha indicado el ${day}${window?window==='morning'?' por la mañana':' por la tarde':''}. `:'';
 const missing=day?(window?'':` Indíquenos únicamente en qué franja puede recibirlo ese día.`):' Indíquenos también el día y la franja en que puede recibirlo.';
 return `${known}Para solicitar la nueva entrega, confirme que dispondrá de ${total} en efectivo cuando llegue el repartidor.${missing}`;
}
