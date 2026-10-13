import {holidays} from './holidays-es.mjs';
import {madridDate} from '../../autoconfirm/src/workflows/incident-intent-v2.mjs';

const provinces={Andalucia:'04 11 14 18 21 23 29 41',Aragon:'22 44 50',Asturias:'33',Baleares:'07',Canarias:'35 38',Cantabria:'39',CastillaLM:'02 13 16 19 45',CastillaYL:'05 09 24 34 37 40 42 47 49',Cataluna:'08 17 25 43',Extremadura:'06 10',Galicia:'15 27 32 36',Madrid:'28',Murcia:'30',Navarra:'31',PaisVasco:'01 20 48',Rioja:'26',Valencia:'03 12 46',Ceuta:'51',Melilla:'52'};
export function nextBusinessMorning(now,order){
 const address=order?.raw?.shipping_address;
 if(address?.country!=='ES'||!/^\d{5}$/.test(address.postal_code||''))return null;
 const region=Object.keys(provinces).find(r=>provinces[r].split(' ').includes(address.postal_code.slice(0,2)));
 // Island-specific calendars and Aran need a more precise geographic mapping.
 if(!region||region==='Canarias'||address.postal_code.startsWith('255'))return null;
 let day=madridDate(now);
 for(let n=0;n<14;n++){
  day=new Date(Date.parse(day+'T12:00:00Z')+86400000).toISOString().slice(0,10);
  const calendar=holidays[day.slice(0,4)]?.[region];if(!calendar)return null;
  const weekday=new Date(day+'T12:00:00Z').getUTCDay();
  if(weekday!==0&&weekday!==6&&!calendar.includes(day))return {date:day,time_window:'morning'};
 }
 return null;
}
