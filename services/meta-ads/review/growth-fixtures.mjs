// Synthetic development/test data only. Never imported by runtime.mjs.
import {analyzeReview} from './analyze.mjs';
import {aggregate} from '../report.mjs';
import {CONTRACT} from '../metrics.mjs';
import {reviewWindow,comparisonWindow,shiftDay} from './periods.mjs';
export const GROWTH_FIXTURE_NOW=Date.parse('2026-10-24T18:00:00Z');
const names=['Aqua Care · DEMO','Botánica · DEMO','Sérum diario · DEMO','Rutina nocturna · DEMO','Nueva prueba · DEMO'];
function fact(index,level,child,day){
 const recent=day>='2026-10-17',previous=day>='2026-10-10'&&day<'2026-10-17';
 const spend=[28,24,22,30,4][index],purchases=index===4?(day==='2026-10-23'?1:0):[5,3,3,2,0][index];
 const roas=index===0?recent?4.9:4.6:index===1?recent?2.4:4.3:index===2?2.7:index===3?recent?.9:1.1:purchases>0?3:0;
 const clicks=index===1&&recent?110:210,landing=170,cart=index===2&&recent?12:45,checkout=index===2&&recent?8:28;
 const scale=level==='ad'?.5:1,id=level==='campaign'?String(101+index):level==='adset'?String(201+index):String(3010+index*10+child);
 return {level,entityId:id,campaignId:String(101+index),adsetId:String(201+index),adId:level==='ad'?id:'',name:level==='campaign'?names[index]:level==='adset'?'Conjunto '+names[index]:'Creatividad '+(child+1)+' · '+names[index],since:day,until:day,
  spend:spend*scale,impressions:5000*scale,reach:2500*scale,frequency:2,linkClicks:clicks*scale,outboundClicks:(clicks-8)*scale,landingPageViews:landing*scale,addToCart:cart*scale,initiateCheckout:checkout*scale,purchases:purchases*scale,purchaseValue:spend*roas*scale,
  roas,purchaseType:'offsite_conversion.fb_pixel_purchase',roasStatus:purchases?'VALID':'ZERO',cpa:purchases?spend/purchases:null,linkCtr:clicks/50,linkCpc:spend/clicks,cpm:spend/5,costPerCart:spend/cart,costPerCheckout:spend/checkout,
  source:'META_INSIGHTS',contract:CONTRACT,observedAt:new Date(GROWTH_FIXTURE_NOW).toISOString(),quality:{purchase:'VALID',purchaseValue:'VALID',landing:'VALID',cart:'VALID',checkout:'VALID'},demonstration:true};
}
export function growthFixtureDataset(range){
 const comparison=comparisonWindow(range,{},GROWTH_FIXTURE_NOW),entities={},current={},prior={},daily={};
 for(const level of ['campaign','adset','ad']){
  const list=[];for(let index=0;index<5;index++)for(let child=0;child<(level==='ad'?2:1);child++)list.push({index,child});
  const make=(item,r)=>{const rows=[];for(let d=r.since;d<=r.until;d=shiftDay(d,1))rows.push(fact(item.index,level,item.child,d));return rows;};
  daily[level]=list.flatMap(item=>make(item,range));
  const total=(item,r)=>{const rows=make(item,r),first=rows[0];return {...first,...aggregate(rows),since:r.since,until:r.until,reach:12000,frequency:2.4,demonstration:true};};
  current[level]=list.map(item=>total(item,range));prior[level]=list.map(item=>total(item,comparison));
  entities[level]=current[level].map(row=>({id:row.entityId,name:row.name,campaign_id:row.campaignId,adset_id:row.adsetId,objective:'OUTCOME_SALES',optimization_goal:'OFFSITE_CONVERSIONS',effective_status:'ACTIVE',daily_budget:'5000',created_time:'2026-07-01T00:00:00Z',learning_stage_info:{status:'SUCCESS'},...(level==='ad'?{creative:{thumbnail_url:'/__fixture-creative/'+row.campaignId+'.svg'}}:{})}));
 }
 return {account:{id:'act_999',currency:'EUR',timezone_name:'Europe/Madrid',account_status:1},range,comparison,observedAt:new Date(GROWTH_FIXTURE_NOW).toISOString(),current,prior,daily,entities,mode:'SHADOW',creativeStatus:'AVAILABLE'};
}
export function growthFixtureReport(query={}){
 const range=reviewWindow(query,GROWTH_FIXTURE_NOW),dataset=growthFixtureDataset(range);
 return {...analyzeReview({dataset,query,extras:{metadata:dataset.entities},now:GROWTH_FIXTURE_NOW}),demonstration:true};
}
export function growthFixtureGoals(){return {observedAt:new Date(GROWTH_FIXTURE_NOW).toISOString(),matureRange:{since:'2026-09-19',until:'2026-10-16'},
 matureDays:Array.from({length:28},(_,i)=>({day:shiftDay('2026-09-19',i),orders:20+i%5,confirmed:14+i%4})),duplicateAssessment:'NOT_ASSESSED',
 today:{day:'2026-10-24',orders:32,confirmedFromTodayCohort:21,confirmationEventsToday:25,note:'DEMO: pedidos de la cohorte de hoy separados de confirmaciones de cohortes anteriores.'}};}
