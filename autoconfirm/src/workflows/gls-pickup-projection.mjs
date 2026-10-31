// Read-only handoff from the isolated existing VPS worker. It cannot send,
// change interpretation, resolve issues or promote an unverified notice.
export function applyGlsPickupProjection(incidents,report,now=Date.now()){
 if(!report||!Array.isArray(report.cases)||!Number.isFinite(Date.parse(report.completed_at))||Date.parse(report.completed_at)>now||now-Date.parse(report.completed_at)>3600000)return 0;
 let count=0;
 for(const incident of incidents){
  const row=report.cases.find(c=>String(c.order_id)===String(incident.orderId)&&String(c.issue_id)===String(incident.incidenceId));
  if(!row)continue;
  incident.glsPickupNotice={...row,mode:report.mode,template:report.template,report_at:report.completed_at};
  // Existing Customer Care keeps its own interpretation/actions. This context
  // is evidence only, never a new reply interpreter or logistics instruction.
  incident.glsPickupContext={owner:'GLS_PICKUP_NOTICE_V1',agency:row.agency||null,amount_cents:row.amount_cents??null,tracking:row.tracking||null,notice_state:row.state,notice_wamid:row.wamid||null,observed_at:row.observed_at};
  count++;
 }return count;
}
