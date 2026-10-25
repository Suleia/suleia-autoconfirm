import {businessDayBounds} from '../../../packages/platform-core/src/business-day.mjs';

export const ZONE = 'Europe/Madrid';
export const NIGHT_TIMES = Object.freeze(['22:30','22:45','23:00','23:15','23:30','23:45','23:59']);
export const REVIEW_TIMES = Object.freeze([...Array.from({length:16},(_,i)=>`${String(i+7).padStart(2,'0')}:00`),...NIGHT_TIMES]);
export const V6_REVIEW_TIMES=Object.freeze(['08:00','10:00','12:00','16:00','18:00','22:30']);
export const reviewTimes=version=>version==='SULEIA_META_AUTOPILOT_V6'?V6_REVIEW_TIMES:REVIEW_TIMES;
const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
const instantCache=new Map();
export function madridTime(now=Date.now()) {
  const parts=Object.fromEntries(formatter.formatToParts(now).map(p=>[p.type,p.value]));
  return {date:`${parts.year}-${parts.month}-${parts.day}`,time:`${parts.hour}:${parts.minute}`,second:Number(parts.second)};
}
export function reviewSlot(now=Date.now(),version) {
  const local=madridTime(now);
  if(!reviewTimes(version).includes(local.time))return null;
  if(version==='SULEIA_META_AUTOPILOT_V6')return {...local,key:`${local.date}:${local.time}`,kind:local.time==='08:00'?'OBSERVE':local.time==='22:30'?'NIGHT':['12:00','16:00','18:00'].includes(local.time)?'SPECIAL':'ORDINARY',nightIndex:local.time==='22:30'?0:-1};
  return {...local,key:`${local.date}:${local.time}`,kind:NIGHT_TIMES.includes(local.time)?'NIGHT':['12:00','19:00'].includes(local.time)?'SPECIAL':'ORDINARY',nightIndex:NIGHT_TIMES.indexOf(local.time)};
}
export function instantFor(date,time) {
  const key=date+':'+time;if(instantCache.has(key))return instantCache.get(key);
  const start=Date.parse(businessDayBounds({businessDate:date}).utc_start);
  // All configured reviews occur after the repeated/skipped DST hour. Resolve
  // against actual Madrid wall time rather than hard-coded UTC offsets.
  for(let at=start;at<start+26*3600000;at+=60000)if(madridTime(at).date===date&&madridTime(at).time===time){if(instantCache.size>=400)instantCache.clear();instantCache.set(key,at);return at;}
  throw Error('AUTOPILOT_LOCAL_TIME_UNAVAILABLE');
}
export function nextReview(now=Date.now(),version) {
  const local=madridTime(now);
  for(const time of reviewTimes(version))if(time>local.time)return new Date(instantFor(local.date,time)).toISOString();
  const tomorrow=new Date(Date.parse(local.date+'T12:00:00Z')+86400000).toISOString().slice(0,10);
  return new Date(instantFor(tomorrow,reviewTimes(version)[0])).toISOString();
}
export const isNight = (now,version) => {const t=madridTime(now).time;return t>='22:30'||t<(version==='SULEIA_META_AUTOPILOT_V6'?'08:00':'07:00');};
