// Synthetic reference screenshot and live-cut regression. Never production data.
import {aggregateFacts,buildFact} from '../packages/platform-core/src/analytics/order-intelligence.mjs';
import {buildAnalyticsReport} from '../packages/platform-core/src/analytics/report.mjs';
export const now=new Date('2026-10-25T15:00:00Z');
const provinces=['08001','28001','30001','11001','29001','41001','46001','03001','23001','15001'];
export function fixture({reference=false}={}){
 const n=reference?487:493,confirmed=reference?373:376,rows=[];
 for(let i=0;i<n+560;i++){
  const prior=i>=n,j=prior?i-n:i,day=prior?new Date(Date.UTC(2026,7,27+j%30,12)):new Date(Date.UTC(2026,8,26+j%30,12));
  // Broad volume and multiple maturity groups; intentional sparse hours/provinces.
  const h=[0,2,6,8,10,11,12,13,14,16,17,18,18,19,20,21,22,23][j%18];const offset=day.toISOString().slice(0,10)>='2026-10-25'?1:2;day.setUTCHours(h-offset);
  const created=day.toISOString(),yes=prior?j<430:j<confirmed,delivered=yes&&(prior?j<280:j<212),returned=yes&&!delivered&&(prior?j<350:j<287),cancelled=!yes&&j<(prior?525:confirmed+98),product=['CollaGum DEMO','NIDA DEMO','Seoul DEMO'][j%3];
  const row={canonical_order_id:'BI-DEMO-'+i,created_at_utc:created,confirmed_at_utc:yes?created:null,processing_at_utc:yes?created:null,delivered_at_utc:delivered?created:null,returned_at_utc:returned?created:null,cancelled_at_utc:cancelled?created:null,lifecycle_status:cancelled?'CANCELLED':yes?'PROCESSING':'PENDING',incident_count:!prior&&j<147?2:0,incident_types:!prior&&j<147?['RECIPIENT_ABSENT']:[],total_amount:29.99,currency:'EUR',product_summary:{total_units:1+j%3,products:[{product_id:product,name:product,quantity:1+j%3}]}};
  const settled=delivered||returned,money={realizedRevenue:delivered?31.7584434:0,contributionAfterProduct:settled?(delivered?22.5:-5.26):null,productCost:delivered?3.4:0,outboundShippingCost:yes?4.06:0,outboundFulfillmentCost:yes?1:0,codCost:delivered?1.2:0,returnCost:returned?5.26:0,dropeaAdjustmentsCost:0};
  rows.push(buildFact(row,money,{postal_code:provinces[j%provinces.length],city:'Provincia DEMO'},now));
 }
 return rows;
}
const facts=fixture(),cells=aggregateFacts(facts);
// Financial headline only provided for fully covered dates and matching counts.
const days=Array.from({length:60},(_,i)=>{const day=new Date(Date.UTC(2026,7,27+i,12)).toISOString().slice(0,10),fs=facts.filter(f=>f.created_local_date===day);return{day,created:fs.length,realRevenue:fs.reduce((s,f)=>s+(f.realized_revenue||0),0),netProfit:fs.reduce((s,f)=>s+(f.contribution||0),0)-82.8,profit_complete:true,metaSpend:72,fixedCosts:10.8};});
export function analytics(q={}){return buildAnalyticsReport({cells,financeDays:days,filters:q,now,runtime:{source_updated_at:now.toISOString(),analytics_updated_at:now.toISOString(),finance_updated_at:now.toISOString(),finance_age_seconds:0,last_success:now.toISOString(),rows:cells.length}});}
