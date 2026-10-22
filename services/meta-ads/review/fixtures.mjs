import {normalizeInsight,CONTRACT} from '../metrics.mjs';
export const FIXTURE_NOW=Date.parse('2026-10-21T10:00:00Z');
export const SOURCE_ROW={spend:'100',impressions:'10000',reach:'5000',frequency:'2',inline_link_clicks:'300',actions:[{action_type:'offsite_conversion.fb_pixel_purchase',value:'10'},{action_type:'landing_page_view',value:'200'},{action_type:'offsite_conversion.fb_pixel_add_to_cart',value:'60'},{action_type:'offsite_conversion.fb_pixel_initiate_checkout',value:'40'}],action_values:[{action_type:'offsite_conversion.fb_pixel_purchase',value:'500'}]};
export function fixtureFact(id='10001',level='campaign',patch={}){
 const row={...structuredClone(SOURCE_ROW),campaign_id:id,campaign_name:'Campaña '+id,adset_id:'2'+id,adset_name:'Conjunto '+id,ad_id:'3'+id,ad_name:'Anuncio '+id,date_start:'2026-10-14',date_stop:'2026-10-20',...patch};
 return normalizeInsight(row,{level,accountId:'9',contract:CONTRACT,observedAt:new Date(FIXTURE_NOW).toISOString(),complete:true,currency:'EUR',timezone:'Europe/Madrid'});
}
export function fixtureDataset(count=5){
 const current={},prior={},daily={},entities={};
 for(const level of ['campaign','adset','ad']){
  current[level]=Array.from({length:count},(_,i)=>fixtureFact(String(10001+i),level));prior[level]=structuredClone(current[level]).map(f=>({...f,since:'2026-10-07',until:'2026-10-13'}));
  daily[level]=current[level].flatMap(f=>Array.from({length:7},(_,i)=>({...f,since:`2026-10-${14+i}`,until:`2026-10-${14+i}`})));
  entities[level]=current[level].map(f=>({id:f.entityId,name:f.name,campaign_id:f.campaignId,adset_id:f.adsetId,objective:'OUTCOME_SALES',optimization_goal:'OFFSITE_CONVERSIONS',daily_budget:'5000',effective_status:'ACTIVE',created_time:'2026-09-01T00:00:00Z',...(level==='ad'?{creative:{thumbnail_url:'https://scontent.fbcdn.net/fixture.jpg'}}:{})}));
 }
 return {account:{id:'act_9',currency:'EUR',timezone_name:'Europe/Madrid',account_status:1},range:{since:'2026-10-14',until:'2026-10-20',partial:false},comparison:{since:'2026-10-07',until:'2026-10-13',partial:false},observedAt:new Date(FIXTURE_NOW).toISOString(),current,prior,daily,entities,creativeStatus:'AVAILABLE'};
}
export const fixtureExtras=d=>({metadata:d.entities});
