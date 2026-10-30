import {fold} from '../customer-care/context.mjs';
import {madridDate} from '../workflows/incident-intent-v2.mjs';
const addDay=(date,n)=>new Date(Date.parse(date+'T12:00:00Z')+86400000*n).toISOString().slice(0,10);
const weekdays=['lunes','martes','miercoles','jueves','viernes','sabado','domingo'];
const temporal=['DELIVERY_DATE','DELIVERY_WINDOW','TIME_FROM','TIME_TO','DELIVERY_AVAILABILITY'];
const words={una:1,dos:2,tres:3,cuatro:4,cinco:5,seis:6,siete:7,ocho:8,nueve:9,diez:10,once:11,doce:12};
const clock=(h,m=0)=>`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;

// Corrections to the existing extractor, scoped to temporal customer evidence.
// These are preferences, never carrier acceptance or a promise of delivery.
export function correctTemporalFacts(event,{facts,unresolved,put,question,current}){
  const text=fold(event.text),day=madridDate(Date.parse(event.source_event_at));
  const alternativeDays=weekdays.filter(w=>new RegExp('\\b'+w+'\\b').test(text));
  const nativeAlternative=/^manana por manana\/tarde[.! ]*$/.test(text);
  if(nativeAlternative){
    put('DELIVERY_DATE',addDay(day,1));facts.delete('DELIVERY_WINDOW');
    unresolved.delete('CONTRADICTORY_WINDOW');unresolved.add('DELIVERY_WINDOW');
  }
  // A morning window does not mean tomorrow; tomorrow alone is not a morning window.
  const morningPhrase=/\b(?:por (?:la|las)|en la|de la|toda la) manana/.test(text);
  const tomorrow=/\b(?:para )?manana\b/.test(text.replace(/(?:por (?:la|las)|en la|de la|toda la|esta) manana[s]?/g,''));
  if(morningPhrase&&!tomorrow&&!/\bhoy\b|esta (?:manana|tarde)|pasado manana|\b\d{1,2} de\b/.test(text)&&!alternativeDays.length)facts.delete('DELIVERY_DATE');
  if(tomorrow&&!nativeAlternative&&!morningPhrase&&!/pasado manana/.test(text)&&question!=='TIME_WINDOW'){
    put('DELIVERY_DATE',addDay(day,1));
    if(facts.get('DELIVERY_WINDOW')?.value==='MORNING')facts.delete('DELIVERY_WINDOW');
  }
  // Clauses about work or an unavailable window cannot become positive delivery preferences.
  const temporalText=text.replace(/(\d)\s*[.,]\s*(\d{2})(?:h\b|\b)/g,'$1:$2');
  const available=temporalText.split(/[;.!?]|\bpero\b|\bsino\b/).filter(s=>!/(?:trabajo|trabajando|no (?:voy a |puedo |estare|estoy|estar)|no.*(?:manana|tarde))/.test(s)).join(' ');
  const morning=/por (?:la|las) manana|en la manana|de la manana|toda la manana|^manana[.! ]*$/.test(available)&&!(tomorrow&&!morningPhrase&&question!=='TIME_WINDOW');
  const afternoon=/por (?:la|las) tarde|de la tarde|en la tarde|esta tarde|^tarde[.! ]*$/.test(available);
  if(!nativeAlternative){
    if(morning&&!afternoon){put('DELIVERY_WINDOW','MORNING');unresolved.delete('CONTRADICTORY_WINDOW');unresolved.delete('NEGATED_DELIVERY_PREFERENCE');}
    else if(afternoon&&!morning){put('DELIVERY_WINDOW','AFTERNOON');unresolved.delete('CONTRADICTORY_WINDOW');unresolved.delete('NEGATED_DELIVERY_PREFERENCE');}
    else if(!morning&&!afternoon&&(/no.*(?:manana|tarde)|trabajo.*(?:manana|tarde)/.test(text)))facts.delete('DELIVERY_WINDOW');
  }
  if(alternativeDays.length>1){facts.delete('DELIVERY_DATE');unresolved.add('DELIVERY_DATE');}
  const numbered=/\b(?:el|dia+|eldia)\s*(\d{1,2})(?![\d:.,])\b/.exec(text);
  if(numbered&&!/\b(?:ayer|dia anterior)\b/.test(text)){
    let year=+day.slice(0,4),month=+day.slice(5,7),date=+numbered[1];
    if(/mes (?:q|que|k) (?:viene|biene)|mes siguiente/.test(text)||date<+day.slice(8))if(++month===13){month=1;year++;}
    const value=`${year}-${String(month).padStart(2,'0')}-${String(date).padStart(2,'0')}`;
    if(date>0&&new Date(value).toISOString().slice(0,10)===value)put('DELIVERY_DATE',value);
  }
  let source=available.replace(/apartir/g,'a partir').replace(/(\d)\s*[:,.]\s*(\d{2})\s*h?\b/g,'$1:$2').replace(/(\d)\s*h(?:s|oras)?\b/g,'$1');
  source=source.replace(new RegExp(`\\b(las?|de|a|hasta|desde) (${Object.keys(words).join('|')})\\b`,'g'),(_,p,w)=>p+' '+words[w]);
  // Work hours are not availability; removing them also removes old parser uncertainty.
  if(/trabajo|trabajando/.test(text)&&!/[0-9]/.test(source)){
    facts.delete('TIME_FROM');facts.delete('TIME_TO');unresolved.delete('INVALID_TIME_RANGE');unresolved.delete('AMBIGUOUS_CLOCK');
  }
  const window=facts.get('DELIVERY_WINDOW')?.value||current.DELIVERY_WINDOW;
  const resolve=(h,m)=>{h=+h;m=+(m||0);if(h<12&&['AFTERNOON','EVENING'].includes(window))h+=12;return h<=23&&m<=59&&(h>=8||window==='MORNING')?clock(h,m):null;};
  const ranges=[...source.matchAll(/\b(?:de |entre |desde )?(?:las? )?(\d{1,2})(?::(\d{2}))?\s*(?:a|hasta|y)\s*(?:las? )?(\d{1,2})(?::(\d{2}))?\b/g)];
  if(ranges.length===1){
    const r=ranges[0],from=resolve(r[1],r[2]),to=resolve(r[3],r[4]);
    facts.delete('TIME_FROM');facts.delete('TIME_TO');
    if(from&&to&&from<to){put('TIME_FROM',from);put('TIME_TO',to);unresolved.delete('INVALID_TIME_RANGE');unresolved.delete('AMBIGUOUS_CLOCK');unresolved.delete('TIME_FROM');unresolved.delete('TIME_TO');}
    else{unresolved.add('TIME_FROM');unresolved.add('TIME_TO');}
  }else if(ranges.length>1){
    facts.delete('TIME_FROM');facts.delete('TIME_TO');put('DELIVERY_AVAILABILITY',event.text.slice(0,300));unresolved.delete('MULTIPLE_CLOCKS');
  }else{
    const boundaries=[...source.matchAll(/\b(a partir de|despues de|antes de|hasta|desde|sobre|a)\s+(?:las?\s+)?(\d{1,2})(?::(\d{2}))?\b/g)];
    if(boundaries.length===1){
      const b=boundaries[0],type=/antes|hasta/.test(b[1])?'TIME_TO':'TIME_FROM',value=resolve(b[2],b[3]);
      facts.delete(type);
      if(value){put(type,value);unresolved.delete('AMBIGUOUS_CLOCK');unresolved.delete(type);}else unresolved.add(type);
    }
  }
  // Recounting a carrier promise/past failed attempt is not a new chosen day.
  const reportsPast=/\b(?:me dijeron|me han dicho|medijo|me dijo|ayer|he estado|estuve)\b/.test(text);
  const ownPreference=/\b(?:prefiero|quiero|pueden venir|podeis venir|vengan|entreguen|desde las|a partir|estoy.*(?:hasta|desde))\b/.test(text);
  if((reportsPast||facts.get('ASKS_DELIVERY_DATE')?.value)&&!ownPreference){for(const key of temporal)facts.delete(key);}
}
