export const ZONE='Europe/Madrid';
export function localClock(at){
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(at).map(x=>[x.type,x.value]));
 return {day:`${p.year}-${p.month}-${p.day}`,minute:Number(p.hour)*60+Number(p.minute)};
}
export function dailySlot(at){const p=localClock(at);return {...p,time:'22:30',timezone:ZONE,due:p.minute>=1350&&p.minute<1380,missed:p.minute>=1380,window:'22:30–23:00',recovery:'Resume within the local window; after 23:00 mark MISSED. Never replay uncertain sends.'};}
export function nextExecution(at){
 // Iterate actual instants, not a fixed UTC offset. Handles both DST changes.
 const start=Math.floor(at/60000)*60000+60000;
 for(let t=start;t<start+49*3600000;t+=60000){const c=localClock(t);if(c.minute===1350)return new Date(t).toISOString();}
 throw Error('EXECUTIVE_SCHEDULE_INVALID');
}
