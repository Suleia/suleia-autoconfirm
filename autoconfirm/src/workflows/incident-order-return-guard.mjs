import { listOrderIncidentReturns } from '../db/supabase-store.mjs';
import { readDropeaV2ReturnIssueState } from '../clients/dropea-v2-incidents.mjs';

// A carrier can open another incident after a return was already requested.
// Never infer that the NEW issue is resolved from the old issue's resolution.
export async function inspectPriorOrderReturn(incident, {
  storeId = 'suleia', list = listOrderIncidentReturns,
  read = readDropeaV2ReturnIssueState
} = {}) {
  let rows;
  try { rows = await list({ storeId, orderId: incident.orderId }); }
  catch { return { blocked: true, reason: 'order_return_ledger_unavailable' }; }
  if (!Array.isArray(rows) || rows.length >= 100) return { blocked: true, reason: 'order_return_ledger_incomplete' };
  for (const row of rows) {
    if (String(row.order_id) !== String(incident.orderId)) return { blocked: true, reason: 'order_return_identity_mismatch' };
    const id = String(row.template_name).match(/^dropea_issue_discount_no_response_return_v1:(\d+)$/)?.[1];
    if (!id || id === String(incident.incidenceId)) continue;
    let current;
    try { current = await read({ orderId: incident.orderId, incidenceId: id }); }
    catch { return { blocked: true, reason: 'prior_return_read_failed' }; }
    const issue = current?.issue?.raw || current?.issue;
    if (String(issue?.id) !== id || String(issue?.order_id) !== String(incident.orderId)) {
      return { blocked: true, reason: 'prior_return_identity_mismatch' };
    }
    if (issue.status === 'RESOLVED' && issue.resolution_status === 'RETURN_REQUESTED') {
      if (incident.tracking && issue.tracking_number && String(incident.tracking) !== String(issue.tracking_number)) {
        return { blocked: true, reason: 'prior_return_shipment_changed' };
      }
      return { verified: true, priorIncidenceId: id, completedAt: issue.resolution_changed_at || row.sent_at || null };
    }
    // An old successful/ambiguous write which can no longer be verified must
    // not silently authorize a second write against a different incident.
    return { blocked: true, reason: 'prior_return_state_changed' };
  }
  return { verified: false, blocked: false };
}
