import {localDay,windowFor} from '../metrics.mjs';
export const shiftDay=(day,n)=>new Date(Date.parse(day+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
export function reviewWindow(query={},now=Date.now()){
 const today=localDay(now),period=query.period||'7d';
 if(Boolean(query.since)!==Boolean(query.until))throw Error('QUERY_INVALID');
 if(query.since)return windowFor({since:query.since,until:query.until},now,'Europe/Madrid',90);
 if(['hoy','ayer'].includes(period))return windowFor(period,now);
 const days=Number(String(period).replace(/d$/,''));
 if(![3,7,14,30,60,90].includes(days))throw Error('QUERY_INVALID');
 return {since:shiftDay(today,-days),until:shiftDay(today,-1),partial:false};
}
export function comparisonWindow(range,query={},now=Date.now()){
 if(Boolean(query.compareSince)!==Boolean(query.compareUntil))throw Error('QUERY_INVALID');
 if(query.compareSince)return reviewWindow({since:query.compareSince,until:query.compareUntil},now);
 const days=(Date.parse(range.until)-Date.parse(range.since))/86400000+1;
 return {since:shiftDay(range.since,-days),until:shiftDay(range.since,-1),partial:false};
}
export function comparisonCompatibility(a,b,contractA,contractB){
 const reasons=[];
 if(a.partial||b.partial)reasons.push('PARTIAL_DAY_REQUIRES_EQUIVALENT_HOURS');
 if(Date.parse(a.until)-Date.parse(a.since)!==Date.parse(b.until)-Date.parse(b.since))reasons.push('UNEQUAL_DURATION');
 if(a.since<=b.until&&b.since<=a.until)reasons.push('OVERLAPPING_PERIODS');
 if(contractA!==contractB)reasons.push('ATTRIBUTION_MISMATCH');
 return {comparable:!reasons.length,reasons};
}
// Completed advertiser-timezone hours only. Purchases are deliberately excluded:
// an hourly impression/action breakdown does not establish conversion-time cohorts.
export function equivalentHourlyTraffic(rows,range,now=Date.now()){
 const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Madrid',hour:'2-digit',hourCycle:'h23'}).format(now));
 const today=localDay(now),yesterday=shiftDay(today,-1);
 if(range.since!==today||range.until!==today||hour===0)return {status:'UNAVAILABLE',reason:'NO_EQUIVALENT_COMPLETE_HOURS'};
 const offset=day=>new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Madrid',timeZoneName:'longOffset'}).format(new Date(day+'T12:00:00Z')).split('GMT')[1];
 if(offset(today)!==offset(yesterday))return {status:'UNAVAILABLE',reason:'DST_CUT_NOT_EQUIVALENT'};
 const days=[today,yesterday],byDay=days.map(day=>rows.filter(r=>r.date_start===day&&/^\d\d:00:00 - \d\d:59:59$/.test(r.hourly_stats_aggregated_by_advertiser_time_zone||'')&&Number(r.hourly_stats_aggregated_by_advertiser_time_zone.slice(0,2))<hour));
 if(byDay.some(r=>!r.length))return {status:'UNAVAILABLE',reason:'HOURLY_COVERAGE_MISSING'};
 if(byDay.some(rs=>new Set(rs.map(r=>r.hourly_stats_aggregated_by_advertiser_time_zone.slice(0,2))).size!==hour))return {status:'UNAVAILABLE',reason:'INCOMPLETE_EQUIVALENT_HOUR_COVERAGE'};
 const total=rs=>{const out={};for(const[k,key]of[['spend','spend'],['impressions','impressions'],['linkClicks','inline_link_clicks']]){const xs=rs.map(r=>r[key]);out[k]=xs.every(x=>x!==undefined&&x!==''&&Number.isFinite(Number(x))&&Number(x)>=0)?xs.reduce((s,x)=>s+Number(x),0):null;}return out;};
 return {status:'AVAILABLE_TRAFFIC_ONLY',hours:`00:00–${String(hour).padStart(2,'0')}:00`,timezone:'Europe/Madrid',current:total(byDay[0]),previous:total(byDay[1]),purchaseComparison:'UNAVAILABLE',note:'Missing hours are not invented as zero. Attribution and conversion lag prevent a same-hour purchase conclusion.'};
}
