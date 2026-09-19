import { listDropeaOrdersByStatus } from '../src/clients/dropea.mjs';
import { collectPendingDropeaV2Incidents } from '../src/clients/dropea-v2-incidents.mjs';
import {
  collectActiveOrderSnapshot,
  findBlockingActivePriorOrder
} from '../src/policies/active-order-duplicates.mjs';

const snapshot = await collectActiveOrderSnapshot({
  listByStatus: listDropeaOrdersByStatus,
  listPendingIncidents: collectPendingDropeaV2Incidents
});

const pending = snapshot.filter((order) => String(order?.status || '').toUpperCase() === 'PENDING');
const findings = pending
  .map((order) => ({ order, finding: findBlockingActivePriorOrder(order, snapshot) }))
  .filter(({ finding }) => finding)
  .map(({ order, finding }) => ({
    current_order_id: String(order.orderId || ''),
    current_status: String(order.status || ''),
    blocking_order_id: finding.order?.orderId ? String(finding.order.orderId) : null,
    blocking_status: finding.order?.status || null,
    result: finding.kind,
    reason: finding.reason
  }));

process.stdout.write(`${JSON.stringify({
  snapshot_count: snapshot.length,
  pending_count: pending.length,
  exact_duplicates: findings.filter((row) => row.result === 'ACTIVE_PRIOR_SAME_PRODUCT_ORDER'),
  manual_review: findings.filter((row) => row.result === 'UNVERIFIABLE')
}, null, 2)}\n`);
