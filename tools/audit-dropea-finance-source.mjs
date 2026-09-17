import { createDropeaPublicApiClient } from '../services/integrations/dropea/public-api-client.mjs';
import { loadDropeaStoreConfigs } from '../services/integrations/dropea/store-config.mjs';
import { mapDropeaOrderState } from '../packages/platform-core/src/operational-truth/dropea-canonical.mjs';

const day = value => value ? new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value)) : null;
for (const store of loadDropeaStoreConfigs()) {
  const client=createDropeaPublicApiClient({token:store.token,market:store.market,rateLimitPerMinute:45,audit:()=>{}});
  const page=await client.listAll('listOrders',{store_id:Number(store.store_id),date_from:'2026-04-30T22:00:00Z',date_to:new Date().toISOString(),date_type:'created_at',sort_by:'created_at',sort_order:'asc'},
    {maxPages:40,maxRecords:4000,requestedLimit:100,pagePauseMs:400});
  const months={}; const today=day(new Date()); const todayEvents={delivered:0,returned:0};
  for (const order of page.items) {
    const created=day(order.created_at_utc || order.created_at); if (!created || created<'2026-05-01') continue;
    const month=created.slice(0,7); const summary=months[month] ||= {orders:0,statuses:{},delivered:0,returned:0,finalBreakdowns:0,missingBreakdowns:0,breakdownExpenses:0};
    summary.orders++; const status=mapDropeaOrderState(order.status,order.sub_status).canonical_state; summary.statuses[status]=(summary.statuses[status] || 0)+1;
    const sub=String(order.sub_status || '').toUpperCase();
    const delivery=day(order.delivered_at_utc || order.delivered_at);
    const returned=day(order.returned_at_utc || order.returned_at || (['REFUSED','REFUSED_LOST_OR_DAMAGED','REJECTED'].includes(sub)?order.rejected_at:null));
    if (returned) {summary.returned++; if(returned===today)todayEvents.returned++;}
    else if (delivery) {summary.delivered++;if(delivery===today)todayEvents.delivered++;}
    const breakdown=order.expenses_breakdown;
    if (breakdown && (delivery || returned)) {
      summary.finalBreakdowns+=Number(breakdown.is_estimate===false);
      const base=Number(breakdown.fulfillment_outbound_price || 0)+Number(breakdown.fulfillment_extra_unit_price || 0)+Number(breakdown.shipping_outbound_price || 0)
        +(returned?Number(breakdown.fulfillment_refused_price || 0)+Number(breakdown.shipping_refused_price || 0):Number(breakdown.cod_commission || 0));
      const product=Number(breakdown.product_price || 0);
      const total=breakdown.total_expenses ?? (product+Math.round(product*Number(breakdown.tax_rate_supplier || 0))/100+base+Math.round(base*(Number(breakdown.tax_rate_dropea || 0)+Number(breakdown.equivalence_surcharge_rate || 0)))/100);
      if(Number.isFinite(Number(total)))summary.breakdownExpenses+=Number(total);
    }
    else if (delivery || returned) summary.missingBreakdowns++;
  }
  console.log(JSON.stringify({source:'DROPEA_DIRECT_GET',market:store.market,observedAt:new Date().toISOString(),complete:page.complete,
    read:page.records_read,pages:page.page_count,duplicates:page.duplicates_skipped,months,todayEvents,
    orderFieldNames:Object.keys(page.items[0] || {}),terminalFieldNames:Object.keys(page.items.find(r=>r.delivered_at || r.rejected_at) || {}),
    breakdownFieldNames:Object.keys(page.items.find(r=>r.expenses_breakdown)?.expenses_breakdown || {}),actions:0,writes:0}));
}
