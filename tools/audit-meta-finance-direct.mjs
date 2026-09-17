// Read-only independent account-level spend audit; secrets stay in process memory.
import {FinanceReportClient} from '../apps/api/finance-report-client.mjs';
const settings=JSON.parse(process.env.SULEIA_FINANCE_AUDIT_INPUT || '{}');
delete process.env.SULEIA_FINANCE_AUDIT_INPUT;
if(!settings.token||!/^act_\d+$/.test(settings.account)||!/^v\d+\.0$/.test(settings.version))throw Error('Protected Meta read settings unavailable');
const client=new FinanceReportClient({baseUrl:settings.financeUrl,password:settings.password});
async function read(url){
  if(url.protocol!=='https:'||url.hostname!=='graph.facebook.com'||!url.pathname.startsWith(`/${settings.version}/`))throw Error('Meta read host/version mismatch');
  url.searchParams.delete('access_token');
  const response=await fetch(url,{headers:{Authorization:`Bearer ${settings.token}`},signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error(`Independent Meta read status ${response.status}`);
  const payload=await response.json();if(payload.error)throw Error('Independent Meta read returned an error');return payload;
}
const url=new URL(`https://graph.facebook.com/${settings.version}/${settings.account}`);url.searchParams.set('fields','currency,timezone_name');
const account=await read(url);
if(account.currency!=='EUR'||account.timezone_name!=='Europe/Madrid')throw Error('Meta financial currency/timezone mismatch');
const now=new Date();const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid'}).format(now);
const reports=await client.getMonthlyBundle(today.slice(0,7));
let failed=false;
for(const report of reports.filter(r=>r.period.month>='2026-05')){
  const month=report.period.month;const end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10);
  let url=new URL(`https://graph.facebook.com/${settings.version}/${settings.account}/insights`);
  for(const [key,value] of Object.entries({level:'account',fields:'spend,date_start,date_stop',time_increment:1,time_range:JSON.stringify({since:`${month}-01`,until:month===today.slice(0,7)?today:end}),limit:100}))url.searchParams.set(key,String(value));
  const rows=[];const seen=new Set();let complete=false;
  for(let page=0;page<20;page++){if(seen.has(url.toString()))throw Error('Meta pagination repeated');seen.add(url.toString());const payload=await read(url);rows.push(...(payload.data||[]));if(!payload.paging?.next){complete=true;break;}url=new URL(payload.paging.next);}
  if(!complete)throw Error('Meta pagination incomplete');
  const actual=new Map();for(const row of rows){const value=Number(row.spend);if(!Number.isFinite(value))throw Error('Meta spend invalid');actual.set(row.date_start,(actual.get(row.date_start)||0)+Math.round(value*100));}
  const differences=report.days.map(row=>({day:row.day,report:row.metaSpend,direct:(actual.get(row.day)||0)/100,partial:row.day===today})).filter(row=>row.report===null||Math.abs(Number(row.report)-row.direct)>.011);
  if(differences.some(row=>!row.partial))failed=true;
  console.log(JSON.stringify({source:'INDEPENDENT_META_MARKETING_API',month,observedAt:new Date().toISOString(),currency:account.currency,timeZone:account.timezone_name,sourceGeneratedAt:report.generatedAt,sourceTotal:report.totals.metaSpend,directTotal:[...actual.values()].reduce((n,v)=>n+v,0)/100,closedDayMismatches:differences.filter(r=>!r.partial).length,currentDayDifferences:differences.filter(r=>r.partial),closedDayDifferences:differences.filter(r=>!r.partial),readRows:rows.length,complete,actions:0,writes:0}));
}
settings.token=null;settings.password=null;
if(failed)process.exitCode=1;
