// Private, read-only audit. The export must be piped in memory to the comparison
// process; do not persist it, display it, or commit customer/order data.
// Only aggregate comparison results are suitable for the public audit log.
async function crosscheck() {
  const { createHash } = await import('node:crypto');
  const key = id => createHash('sha256').update(`ES:${String(id)}`).digest('hex');
  const day = value => value ? new Intl.DateTimeFormat('en-CA', { timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit' }).format(new Date(value)) : null;
  if (process.argv.at(-1) === 'export') {
    const { createDropeaPublicApiClient } = await import('../services/integrations/dropea/public-api-client.mjs');
    const { loadDropeaStoreConfigs } = await import('../services/integrations/dropea/store-config.mjs');
    const stores = loadDropeaStoreConfigs().filter(store => store.market === 'ES');
    const projection = []; let pages=0; let read=0;
    for (const store of stores) {
      const client = createDropeaPublicApiClient({ token:store.token,market:store.market,rateLimitPerMinute:45,audit:()=>{} });
      const result = await client.listAll('listOrders', {
        store_id:Number(store.store_id),date_from:'2026-04-30T22:00:00Z',date_to:new Date().toISOString(),
        date_type:'created_at',sort_by:'created_at',sort_order:'asc'
      }, { maxPages:40,maxRecords:4000,requestedLimit:100,pagePauseMs:400 });
      if (!result.complete || result.duplicates_skipped) throw Error('Direct audit pagination incomplete or duplicated');
      pages+=result.page_count;read+=result.records_read;
      for (const order of result.items) {
        const created = day(order.created_at_utc || order.created_at);
        if (!created || created<'2026-05-01') continue;
        const sub=String(order.sub_status || '').toUpperCase();
        const delivery=day(order.delivered_at_utc || order.delivered_at);
        const returned=day(order.returned_at_utc || order.returned_at || (['REFUSED','REFUSED_LOST_OR_DAMAGED','REJECTED'].includes(sub)?order.rejected_at:null));
        let expense=null,vat=null,providerProductCost=null;
        const b=order.expenses_breakdown;
        if (b && (delivery || returned)) {
          const base=Number(b.fulfillment_outbound_price || 0)+Number(b.fulfillment_extra_unit_price || 0)+Number(b.shipping_outbound_price || 0)
            +(returned?Number(b.fulfillment_refused_price || 0)+Number(b.shipping_refused_price || 0):Number(b.cod_commission || 0));
          const product=Number(b.product_price || 0);
          providerProductCost=product;
          if (['tax_rate_supplier','tax_rate_dropea','equivalence_surcharge_rate'].every(k=>b[k]!==null&&b[k]!==undefined&&Number.isFinite(Number(b[k])))) {
            vat=Math.round(product*Number(b.tax_rate_supplier))/100
              +Math.round(base*(Number(b.tax_rate_dropea)+Number(b.equivalence_surcharge_rate)))/100;
          }
          expense=b.total_expenses ?? (product+Math.round(product*Number(b.tax_rate_supplier || 0))/100
            +base+Math.round(base*(Number(b.tax_rate_dropea || 0)+Number(b.equivalence_surcharge_rate || 0)))/100);
        }
        projection.push({ key:key(order.id),createdDay:created,month:created.slice(0,7),outcome:returned?'RETURNED':delivery?'DELIVERED':null,
          settlementDay:returned || delivery,expense,vat,providerProductCost,final:b?.is_estimate===false });
      }
    }
    process.stdout.write(JSON.stringify({observedAt:new Date().toISOString(),pages,read,projection}));
    return;
  }
  let input='';for await (const chunk of process.stdin) input+=chunk;
  const direct=JSON.parse(input);
  const { loadOperationsConfig } = await import('../apps/api/server.mjs');
  const { createFinanceReportClient } = await import('../apps/api/finance-report-client.mjs');
  const client=createFinanceReportClient(loadOperationsConfig());
  const reports=await client.getMonthlyBundle('2026-09');
  const byKey=new Map(direct.projection.map(order=>[order.key,order]));
  const months={};let compared=0;
  for (const report of reports) {
    const month=report.period.month;
    const summary=months[month]={snapshotAt:report.generatedAt,settled:0,matched:0,missingDirect:0,outcomeMismatch:0,dateMismatch:0,expenseMismatch:0,nonFinal:0,
      sourceOrders:report.orders.length,directOrders:direct.projection.filter(order=>order.month===month).length,
      creationDateMismatch:0,dailyCohortMismatch:0,recognizedCostMismatch:0,profitFormulaMismatch:0,
      vat:{positiveOrders:0,zeroOrders:0,unknownOrders:0,amount:0}};
    for (const order of report.orders) {
      const directOrder=byKey.get(key(order.orderId));
      if (!directOrder || directOrder.createdDay!==order.createdDay) summary.creationDateMismatch++;
      if (!['DELIVERED','FINISHED','RETURNED'].includes(order.status)) continue;
      summary.settled++;const actual=byKey.get(key(order.orderId));
      if (!actual) {summary.missingDirect++;continue;}
      const outcome=order.status==='RETURNED'?'RETURNED':'DELIVERED';
      if (actual.outcome!==outcome) summary.outcomeMismatch++;
      if (actual.settlementDay!==order.settlementDay) summary.dateMismatch++;
      if (actual.expense===null || order.dropeaExpenses===null || !Number.isFinite(Number(actual.expense))
        || Math.abs(Number(actual.expense)-Number(order.dropeaExpenses))>.011) summary.expenseMismatch++;
      if (!actual.final || order.breakdownStatus!=='DROPEA_FINAL') summary.nonFinal++;
      if(actual.vat===null)summary.vat.unknownOrders++;
      else {summary.vat[actual.vat>0?'positiveOrders':'zeroOrders']++;summary.vat.amount+=actual.vat;}
      // Business product tariff is an extra cost only where Dropea reports no
      // provider product charge. VAT already belongs to the provider expense.
      const extraProduct=actual.providerProductCost===0?Number(order.productCost):0;
      if(order.recognizedCost===null||Math.abs(Number(actual.expense)+extraProduct-Number(order.recognizedCost))>.011)summary.recognizedCostMismatch++;
      if(order.contributionAfterProduct===null||Math.abs((outcome==='RETURNED'?0:Number(order.realizedRevenue))-Number(order.recognizedCost)-Number(order.contributionAfterProduct))>.011)summary.profitFormulaMismatch++;
      summary.matched++;compared++;
    }
    summary.vat.amount=Math.round(summary.vat.amount*100)/100;
    const directDays=new Map();
    for(const order of direct.projection.filter(order=>order.month===month)){
      const counts=directDays.get(order.createdDay)||{created:0,delivered:0,returned:0};counts.created++;
      if(order.outcome==='DELIVERED')counts.delivered++;if(order.outcome==='RETURNED')counts.returned++;directDays.set(order.createdDay,counts);
    }
    for(const row of report.days){const actual=directDays.get(row.day)||{created:0,delivered:0,returned:0};if(['created','delivered','returned'].some(k=>Number(row[k])!==actual[k]))summary.dailyCohortMismatch++;}
    summary.focusDays=report.days.filter(r=>['2026-09-05','2026-09-12','2026-09-13','2026-09-15'].includes(r.day)).map(r=>({day:r.day,source:{created:r.created,delivered:r.delivered,returned:r.returned},direct:directDays.get(r.day)}));
  }
  console.log(JSON.stringify({source:'DIRECT_DROPEA_ORDER_CROSSCHECK',observedAt:direct.observedAt,pages:direct.pages,read:direct.read,
    compared,months,actions:0,writes:0}));
}
crosscheck();
