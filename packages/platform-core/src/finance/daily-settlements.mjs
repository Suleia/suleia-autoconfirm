// Calendar-date settlement analysis, kept separate from creation-cohort P&L.
// Existing order breakdowns only; never fetch or mutate a customer/order here.
const COSTS = ['productCost', 'outboundShippingCost', 'outboundFulfillmentCost', 'codCost', 'returnCost', 'dropeaAdjustmentsCost'];
const validMoney = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const round = value => Number(value.toFixed(6));
const cents = value => Math.round(Number(value) * 100);

export function buildDailySettlements({ month, currentDay, reports = [] } = {}) {
  const source = reports.find(r => r.period?.month === month);
  if (!source?.days?.length || !reports.some(r => r.orders?.length)) return null;
  const daysInMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const sourceDays = new Map(source.days.map(r => [r.day, r]));
  const rows = source.days.map(r => ({ day:r.day, created:r.created, delivered:0, returned:0,
    realRevenue:0, ...Object.fromEntries(COSTS.map(k => [k,0])), metaSpend:r.metaSpend,
    fixedCosts:0, oneOffCosts:r.oneOffCosts, otherCosts:r.otherCosts, quality:'COMPLETE' }));
  if (source.period.current===true && currentDay?.startsWith(`${month}-`)) {
    for (let i=1;i<=Number(currentDay.slice(-2));i++) {
      const date=`${month}-${String(i).padStart(2,'0')}`;
      if (!sourceDays.has(date)) rows.push({day:date,created:null,delivered:null,returned:null,realRevenue:null,
        ...Object.fromEntries(COSTS.map(k=>[k,null])),metaSpend:null,fixedCosts:0,oneOffCosts:null,otherCosts:null,quality:'INCOMPLETE'});
    }
    rows.sort((a,b)=>a.day.localeCompare(b.day));
  }
  const byDay = new Map(rows.map(r => [r.day,r]));
  let missingDates=0; let missingComponents=0; let duplicateConflicts=0; let nonFinal=0;
  const unique = new Map();
  for (const report of reports) for (const order of report.orders || []) {
    const old = unique.get(String(order.orderId));
    if (old) { const {__observed,...previous}=old; if (JSON.stringify(previous)!==JSON.stringify(order)) duplicateConflicts++; }
    // Prefer latest observed report, not iteration order.
    if (!old || String(report.generatedAt || '') >= (old.__observed || '')) unique.set(String(order.orderId), {...order,__observed:report.generatedAt || ''});
  }
  for (const order of unique.values()) {
    if (!['DELIVERED','FINISHED','RETURNED'].includes(order.status)) continue;
    if (!order.settlementDay) { missingDates++; continue; }
    const row = byDay.get(order.settlementDay);
    if (!row) continue;
    const outcome=order.status === 'RETURNED' ? 'returned' : 'delivered';
    if (row[outcome]!==null) row[outcome]++;
    if (order.breakdownStatus !== 'DROPEA_FINAL') { nonFinal++; row.quality='INCOMPLETE'; }
    for (const key of COSTS) {
      if (!validMoney(order[key])) { row[key]=null; missingComponents++; row.quality='INCOMPLETE'; }
      else if (row[key] !== null) row[key]+=cents(order[key])/100;
    }
    // Zero revenue on an actual return is semantic, not missing-data imputation.
    if (order.status !== 'RETURNED') {
      if (!validMoney(order.realizedRevenue)) { row.realRevenue=null; missingComponents++; row.quality='INCOMPLETE'; }
      else if (row.realRevenue !== null) row.realRevenue+=cents(order.realizedRevenue)/100;
    }
  }
  // Recurring ledger is accrued across the eligible CALENDAR days of the month.
  // The full-month committed charge remains in the separate cohort headline.
  const recurring=(source.expenseLedger || []).filter(e => e.type==='recurring_monthly');
  for (const item of recurring) {
    const calendar = Array.from({length:daysInMonth},(_,i)=>`${month}-${String(i+1).padStart(2,'0')}`)
      .filter(day => (!item.startDate || day>=item.startDate) && (!item.endDate || day<=item.endDate));
    if (!calendar.length || !validMoney(item.appliedAmount ?? item.amount)) continue;
    const daily=Number(item.appliedAmount ?? item.amount)/calendar.length;
    for (const day of calendar) if (byDay.has(day)) byDay.get(day).fixedCosts+=daily;
  }
  if (!recurring.length) for (const row of rows) row.fixedCosts=sourceDays.get(row.day)?.fixedCosts ?? null;
  for (const row of rows) {
    if (missingDates || duplicateConflicts) row.quality='INCOMPLETE';
    for (const key of COSTS) if (row[key] !== null) row[key]=round(row[key]);
    if (validMoney(row.fixedCosts)) row.fixedCosts=round(Number(row.fixedCosts));
    const components=[...COSTS.map(k=>row[k]),row.metaSpend,row.fixedCosts,row.oneOffCosts,row.otherCosts];
    const complete=components.every(validMoney) && validMoney(row.realRevenue) && row.quality==='COMPLETE';
    if (!complete) row.quality='INCOMPLETE';
    row.totalCosts=complete ? round(components.reduce((n,v)=>n+Number(v),0)) : null;
    row.netProfit=complete ? round(row.realRevenue-row.totalCosts) : null;
    row.marginPercent=row.realRevenue && row.netProfit!==null ? round(row.netProfit*100/row.realRevenue) : null;
    row.roiPercent=row.totalCosts && row.netProfit!==null ? round(row.netProfit*100/row.totalCosts) : null;
    row.roas=validMoney(row.metaSpend) && Number(row.metaSpend)>0 && validMoney(row.realRevenue) ? round(row.realRevenue/row.metaSpend) : null;
    row.closeStatus=row.day===currentDay ? 'CURRENT_PARTIAL' : complete ? 'OBSERVED' : 'PENDING';
    row.closeLabel=row.day===currentDay ? 'Hoy · datos parciales' : complete ? 'Liquidaciones observadas' : 'Datos incompletos';
  }
  const fields=['realRevenue',...COSTS,'metaSpend','fixedCosts','oneOffCosts','otherCosts','totalCosts','netProfit'];
  const totals=Object.fromEntries(fields.map(key => [key,rows.every(r=>validMoney(r[key])) ? round(rows.reduce((n,r)=>n+Number(r[key]),0)) : null]));
  totals.exactNetProfit=totals.netProfit;
  totals.marginPercent=totals.realRevenue && totals.netProfit!==null ? round(totals.netProfit*100/totals.realRevenue) : null;
  totals.roiPercent=totals.totalCosts && totals.netProfit!==null ? round(totals.netProfit*100/totals.totalCosts) : null;
  totals.roas=totals.metaSpend && totals.realRevenue!==null ? round(totals.realRevenue/totals.metaSpend) : null;
  return { basis:'ACTUAL_ORDER_SETTLEMENT_DATE', days:rows, totals,
    eventCounts:{delivered:rows.reduce((n,r)=>n+r.delivered,0),returned:rows.reduce((n,r)=>n+r.returned,0)},
    audit:{missingDates,missingComponents,duplicateConflicts,nonFinal},
    label:'Entregas/devoluciones por fecha real · costes del pedido liquidado − Meta del día − gastos devengados',
    limitation:'No es el movimiento diario de wallet: los costes de pedidos aún sin liquidar quedan en el resumen mensual de la cohorte. No se incluyen pedidos creados antes del primer mes disponible.',
    productionWrites:0 };
}
